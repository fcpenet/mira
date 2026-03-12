const express = require('express');
const { query, queryAsOrg } = require('../db');
const { authenticate } = require('../middleware/auth');
const { publisher, CHANNEL } = require('../redis');

const router = express.Router();

/**
 * POST /events/ingest
 * Authenticated by device API key (X-Device-Key header), not user JWT.
 * This is the ingestion endpoint called by MAGUS devices.
 *
 * Body: { type, severity, payload? }
 * Writes the event to PostgreSQL and publishes it to Redis for real-time fanout.
 */
router.post('/ingest', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-device-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'X-Device-Key header required' });
    }

    // Look up device by API key — unscoped because we don't know org yet
    const deviceResult = await query(
      'SELECT id, org_id, name, type FROM devices WHERE api_key = $1',
      [apiKey]
    );
    const device = deviceResult.rows[0];
    if (!device) {
      return res.status(401).json({ error: 'invalid device key' });
    }

    const { type, severity, payload = {} } = req.body;
    if (!type || !severity) {
      return res.status(400).json({ error: 'type and severity are required' });
    }
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
      return res.status(400).json({ error: 'severity must be low, medium, high, or critical' });
    }

    // Write event and mark device as online in one transaction
    const { rows } = await queryAsOrg(
      device.org_id,
      `WITH inserted AS (
        INSERT INTO events (org_id, device_id, type, severity, payload)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      ),
      updated AS (
        UPDATE devices SET status = 'online', last_seen = NOW() WHERE id = $2
      )
      SELECT * FROM inserted`,
      [device.org_id, device.id, type, severity, payload]
    );

    const event = rows[0];

    // Publish to Redis — all server instances receive this and fan out to
    // socket.io clients subscribed to the org's room
    await publisher.publish(CHANNEL, JSON.stringify({
      event,
      device: { id: device.id, name: device.name, type: device.type },
    }));

    res.status(202).json({ eventId: event.id });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events
 * Returns paginated event history for the caller's organization.
 * Query params: deviceId?, severity?, limit (default 50), offset (default 0)
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { deviceId, severity, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const values = [];

    if (deviceId) { values.push(deviceId); conditions.push(`device_id = $${values.length}`); }
    if (severity)  { values.push(severity);  conditions.push(`severity = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    values.push(Math.min(parseInt(limit), 200));
    values.push(parseInt(offset));

    const { rows } = await queryAsOrg(
      req.user.orgId,
      `SELECT e.id, e.device_id, d.name AS device_name, e.type, e.severity, e.payload, e.created_at
       FROM events e
       JOIN devices d ON d.id = e.device_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    res.json({ events: rows, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

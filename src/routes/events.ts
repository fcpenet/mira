import { Router, Request, Response, NextFunction } from 'express';
import { query, queryAsOrg } from '../db';
import { authenticate } from '../middleware/auth';
import { publisher, CHANNEL } from '../redis';
import { Event, EventSeverity, Device } from '../types';

const router = Router();

const VALID_SEVERITIES: EventSeverity[] = ['low', 'medium', 'high', 'critical'];

/**
 * POST /events/ingest
 * Authenticated by device API key (X-Device-Key header).
 * Writes event to PostgreSQL and publishes to Redis for real-time fanout.
 */
router.post('/ingest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers['x-device-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({ error: 'X-Device-Key header required' });
      return;
    }

    const deviceResult = await query<Pick<Device, 'id' | 'org_id' | 'name' | 'type'>>(
      'SELECT id, org_id, name, type FROM devices WHERE api_key = $1',
      [apiKey]
    );
    const device = deviceResult.rows[0];
    if (!device) {
      res.status(401).json({ error: 'invalid device key' });
      return;
    }

    const { type, severity, payload = {} } = req.body as {
      type: string;
      severity: EventSeverity;
      payload?: Record<string, unknown>;
    };

    if (!type || !severity) {
      res.status(400).json({ error: 'type and severity are required' });
      return;
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      res.status(400).json({ error: 'severity must be low, medium, high, or critical' });
      return;
    }

    const { rows } = await queryAsOrg<Event>(
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
 * Paginated event history for caller's org.
 * Query params: deviceId?, severity?, limit (max 200), offset
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      deviceId,
      severity,
      limit = '50',
      offset = '0',
    } = req.query as {
      deviceId?: string;
      severity?: EventSeverity;
      limit?: string;
      offset?: string;
    };

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (deviceId) { values.push(deviceId); conditions.push(`device_id = $${values.length}`); }
    if (severity)  { values.push(severity);  conditions.push(`severity = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const parsedLimit = Math.min(parseInt(limit), 200);
    const parsedOffset = parseInt(offset);

    values.push(parsedLimit);
    values.push(parsedOffset);

    const { rows } = await queryAsOrg(
      req.user!.orgId,
      `SELECT e.id, e.device_id, d.name AS device_name, e.type, e.severity, e.payload, e.created_at
       FROM events e
       JOIN devices d ON d.id = e.device_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    res.json({ events: rows, limit: parsedLimit, offset: parsedOffset });
  } catch (err) {
    next(err);
  }
});

export default router;

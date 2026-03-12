const express = require('express');
const { queryAsOrg } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// All device routes require authentication
router.use(authenticate);

/**
 * GET /devices
 * Returns all devices in the caller's organization.
 */
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await queryAsOrg(
      req.user.orgId,
      'SELECT id, org_id, name, type, status, last_seen, created_at FROM devices ORDER BY name',
      []
    );
    res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /devices/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await queryAsOrg(
      req.user.orgId,
      'SELECT id, org_id, name, type, status, last_seen, created_at FROM devices WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'device not found' });
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /devices
 * Body: { name, type }
 * Creates a new device in the caller's organization.
 * Returns the generated api_key — only shown once.
 */
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, type } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required' });
    }
    if (!['sensor', 'camera'].includes(type)) {
      return res.status(400).json({ error: 'type must be sensor or camera' });
    }

    const { rows } = await queryAsOrg(
      req.user.orgId,
      `INSERT INTO devices (org_id, name, type)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, name, type, api_key, status, created_at`,
      [req.user.orgId, name, type]
    );

    res.status(201).json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /devices/:id
 * Body: { name?, status? }
 */
router.patch('/:id', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { name, status } = req.body;
    const updates = [];
    const values  = [];

    if (name)   { values.push(name);   updates.push(`name = $${values.length}`); }
    if (status) {
      if (!['online', 'offline'].includes(status)) {
        return res.status(400).json({ error: 'status must be online or offline' });
      }
      values.push(status); updates.push(`status = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    values.push(req.params.id);
    const { rows } = await queryAsOrg(
      req.user.orgId,
      `UPDATE devices SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, org_id, name, type, status, last_seen, created_at`,
      values
    );

    if (!rows[0]) return res.status(404).json({ error: 'device not found' });
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /devices/:id
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await queryAsOrg(
      req.user.orgId,
      'DELETE FROM devices WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'device not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

import { Router, Request, Response, NextFunction } from 'express';
import { queryAsOrg } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { Device, DeviceType, DeviceStatus } from '../types';

const router = Router();

router.use(authenticate);

/** GET /devices — list all devices in caller's org */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await queryAsOrg<Device>(
      req.user!.orgId,
      'SELECT id, org_id, name, type, status, last_seen, created_at FROM devices ORDER BY name',
      []
    );
    res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});

/** GET /devices/:id */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await queryAsOrg<Device>(
      req.user!.orgId,
      'SELECT id, org_id, name, type, status, last_seen, created_at FROM devices WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'device not found' });
      return;
    }
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** POST /devices — create a device (admin only). Returns api_key once. */
router.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type } = req.body as { name: string; type: DeviceType };

    if (!name || !type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }
    if (!(['sensor', 'camera'] as DeviceType[]).includes(type)) {
      res.status(400).json({ error: 'type must be sensor or camera' });
      return;
    }

    const { rows } = await queryAsOrg<Device>(
      req.user!.orgId,
      `INSERT INTO devices (org_id, name, type)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, name, type, api_key, status, created_at`,
      [req.user!.orgId, name, type]
    );

    res.status(201).json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** PATCH /devices/:id — update name or status */
router.patch('/:id', requireRole('admin', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, status } = req.body as { name?: string; status?: DeviceStatus };
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name)   { values.push(name);   updates.push(`name = $${values.length}`); }
    if (status) {
      if (!(['online', 'offline'] as DeviceStatus[]).includes(status)) {
        res.status(400).json({ error: 'status must be online or offline' });
        return;
      }
      values.push(status); updates.push(`status = $${values.length}`);
    }

    if (!updates.length) {
      res.status(400).json({ error: 'no updatable fields provided' });
      return;
    }

    values.push(req.params.id);
    const { rows } = await queryAsOrg<Device>(
      req.user!.orgId,
      `UPDATE devices SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, org_id, name, type, status, last_seen, created_at`,
      values
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'device not found' });
      return;
    }
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE /devices/:id */
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rowCount } = await queryAsOrg(
      req.user!.orgId,
      'DELETE FROM devices WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: 'device not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

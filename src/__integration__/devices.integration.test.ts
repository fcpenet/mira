import request from 'supertest';
import app from '../app';
import { truncateAll, dbQuery } from './helpers/db';
import { seedUser, seedDevice, authHeader, DEMO_ORG_ID } from './helpers/seed';

beforeEach(truncateAll);

// ── GET /devices ───────────────────────────────────────────────────────────────

describe('GET /devices', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/devices');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when the org has no devices', async () => {
    const user = await seedUser();

    const res = await request(app)
      .get('/devices')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([]);
  });

  it('returns devices belonging to the caller org', async () => {
    const user = await seedUser();
    await seedDevice(DEMO_ORG_ID, { name: 'Sensor Alpha' });
    await seedDevice(DEMO_ORG_ID, { name: 'Camera Beta', type: 'camera' });

    const res = await request(app)
      .get('/devices')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(2);
    const names = res.body.devices.map((d: { name: string }) => d.name);
    expect(names).toContain('Sensor Alpha');
    expect(names).toContain('Camera Beta');
  });

  it('does not return api_key in the list response', async () => {
    const user = await seedUser();
    await seedDevice();

    const res = await request(app)
      .get('/devices')
      .set('Authorization', authHeader(user));

    expect(res.body.devices[0].api_key).toBeUndefined();
  });
});

// ── GET /devices/:id ───────────────────────────────────────────────────────────

describe('GET /devices/:id', () => {
  it('returns the device when it exists in the org', async () => {
    const user   = await seedUser();
    const device = await seedDevice(DEMO_ORG_ID, { name: 'Requested Sensor' });

    const res = await request(app)
      .get(`/devices/${device.id}`)
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.device.id).toBe(device.id);
    expect(res.body.device.name).toBe('Requested Sensor');
  });

  it('returns 404 for a non-existent device id', async () => {
    const user = await seedUser();

    const res = await request(app)
      .get('/devices/00000000-0000-0000-0000-000000000099')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(404);
  });
});

// ── POST /devices ──────────────────────────────────────────────────────────────

describe('POST /devices', () => {
  it('returns 403 for a non-admin user', async () => {
    const operator = await seedUser(DEMO_ORG_ID, { role: 'operator' });

    const res = await request(app)
      .post('/devices')
      .set('Authorization', authHeader(operator))
      .send({ name: 'New Cam', type: 'camera' });

    expect(res.status).toBe(403);
  });

  it('creates the device and returns 201 with api_key for admin', async () => {
    const admin = await seedUser(DEMO_ORG_ID, { role: 'admin' });

    const res = await request(app)
      .post('/devices')
      .set('Authorization', authHeader(admin))
      .send({ name: 'Front Door Cam', type: 'camera' });

    expect(res.status).toBe(201);
    expect(res.body.device.name).toBe('Front Door Cam');
    expect(res.body.device.type).toBe('camera');
    expect(res.body.device.api_key).toBeDefined();
    expect(res.body.device.api_key).toHaveLength(64); // 32 bytes → hex
  });

  it('persists the device to the database', async () => {
    const admin = await seedUser(DEMO_ORG_ID, { role: 'admin' });

    await request(app)
      .post('/devices')
      .set('Authorization', authHeader(admin))
      .send({ name: 'Persisted Device', type: 'sensor' });

    const { rows } = await dbQuery(
      'SELECT name FROM devices WHERE name = $1',
      ['Persisted Device']
    );
    expect(rows).toHaveLength(1);
  });

  it('returns 400 when name is missing', async () => {
    const admin = await seedUser(DEMO_ORG_ID, { role: 'admin' });

    const res = await request(app)
      .post('/devices')
      .set('Authorization', authHeader(admin))
      .send({ type: 'sensor' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid type', async () => {
    const admin = await seedUser(DEMO_ORG_ID, { role: 'admin' });

    const res = await request(app)
      .post('/devices')
      .set('Authorization', authHeader(admin))
      .send({ name: 'Bad Type', type: 'robot' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/);
  });
});

// ── PATCH /devices/:id ─────────────────────────────────────────────────────────

describe('PATCH /devices/:id', () => {
  it('updates the device name', async () => {
    const admin  = await seedUser(DEMO_ORG_ID, { role: 'admin' });
    const device = await seedDevice();

    const res = await request(app)
      .patch(`/devices/${device.id}`)
      .set('Authorization', authHeader(admin))
      .send({ name: 'Renamed Sensor' });

    expect(res.status).toBe(200);
    expect(res.body.device.name).toBe('Renamed Sensor');
  });

  it('updates the device status', async () => {
    const operator = await seedUser(DEMO_ORG_ID, { role: 'operator' });
    const device   = await seedDevice();

    const res = await request(app)
      .patch(`/devices/${device.id}`)
      .set('Authorization', authHeader(operator))
      .send({ status: 'online' });

    expect(res.status).toBe(200);
    expect(res.body.device.status).toBe('online');
  });

  it('returns 400 for an invalid status', async () => {
    const admin  = await seedUser(DEMO_ORG_ID, { role: 'admin' });
    const device = await seedDevice();

    const res = await request(app)
      .patch(`/devices/${device.id}`)
      .set('Authorization', authHeader(admin))
      .send({ status: 'broken' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const admin  = await seedUser(DEMO_ORG_ID, { role: 'admin' });
    const device = await seedDevice();

    const res = await request(app)
      .patch(`/devices/${device.id}`)
      .set('Authorization', authHeader(admin))
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 403 for a viewer', async () => {
    const viewer = await seedUser(DEMO_ORG_ID, { role: 'viewer' });
    const device = await seedDevice();

    const res = await request(app)
      .patch(`/devices/${device.id}`)
      .set('Authorization', authHeader(viewer))
      .send({ name: 'Hacked' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /devices/:id ────────────────────────────────────────────────────────

describe('DELETE /devices/:id', () => {
  it('deletes the device and returns 204', async () => {
    const admin  = await seedUser(DEMO_ORG_ID, { role: 'admin' });
    const device = await seedDevice();

    const res = await request(app)
      .delete(`/devices/${device.id}`)
      .set('Authorization', authHeader(admin));

    expect(res.status).toBe(204);

    const { rows } = await dbQuery('SELECT id FROM devices WHERE id = $1', [device.id]);
    expect(rows).toHaveLength(0);
  });

  it('returns 404 when the device does not exist', async () => {
    const admin = await seedUser(DEMO_ORG_ID, { role: 'admin' });

    const res = await request(app)
      .delete('/devices/00000000-0000-0000-0000-000000000099')
      .set('Authorization', authHeader(admin));

    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-admin user', async () => {
    const operator = await seedUser(DEMO_ORG_ID, { role: 'operator' });
    const device   = await seedDevice();

    const res = await request(app)
      .delete(`/devices/${device.id}`)
      .set('Authorization', authHeader(operator));

    expect(res.status).toBe(403);
  });
});

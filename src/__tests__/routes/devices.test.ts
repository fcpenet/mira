import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../../db', () => ({
  query: jest.fn(),
  queryAsOrg: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('../../redis', () => ({
  publisher: { publish: jest.fn() },
  subscriber: { subscribe: jest.fn(), on: jest.fn() },
  CHANNEL: 'mira:events',
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { queryAsOrg } from '../../db';

const mockQueryAsOrg = queryAsOrg as jest.MockedFunction<typeof queryAsOrg>;

function dbRows<T>(rows: T[]) {
  return { rows, rowCount: rows.length } as never;
}

function dbRow<T>(row: T) {
  return dbRows([row]);
}

function dbEmpty() {
  return { rows: [], rowCount: 0 } as never;
}

function authHeader(role = 'admin', orgId = 'org-1') {
  const token = jwt.sign({ orgId, role, email: 'test@mira.com' }, 'test-secret', { subject: 'user-1' });
  return { Authorization: `Bearer ${token}` };
}

const DEVICE = {
  id: 'dev-1',
  org_id: 'org-1',
  name: 'Front Door',
  type: 'sensor',
  status: 'offline',
  last_seen: null,
  created_at: new Date().toISOString(),
};

// ── GET /devices ───────────────────────────────────────────────────────────────

describe('GET /devices', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/devices');
    expect(res.status).toBe(401);
  });

  it('returns 200 with a list of devices', async () => {
    mockQueryAsOrg.mockResolvedValue(dbRows([DEVICE]));

    const res = await request(app).get('/devices').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0]).toMatchObject({ name: 'Front Door' });
  });

  it('queries with the org ID from the JWT', async () => {
    mockQueryAsOrg.mockResolvedValue(dbRows([]));

    await request(app).get('/devices').set(authHeader('operator', 'org-99'));
    expect(mockQueryAsOrg.mock.calls[0][0]).toBe('org-99');
  });
});

// ── GET /devices/:id ───────────────────────────────────────────────────────────

describe('GET /devices/:id', () => {
  it('returns 404 when device does not exist', async () => {
    mockQueryAsOrg.mockResolvedValue(dbEmpty());

    const res = await request(app).get('/devices/no-such').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('returns 200 with the device', async () => {
    mockQueryAsOrg.mockResolvedValue(dbRow(DEVICE));

    const res = await request(app).get('/devices/dev-1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.device.id).toBe('dev-1');
  });
});

// ── POST /devices ──────────────────────────────────────────────────────────────

describe('POST /devices', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/devices').send({ name: 'X', type: 'sensor' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not admin', async () => {
    const res = await request(app)
      .post('/devices')
      .set(authHeader('operator'))
      .send({ name: 'X', type: 'sensor' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/devices')
      .set(authHeader('admin'))
      .send({ type: 'sensor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('returns 400 for an invalid device type', async () => {
    const res = await request(app)
      .post('/devices')
      .set(authHeader('admin'))
      .send({ name: 'X', type: 'radar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/);
  });

  it('returns 201 with the new device including api_key', async () => {
    const created = { ...DEVICE, api_key: 'abc123' };
    mockQueryAsOrg.mockResolvedValue(dbRow(created));

    const res = await request(app)
      .post('/devices')
      .set(authHeader('admin'))
      .send({ name: 'Front Door', type: 'sensor' });

    expect(res.status).toBe(201);
    expect(res.body.device.api_key).toBe('abc123');
  });
});

// ── PATCH /devices/:id ─────────────────────────────────────────────────────────

describe('PATCH /devices/:id', () => {
  it('returns 403 when caller is viewer', async () => {
    const res = await request(app)
      .patch('/devices/dev-1')
      .set(authHeader('viewer'))
      .send({ name: 'New Name' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const res = await request(app)
      .patch('/devices/dev-1')
      .set(authHeader('admin'))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no updatable fields/);
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await request(app)
      .patch('/devices/dev-1')
      .set(authHeader('admin'))
      .send({ status: 'broken' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it('returns 404 when device does not exist', async () => {
    mockQueryAsOrg.mockResolvedValue(dbEmpty());

    const res = await request(app)
      .patch('/devices/no-such')
      .set(authHeader('admin'))
      .send({ name: 'New Name' });
    expect(res.status).toBe(404);
  });

  it('returns 200 with the updated device', async () => {
    const updated = { ...DEVICE, name: 'Updated Name' };
    mockQueryAsOrg.mockResolvedValue(dbRow(updated));

    const res = await request(app)
      .patch('/devices/dev-1')
      .set(authHeader('admin'))
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.device.name).toBe('Updated Name');
  });
});

// ── DELETE /devices/:id ────────────────────────────────────────────────────────

describe('DELETE /devices/:id', () => {
  it('returns 403 when caller is not admin', async () => {
    const res = await request(app)
      .delete('/devices/dev-1')
      .set(authHeader('operator'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when device does not exist', async () => {
    mockQueryAsOrg.mockResolvedValue(dbEmpty());

    const res = await request(app)
      .delete('/devices/no-such')
      .set(authHeader('admin'));
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful deletion', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    const res = await request(app)
      .delete('/devices/dev-1')
      .set(authHeader('admin'));
    expect(res.status).toBe(204);
  });
});

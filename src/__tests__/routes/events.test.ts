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
  publisher: { publish: jest.fn().mockResolvedValue(1) },
  subscriber: { subscribe: jest.fn(), on: jest.fn() },
  CHANNEL: 'mira:events',
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { query, queryAsOrg } from '../../db';
import { publisher } from '../../redis';

const mockQuery      = query      as jest.MockedFunction<typeof query>;
const mockQueryAsOrg = queryAsOrg as jest.MockedFunction<typeof queryAsOrg>;
const mockPublish    = publisher.publish as jest.MockedFunction<typeof publisher.publish>;

function dbRow<T>(row: T) {
  return { rows: [row], rowCount: 1 } as never;
}

function dbEmpty() {
  return { rows: [], rowCount: 0 } as never;
}

function authHeader(orgId = 'org-1', role = 'operator') {
  const token = jwt.sign({ orgId, role, email: 'test@mira.com' }, 'test-secret', { subject: 'user-1' });
  return { Authorization: `Bearer ${token}` };
}

const DEVICE = { id: 'dev-1', org_id: 'org-1', name: 'Sensor A', type: 'sensor' };

const EVENT = {
  id: 'evt-1',
  org_id: 'org-1',
  device_id: 'dev-1',
  type: 'motion_detected',
  severity: 'high',
  payload: { zone: 'A1' },
  created_at: new Date().toISOString(),
};

// ── POST /events/ingest ────────────────────────────────────────────────────────

describe('POST /events/ingest', () => {
  it('returns 401 when X-Device-Key header is missing', async () => {
    const res = await request(app).post('/events/ingest').send({ type: 'motion', severity: 'low' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the API key is not found', async () => {
    mockQuery.mockResolvedValue(dbEmpty());

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'bad-key')
      .send({ type: 'motion', severity: 'low' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid device key');
  });

  it('returns 400 when type is missing', async () => {
    mockQuery.mockResolvedValue(dbRow(DEVICE));

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'valid-key')
      .send({ severity: 'low' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/);
  });

  it('returns 400 for an invalid severity', async () => {
    mockQuery.mockResolvedValue(dbRow(DEVICE));

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'valid-key')
      .send({ type: 'motion', severity: 'extreme' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/);
  });

  it('returns 202 with eventId and publishes to Redis on success', async () => {
    mockQuery.mockResolvedValue(dbRow(DEVICE));
    mockQueryAsOrg.mockResolvedValue(dbRow(EVENT));

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'valid-key')
      .send({ type: 'motion_detected', severity: 'high', payload: { zone: 'A1' } });

    expect(res.status).toBe(202);
    expect(res.body.eventId).toBe('evt-1');
    expect(mockPublish).toHaveBeenCalledTimes(1);

    const published = JSON.parse(mockPublish.mock.calls[0][1] as string);
    expect(published.event.id).toBe('evt-1');
    expect(published.device.name).toBe('Sensor A');
  });

  it('publishes to the correct Redis channel', async () => {
    mockQuery.mockResolvedValue(dbRow(DEVICE));
    mockQueryAsOrg.mockResolvedValue(dbRow(EVENT));

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'valid-key')
      .send({ type: 'motion', severity: 'low' });

    expect(mockPublish.mock.calls[0][0]).toBe('mira:events');
  });

  it('scopes the event INSERT to the device org', async () => {
    mockQuery.mockResolvedValue(dbRow(DEVICE));
    mockQueryAsOrg.mockResolvedValue(dbRow(EVENT));

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'valid-key')
      .send({ type: 'motion', severity: 'low' });

    expect(mockQueryAsOrg.mock.calls[0][0]).toBe('org-1');
  });
});

// ── GET /events ────────────────────────────────────────────────────────────────

describe('GET /events', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/events');
    expect(res.status).toBe(401);
  });

  it('returns 200 with a list of events', async () => {
    const row = { ...EVENT, device_name: 'Sensor A' };
    mockQueryAsOrg.mockResolvedValue({ rows: [row], rowCount: 1 } as never);

    const res = await request(app).get('/events').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('motion_detected');
  });

  it('returns pagination metadata', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const res = await request(app).get('/events?limit=10&offset=20').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
  });

  it('caps limit at 200', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await request(app).get('/events?limit=999').set(authHeader());

    // The query values array ends with [200, 0] (limit, offset)
    const values = mockQueryAsOrg.mock.calls[0][2] as unknown[];
    const limitValue = values[values.length - 2];
    expect(limitValue).toBe(200);
  });

  it('scopes query to the caller org from JWT', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await request(app).get('/events').set(authHeader('org-42'));
    expect(mockQueryAsOrg.mock.calls[0][0]).toBe('org-42');
  });

  it('passes deviceId filter to the query when provided', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await request(app).get('/events?deviceId=dev-99').set(authHeader());

    const values = mockQueryAsOrg.mock.calls[0][2] as unknown[];
    expect(values).toContain('dev-99');
  });

  it('passes severity filter to the query when provided', async () => {
    mockQueryAsOrg.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await request(app).get('/events?severity=critical').set(authHeader());

    const values = mockQueryAsOrg.mock.calls[0][2] as unknown[];
    expect(values).toContain('critical');
  });
});

import request from 'supertest';
import app from '../src/app';
import { truncateAll, dbQuery } from './helpers/db';
import { seedUser, seedDevice, authHeader, DEMO_ORG_ID } from './helpers/seed';

// Redis publisher is real in integration tests — silence connection noise
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(truncateAll);

// ── POST /events/ingest ────────────────────────────────────────────────────────

describe('POST /events/ingest', () => {
  it('returns 401 when X-Device-Key header is missing', async () => {
    const res = await request(app)
      .post('/events/ingest')
      .send({ type: 'motion', severity: 'low' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when the API key is not found', async () => {
    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', 'invalid-key-that-does-not-exist')
      .send({ type: 'motion', severity: 'low' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid device key');
  });

  it('returns 400 when event type is missing', async () => {
    const device = await seedDevice();

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ severity: 'low' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid severity', async () => {
    const device = await seedDevice();

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'motion', severity: 'extreme' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/);
  });

  it('returns 202 with eventId on success', async () => {
    const device = await seedDevice();

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'motion_detected', severity: 'high', payload: { zone: 'A1' } });

    expect(res.status).toBe(202);
    expect(res.body.eventId).toBeDefined();
  });

  it('persists the event to the database', async () => {
    const device = await seedDevice();

    const res = await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'door_open', severity: 'medium', payload: { door: 'main' } });

    const { rows } = await dbQuery<{ type: string; severity: string; payload: object }>(
      'SELECT type, severity, payload FROM events WHERE id = $1',
      [res.body.eventId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('door_open');
    expect(rows[0].severity).toBe('medium');
    expect(rows[0].payload).toEqual({ door: 'main' });
  });

  it('updates the device status to online and sets last_seen', async () => {
    const device = await seedDevice();
    expect(device.status).toBe('offline');

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'heartbeat', severity: 'low' });

    const { rows } = await dbQuery<{ status: string; last_seen: string }>(
      'SELECT status, last_seen FROM devices WHERE id = $1',
      [device.id]
    );

    expect(rows[0].status).toBe('online');
    expect(rows[0].last_seen).not.toBeNull();
  });

  it('scopes the event insert to the device org (RLS enforced)', async () => {
    const device = await seedDevice(DEMO_ORG_ID);

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'motion', severity: 'low' });

    const { rows } = await dbQuery<{ org_id: string }>(
      'SELECT org_id FROM events WHERE device_id = $1',
      [device.id]
    );

    expect(rows[0].org_id).toBe(DEMO_ORG_ID);
  });
});

// ── GET /events ────────────────────────────────────────────────────────────────

describe('GET /events', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/events');
    expect(res.status).toBe(401);
  });

  it('returns 200 with an empty list when org has no events', async () => {
    const user = await seedUser();

    const res = await request(app)
      .get('/events')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it('returns events with device name included', async () => {
    const user   = await seedUser();
    const device = await seedDevice(DEMO_ORG_ID, { name: 'Named Sensor' });

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'motion', severity: 'low' });

    const res = await request(app)
      .get('/events')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].device_name).toBe('Named Sensor');
  });

  it('returns pagination metadata', async () => {
    const user = await seedUser();

    const res = await request(app)
      .get('/events?limit=10&offset=5')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(5);
  });

  it('caps limit at 200', async () => {
    const user = await seedUser();

    const res = await request(app)
      .get('/events?limit=9999')
      .set('Authorization', authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it('filters by severity', async () => {
    const user   = await seedUser();
    const device = await seedDevice();

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'alarm', severity: 'critical' });

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'heartbeat', severity: 'low' });

    const res = await request(app)
      .get('/events?severity=critical')
      .set('Authorization', authHeader(user));

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].severity).toBe('critical');
  });

  it('filters by deviceId', async () => {
    const user    = await seedUser();
    const device1 = await seedDevice(DEMO_ORG_ID, { name: 'Device 1' });
    const device2 = await seedDevice(DEMO_ORG_ID, { name: 'Device 2' });

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device1.api_key)
      .send({ type: 'motion', severity: 'low' });

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device2.api_key)
      .send({ type: 'motion', severity: 'low' });

    const res = await request(app)
      .get(`/events?deviceId=${device1.id}`)
      .set('Authorization', authHeader(user));

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].device_name).toBe('Device 1');
  });

  it('returns events ordered by created_at descending', async () => {
    const user   = await seedUser();
    const device = await seedDevice();

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'first', severity: 'low' });

    await request(app)
      .post('/events/ingest')
      .set('X-Device-Key', device.api_key)
      .send({ type: 'second', severity: 'high' });

    const res = await request(app)
      .get('/events')
      .set('Authorization', authHeader(user));

    expect(res.body.events[0].type).toBe('second');
    expect(res.body.events[1].type).toBe('first');
  });
});

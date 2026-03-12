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

jest.mock('bcrypt', () => ({
  hash:    jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { query } from '../../db';
import bcrypt from 'bcrypt';

const mockQuery   = query   as jest.MockedFunction<typeof query>;
const mockCompare = bcrypt.compare as jest.MockedFunction<typeof bcrypt.compare>;

function dbRow<T>(row: T) {
  return { rows: [row], rowCount: 1 } as never;
}

function dbEmpty() {
  return { rows: [], rowCount: 0 } as never;
}

// ── POST /auth/register ────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ password: 'pw', orgId: 'org-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.com', orgId: 'org-1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.com', password: 'pw' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid role', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.com', password: 'pw', orgId: 'org-1', role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  it('returns 409 on duplicate email (pg error 23505)', async () => {
    const pgError = Object.assign(new Error('duplicate'), { code: '23505' });
    mockQuery.mockRejectedValue(pgError);

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.com', password: 'pw', orgId: 'org-1' });
    expect(res.status).toBe(409);
  });

  it('returns 201 with the created user on success', async () => {
    const user = { id: 'u-1', org_id: 'org-1', email: 'a@b.com', role: 'operator', created_at: new Date().toISOString() };
    mockQuery.mockResolvedValue(dbRow(user));

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'A@B.COM', password: 'pw', orgId: 'org-1' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'a@b.com', role: 'operator' });
  });

  it('defaults role to operator when not provided', async () => {
    const user = { id: 'u-1', org_id: 'org-1', email: 'a@b.com', role: 'operator', created_at: '' };
    mockQuery.mockResolvedValue(dbRow(user));

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.com', password: 'pw', orgId: 'org-1' });

    expect(res.status).toBe(201);
    // The INSERT query should have received 'operator' as the role value
    expect(mockQuery.mock.calls[0][1]).toContain('operator');
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'pw' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when user does not exist', async () => {
    mockQuery.mockResolvedValue(dbEmpty());

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@b.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid credentials');
  });

  it('returns 401 when password does not match', async () => {
    const user = { id: 'u-1', org_id: 'org-1', email: 'a@b.com', role: 'operator', password_hash: 'hashed' };
    mockQuery.mockResolvedValue(dbRow(user));
    mockCompare.mockResolvedValue(false as never);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid credentials');
  });

  it('returns 200 with a valid JWT on success', async () => {
    const user = { id: 'u-1', org_id: 'org-1', email: 'a@b.com', role: 'operator', password_hash: 'hashed' };
    mockQuery.mockResolvedValue(dbRow(user));
    mockCompare.mockResolvedValue(true as never);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'correct' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({ email: 'a@b.com', role: 'operator' });

    // Verify the JWT is actually valid and carries the right claims
    const decoded = jwt.verify(res.body.token, 'test-secret') as Record<string, string>;
    expect(decoded.sub).toBe('u-1');
    expect(decoded.orgId).toBe('org-1');
    expect(decoded.role).toBe('operator');
  });

  it('looks up user by lowercased email', async () => {
    mockQuery.mockResolvedValue(dbEmpty());

    await request(app)
      .post('/auth/login')
      .send({ email: 'A@B.COM', password: 'pw' });

    expect(mockQuery.mock.calls[0][1]).toContain('a@b.com');
  });
});

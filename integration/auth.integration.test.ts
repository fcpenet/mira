import request from 'supertest';
import app from '../src/app';
import { truncateAll, dbQuery } from './helpers/db';
import { seedUser, DEMO_ORG_ID } from './helpers/seed';

beforeEach(truncateAll);

// ── POST /auth/register ────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('creates a user and returns 201', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'Secure123!',
      orgId: DEMO_ORG_ID,
      role: 'operator',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'alice@example.com',
      role: 'operator',
      org_id: DEMO_ORG_ID,
    });
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('stores email in lower-case', async () => {
    await request(app).post('/auth/register').send({
      email: 'UPPER@EXAMPLE.COM',
      password: 'Secure123!',
      orgId: DEMO_ORG_ID,
    });

    const { rows } = await dbQuery(
      'SELECT email FROM users WHERE email = $1',
      ['upper@example.com']
    );
    expect(rows).toHaveLength(1);
  });

  it('stores a bcrypt hash — not the plain-text password', async () => {
    await request(app).post('/auth/register').send({
      email: 'bob@example.com',
      password: 'MySecret!',
      orgId: DEMO_ORG_ID,
    });

    const { rows } = await dbQuery<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['bob@example.com']
    );
    expect(rows[0].password_hash).toMatch(/^\$2[ab]\$/); // bcrypt prefix
    expect(rows[0].password_hash).not.toBe('MySecret!');
  });

  it('defaults role to operator when not specified', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'carol@example.com',
      password: 'Secure123!',
      orgId: DEMO_ORG_ID,
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('operator');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/auth/register').send({
      password: 'Secure123!',
      orgId: DEMO_ORG_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'dave@example.com',
      orgId: DEMO_ORG_ID,
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid role', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'eve@example.com',
      password: 'Secure123!',
      orgId: DEMO_ORG_ID,
      role: 'superadmin',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  it('returns 500 (unique violation) when email already exists', async () => {
    await seedUser(DEMO_ORG_ID, { email: 'dup@example.com' });

    const res = await request(app).post('/auth/register').send({
      email: 'dup@example.com',
      password: 'AnotherPass!',
      orgId: DEMO_ORG_ID,
    });

    // PostgreSQL unique constraint violation — app lets it bubble as a 500
    expect(res.status).toBe(500);
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 200 with a JWT token on valid credentials', async () => {
    const user = await seedUser(DEMO_ORG_ID, { email: 'frank@example.com', password: 'Pass123!' });

    const res = await request(app).post('/auth/login').send({
      email: 'frank@example.com',
      password: 'Pass123!',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({
      email: 'frank@example.com',
      role: user.role,
      orgId: DEMO_ORG_ID,
    });
  });

  it('token contains the correct claims', async () => {
    const user = await seedUser(DEMO_ORG_ID, { email: 'grace@example.com', role: 'admin' });

    const res = await request(app).post('/auth/login').send({
      email: 'grace@example.com',
      password: user.password,
    });

    const decoded = JSON.parse(
      Buffer.from(res.body.token.split('.')[1], 'base64url').toString()
    );
    expect(decoded.orgId).toBe(DEMO_ORG_ID);
    expect(decoded.role).toBe('admin');
    expect(decoded.email).toBe('grace@example.com');
  });

  it('returns 401 when the password is wrong', async () => {
    await seedUser(DEMO_ORG_ID, { email: 'henry@example.com', password: 'CorrectPass!' });

    const res = await request(app).post('/auth/login').send({
      email: 'henry@example.com',
      password: 'WrongPass!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid credentials');
  });

  it('returns 401 when the email does not exist', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'AnyPass!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid credentials');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'Pass123!' });
    expect(res.status).toBe(400);
  });

  it('is case-insensitive for email', async () => {
    await seedUser(DEMO_ORG_ID, { email: 'ian@example.com' });

    const res = await request(app).post('/auth/login').send({
      email: 'IAN@EXAMPLE.COM',
      password: 'Password1!',
    });

    expect(res.status).toBe(200);
  });
});

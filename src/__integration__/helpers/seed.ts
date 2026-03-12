import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { dbQuery } from './db';
import { UserRole, DeviceType } from '../../types';

// The demo org inserted by 001_init.sql — always present, never truncated.
export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';

export interface SeededUser {
  id: string;
  org_id: string;
  email: string;
  role: UserRole;
  password: string; // plain-text — used in login tests
}

export interface SeededDevice {
  id: string;
  org_id: string;
  name: string;
  type: DeviceType;
  api_key: string;
  status: string;
}

let _userCounter = 0;

export async function seedUser(
  orgId = DEMO_ORG_ID,
  overrides: Partial<{ email: string; password: string; role: UserRole }> = {}
): Promise<SeededUser> {
  const password = overrides.password ?? 'Password1!';
  const email    = overrides.email    ?? `user${++_userCounter}@test.com`;
  const role     = overrides.role     ?? 'operator';

  const hash = await bcrypt.hash(password, 4); // low cost for tests

  const { rows } = await dbQuery<{ id: string; org_id: string; email: string; role: UserRole }>(
    `INSERT INTO users (org_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, org_id, email, role`,
    [orgId, email, hash, role]
  );

  return { ...rows[0], password };
}

export async function seedDevice(
  orgId = DEMO_ORG_ID,
  overrides: Partial<{ name: string; type: DeviceType }> = {}
): Promise<SeededDevice> {
  const name = overrides.name ?? 'Test Sensor';
  const type = overrides.type ?? 'sensor';

  const { rows } = await dbQuery<SeededDevice>(
    `INSERT INTO devices (org_id, name, type)
     VALUES ($1, $2, $3)
     RETURNING id, org_id, name, type, api_key, status`,
    [orgId, name, type]
  );

  return rows[0];
}

/**
 * Issue a signed JWT for use as a Bearer token in test requests.
 * Uses the same secret set by globalSetup (JWT_SECRET env var).
 */
export function makeToken(user: Pick<SeededUser, 'id' | 'org_id' | 'email' | 'role'>): string {
  return jwt.sign(
    { orgId: user.org_id, role: user.role, email: user.email },
    process.env.JWT_SECRET!,
    { subject: user.id, expiresIn: '1h' }
  );
}

export function authHeader(user: Pick<SeededUser, 'id' | 'org_id' | 'email' | 'role'>): string {
  return `Bearer ${makeToken(user)}`;
}

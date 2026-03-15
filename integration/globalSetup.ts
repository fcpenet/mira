import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

// Written by globalSetup, read by globalTeardown to stop containers
const STATE_FILE = path.join(__dirname, '.integration-state.json');

export default async function globalSetup() {
  console.log('\n[setup] starting PostgreSQL container...');
  const pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('mira')
    .withUsername('mira')
    .withPassword('mira')
    .start();

  console.log('[setup] starting Redis container...');
  const redisContainer = await new RedisContainer('redis:7-alpine').start();

  // ── Run migrations ─────────────────────────────────────────────────────────
  const pool = new Pool({
    host:     pgContainer.getHost(),
    port:     pgContainer.getMappedPort(5432),
    database: 'mira',
    user:     'mira',
    password: 'mira',
  });

  const migrationDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    console.log(`[setup] running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
  }

  // ── Grant mira_app role to the connecting user ─────────────────────────────
  // Required so queryAsOrg's SET LOCAL ROLE mira_app works, which in turn
  // makes PostgreSQL RLS policies apply to integration test queries.
  await pool.query('GRANT mira_app TO mira');

  await pool.end();

  // ── Expose connection info to test workers via process.env ─────────────────
  // globalSetup runs before workers are spawned, so env vars set here are
  // inherited by all test worker processes.
  process.env.DB_HOST     = pgContainer.getHost();
  process.env.DB_PORT     = String(pgContainer.getMappedPort(5432));
  process.env.DB_NAME     = 'mira';
  process.env.DB_USER     = 'mira';
  process.env.DB_PASSWORD = 'mira';

  process.env.REDIS_HOST = redisContainer.getHost();
  process.env.REDIS_PORT = String(redisContainer.getMappedPort(6379));

  process.env.JWT_SECRET    = 'integration-test-secret';
  process.env.JWT_EXPIRES_IN = '8h';

  // ── Persist container IDs for teardown ────────────────────────────────────
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    pgContainerId:    pgContainer.getId(),
    redisContainerId: redisContainer.getId(),
  }));

  console.log('[setup] containers ready\n');
}

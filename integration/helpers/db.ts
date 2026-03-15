import { Pool, QueryResultRow } from 'pg';

// Lazy singleton — created on first use (after globalSetup has set env vars)
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
  }
  return _pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) {
  return getPool().query<T>(text, values);
}

/**
 * Truncate all application tables between tests.
 * Organizations are NOT truncated — the seeded demo org is reused.
 * CASCADE handles FK-dependent rows automatically.
 */
export async function truncateAll(): Promise<void> {
  await getPool().query(
    'TRUNCATE TABLE events, devices, users RESTART IDENTITY CASCADE'
  );
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

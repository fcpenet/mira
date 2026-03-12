import { Pool, QueryResult, QueryResultRow } from 'pg';
import config from '../config';

const pool = new Pool(config.db);

pool.on('error', (err: Error) => {
  console.error('[db] unexpected client error:', err.message);
});

/**
 * Run a query scoped to an organization inside an explicit transaction.
 *
 * SET LOCAL only takes effect within a transaction block — without BEGIN,
 * it behaves like SET (session-level) and bleeds across pooled connections.
 *
 * SET LOCAL ROLE mira_app is required for PostgreSQL RLS policies to apply;
 * superuser connections bypass RLS unless the role is explicitly switched.
 * SET LOCAL reverts both settings automatically on COMMIT or ROLLBACK.
 */
async function queryAsOrg<T extends QueryResultRow = QueryResultRow>(
  orgId: string,
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE mira_app');
    await client.query(`SET LOCAL app.current_org_id = '${orgId}'`);
    const result = await client.query<T>(text, values);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run an unscoped query (migrations, device api-key lookup before org is known).
 */
async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export { pool, query, queryAsOrg };

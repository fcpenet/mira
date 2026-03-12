import { Pool, QueryResult, QueryResultRow } from 'pg';
import config from '../config';

const pool = new Pool(config.db);

pool.on('error', (err: Error) => {
  console.error('[db] unexpected client error:', err.message);
});

/**
 * Run a query scoped to an organization.
 * Sets app.current_org_id so PostgreSQL RLS policies can filter rows.
 */
async function queryAsOrg<T extends QueryResultRow = QueryResultRow>(
  orgId: string,
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL app.current_org_id = '${orgId}'`);
    return await client.query<T>(text, values);
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

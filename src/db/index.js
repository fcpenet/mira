const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('[db] unexpected client error:', err.message);
});

/**
 * Run a query scoped to an organization.
 * Sets app.current_org_id so PostgreSQL RLS policies can filter rows.
 */
async function queryAsOrg(orgId, text, values) {
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL app.current_org_id = '${orgId}'`);
    return await client.query(text, values);
  } finally {
    client.release();
  }
}

/**
 * Run an unscoped query (migrations, device api-key lookup before org is known).
 */
async function query(text, values) {
  return pool.query(text, values);
}

module.exports = { pool, query, queryAsOrg };

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { pool } = require('./db');
const { attachSocketServer } = require('./socket');
const config = require('./config');
const app    = require('./app');

async function runMigrations() {
  const migrationDir = path.join(__dirname, 'db', 'migrations');
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();

  // Ensure the migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE filename = $1', [file]);
    if (rows.length) continue;

    console.log(`[migrate] running ${file}`);
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    console.log(`[migrate] ${file} done`);
  }
}

async function start() {
  try {
    await runMigrations();

    const server = http.createServer(app);
    attachSocketServer(server);

    server.listen(config.port, () => {
      console.log(`[server] listening on port ${config.port}`);
    });
  } catch (err) {
    console.error('[server] startup failed:', err.message);
    process.exit(1);
  }
}

start();

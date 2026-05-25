const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

async function initDb() {
  if (pool) return pool;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migrationPath = path.join(__dirname, '../../../migrations/001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  await pool.query(sql);
  return pool;
}

function getPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

module.exports = { initDb, getPool };

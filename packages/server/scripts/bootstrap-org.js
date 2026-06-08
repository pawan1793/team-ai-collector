#!/usr/bin/env node
/**
 * Bootstrap first organization. Run inside server container or with DATABASE_URL set.
 */
require('../src/env'); // load .env before anything reads process.env
const { randomUUID } = require('crypto');
const { initDb, getPool } = require('../src/db');
const { hashApiKey, generateToken } = require('../src/auth');

async function main() {
  const name = process.argv.includes('--name')
    ? process.argv[process.argv.indexOf('--name') + 1]
    : 'Pilot Organization';

  await initDb();
  const orgId = `org_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const apiKey = `org_${generateToken().slice(0, 24)}`;
  const policies = {
    message_content: process.env.DEFAULT_MESSAGE_CONTENT || 'none',
    hash_project_paths: false,
    retention_days: 90,
  };

  await getPool().query(
    'INSERT INTO organizations (org_id, name, api_key_hash, policies) VALUES ($1, $2, $3, $4)',
    [orgId, name, hashApiKey(apiKey), JSON.stringify(policies)]
  );

  console.log(JSON.stringify({ org_id: orgId, name, org_api_key: apiKey, policies }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

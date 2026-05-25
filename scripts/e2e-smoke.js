#!/usr/bin/env node
/**
 * E2E smoke test (no Docker required if Postgres is on localhost:5432).
 * Usage: node scripts/e2e-smoke.js
 */
const { spawn } = require('child_process');
const http = require('http');
const { randomUUID } = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'e2e-admin-key';
const DEVICE_SECRET = 'e2e-device-secret';

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
process.env.ADMIN_API_KEY = ADMIN_KEY;
process.env.DEVICE_TOKEN_SECRET = DEVICE_SECRET;
process.env.DEFAULT_MESSAGE_CONTENT = 'none';
process.env.PORT = String(PORT);

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn('node', ['src/index.js'], {
    cwd: path.join(ROOT, 'packages/server'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const h = await request('GET', '/v1/health');
      if (h.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  if (!ready) {
    server.kill();
    throw new Error('Server did not become ready');
  }

  try {
    const orgRes = await request('POST', '/v1/admin/orgs', { name: 'E2E Org' }, {
      'X-Admin-Key': ADMIN_KEY,
    });
    if (orgRes.status !== 201) throw new Error(`org create: ${JSON.stringify(orgRes.body)}`);
    const { org_api_key, org_id } = orgRes.body;

    const authRes = await request('POST', '/v1/auth/device', {
      org_api_key,
      email: 'e2e@example.com',
      device_name: 'e2e',
    });
    if (authRes.status !== 200) throw new Error(`auth: ${JSON.stringify(authRes.body)}`);
    const { device_token, user_id, device_id } = authRes.body;

    const syncId = randomUUID();
    const now = Date.now();
    const syncRes = await request(
      'POST',
      '/v1/sync',
      {
        schema_version: '1.0',
        sync_id: syncId,
        sent_at: now,
        client: { name: 'e2e', version: '0.1.0', platform: 'test' },
        user: { user_id, email: 'e2e@example.com', device_id },
        cursor: { since: 0 },
        sessions: [
          {
            session_id: 'e2e-s1',
            source: 'claude-code',
            name: 'E2E session',
            last_updated_at: now,
          },
        ],
        session_stats: [
          {
            session_id: 'e2e-s1',
            total_messages: 1,
            total_input_tokens: 10,
            total_output_tokens: 5,
          },
        ],
        messages: [],
      },
      {
        Authorization: `Bearer ${device_token}`,
        'X-Org-Id': org_id,
        'X-Schema-Version': '1.0',
      }
    );
    if (syncRes.status !== 200 || !syncRes.body.ok) {
      throw new Error(`sync: ${JSON.stringify(syncRes.body)}`);
    }

    const dup = await request(
      'POST',
      '/v1/sync',
      {
        schema_version: '1.0',
        sync_id: syncId,
        sent_at: now,
        client: { name: 'e2e', version: '0.1.0', platform: 'test' },
        user: { user_id, email: 'e2e@example.com', device_id },
        cursor: { since: 0 },
        sessions: [],
        session_stats: [],
        messages: [],
      },
      {
        Authorization: `Bearer ${device_token}`,
        'X-Org-Id': org_id,
        'X-Schema-Version': '1.0',
      }
    );
    if (dup.status !== 200) throw new Error('idempotent replay failed');

    const bad = await request(
      'POST',
      '/v1/sync',
      {
        schema_version: '1.0',
        sync_id: randomUUID(),
        sent_at: now,
        client: { name: 'e2e', version: '0.1.0', platform: 'test' },
        user: { user_id, email: 'e2e@example.com', device_id },
        cursor: { since: 0 },
        sessions: [],
        session_stats: [],
        messages: [{ session_id: 'e2e-s1', seq: 0, role: 'user', content: 'nope' }],
      },
      {
        Authorization: `Bearer ${device_token}`,
        'X-Org-Id': org_id,
        'X-Schema-Version': '1.0',
      }
    );
    if (bad.status !== 403) throw new Error('expected POLICY_VIOLATION for messages');

    const overview = await request('GET', '/v1/team/overview?from=0&to=' + now, null, {
      'X-Org-Api-Key': org_api_key,
    });
    if (overview.status !== 200) throw new Error(`overview: ${JSON.stringify(overview.body)}`);

    console.log('E2E smoke passed.');
    console.log('  sessions ingested:', syncRes.body.accepted?.sessions);
    console.log('  overview total_sessions:', overview.body.total_sessions);
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error('E2E failed:', err.message);
  process.exit(1);
});

require('../src/env'); // load .env before anything reads process.env
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('crypto');
const http = require('http');

const BASE = process.env.TEST_API_BASE || 'http://localhost:8080';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'change-me-admin-key';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
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

test('sync idempotency and message policy', { skip: !process.env.RUN_INTEGRATION_TESTS }, async () => {
  const orgRes = await request('POST', '/v1/admin/orgs', { name: 'Test Org' }, {
    'X-Admin-Key': ADMIN_KEY,
  });
  assert.equal(orgRes.status, 201);
  const { org_api_key, org_id } = orgRes.body;

  const authRes = await request('POST', '/v1/auth/device', {
    org_api_key,
    email: 'test@example.com',
    device_name: 'test-device',
  });
  assert.equal(authRes.status, 200);
  const { device_token, user_id, device_id } = authRes.body;

  const syncId = randomUUID();
  const payload = {
    schema_version: '1.0',
    sync_id: syncId,
    sent_at: Date.now(),
    client: { name: 'test', version: '0.1.0', platform: 'test' },
    user: { user_id, email: 'test@example.com', device_id },
    cursor: { since: 0 },
    sessions: [
      {
        session_id: 'sess-1',
        source: 'claude-code',
        name: 'Test session',
        last_updated_at: Date.now(),
        message_count: 0,
      },
    ],
    session_stats: [
      {
        session_id: 'sess-1',
        total_messages: 0,
        total_input_tokens: 100,
        total_output_tokens: 50,
      },
    ],
    messages: [],
  };

  const headers = {
    Authorization: `Bearer ${device_token}`,
    'X-Org-Id': org_id,
    'X-Schema-Version': '1.0',
  };

  const r1 = await request('POST', '/v1/sync', payload, headers);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);

  const r2 = await request('POST', '/v1/sync', payload, headers);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);

  const withMessages = {
    ...payload,
    sync_id: randomUUID(),
    messages: [{ session_id: 'sess-1', seq: 0, role: 'user', content: 'secret' }],
  };
  const r3 = await request('POST', '/v1/sync', withMessages, headers);
  assert.equal(r3.status, 403);
});

test('cost, account and model distribution flow through to team API', { skip: !process.env.RUN_INTEGRATION_TESTS }, async () => {
  const orgRes = await request('POST', '/v1/admin/orgs', { name: 'Cost Org' }, {
    'X-Admin-Key': ADMIN_KEY,
  });
  assert.equal(orgRes.status, 201);
  const { org_api_key, org_id } = orgRes.body;

  const authRes = await request('POST', '/v1/auth/device', {
    org_api_key,
    email: 'cost@example.com',
    device_name: 'cost-device',
  });
  assert.equal(authRes.status, 200);
  const { device_token, user_id, device_id } = authRes.body;

  const headers = {
    Authorization: `Bearer ${device_token}`,
    'X-Org-Id': org_id,
    'X-Schema-Version': '1.0',
  };
  const now = Date.now();

  // Sync WITH account + a known model → cost must be computed and stored.
  const payload = {
    schema_version: '1.0',
    sync_id: randomUUID(),
    sent_at: now,
    client: { name: 'test', version: '0.1.0', platform: 'test' },
    user: { user_id, email: 'cost@example.com', device_id },
    account: 'vibe2',
    cursor: { since: 0 },
    sessions: [
      { session_id: 'cost-1', source: 'claude-code', name: 'Cost session', last_updated_at: now, message_count: 2 },
    ],
    session_stats: [
      {
        session_id: 'cost-1',
        total_messages: 2,
        models: ['claude-sonnet-4', 'claude-sonnet-4', 'gpt-5'],
        total_input_tokens: 1_000_000,
        total_output_tokens: 1_000_000,
        total_cache_read: 0,
        total_cache_write: 0,
      },
    ],
    messages: [],
  };
  const r1 = await request('POST', '/v1/sync', payload, headers);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);

  const orgHeaders = { 'X-Org-Api-Key': org_api_key };
  const from = now - 24 * 60 * 60 * 1000;
  const to = now + 60_000;

  // Members: account + non-null estimated cost (claude-sonnet-4: 3 + 15 per 1M in/out = 18).
  const members = await request('GET', `/v1/team/members?from=${from}&to=${to}`, null, orgHeaders);
  assert.equal(members.status, 200);
  const me = members.body.members.find((m) => m.user_id === user_id);
  assert.ok(me, 'member present');
  assert.equal(me.account, 'vibe2');
  assert.ok(Math.abs(Number(me.estimated_cost) - 18) < 1e-6, `cost was ${me.estimated_cost}`);
  assert.ok(Array.isArray(me.model_distribution) && me.model_distribution.length >= 1);

  // Overview: total_cost + model distribution + account filter.
  const overview = await request('GET', `/v1/team/overview?from=${from}&to=${to}`, null, orgHeaders);
  assert.equal(overview.status, 200);
  assert.ok(Math.abs(Number(overview.body.total_cost) - 18) < 1e-6);
  assert.ok(overview.body.model_distribution.length >= 2);
  const pctSum = overview.body.model_distribution.reduce((a, d) => a + Number(d.pct), 0);
  assert.ok(Math.abs(pctSum - 100) <= 0.5, `pct sum ${pctSum}`);

  const filtered = await request('GET', `/v1/team/overview?from=${from}&to=${to}&account=vibe3`, null, orgHeaders);
  assert.equal(filtered.status, 200);
  assert.equal(Number(filtered.body.total_cost), 0); // no vibe3 users

  // Backward compat: a legacy payload WITHOUT account still succeeds.
  const legacy = {
    ...payload,
    sync_id: randomUUID(),
    sessions: [{ session_id: 'cost-2', source: 'claude-code', last_updated_at: now, message_count: 0 }],
    session_stats: [{ session_id: 'cost-2', total_messages: 0, total_input_tokens: 10, total_output_tokens: 5 }],
  };
  delete legacy.account;
  const r2 = await request('POST', '/v1/sync', legacy, headers);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.ok, true);
});

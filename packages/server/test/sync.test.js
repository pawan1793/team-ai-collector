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

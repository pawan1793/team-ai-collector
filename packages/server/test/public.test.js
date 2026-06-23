require('../src/env'); // load .env before anything reads process.env
const { test } = require('node:test');
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

// Creates an org whose policy allows storing message content, registers a
// device, and syncs one session with mixed-role messages.
async function seedOrg(email) {
  const orgRes = await request(
    'POST',
    '/v1/admin/orgs',
    { name: 'Public API Test Org', policies: { message_content: 'full' } },
    { 'X-Admin-Key': ADMIN_KEY }
  );
  assert.equal(orgRes.status, 201);
  const { org_api_key, org_id } = orgRes.body;

  const authRes = await request('POST', '/v1/auth/device', {
    org_api_key,
    email,
    device_name: 'test-device',
  });
  assert.equal(authRes.status, 200);
  const { device_token, user_id, device_id } = authRes.body;

  const t0 = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
  const t1 = Date.now(); // now

  const headers = {
    Authorization: `Bearer ${device_token}`,
    'X-Org-Id': org_id,
    'X-Schema-Version': '1.0',
  };

  // Two sessions at different times so the date filter has something to bite on.
  await request(
    'POST',
    '/v1/sync',
    {
      schema_version: '1.0',
      sync_id: randomUUID(),
      sent_at: Date.now(),
      client: { name: 'test', version: '0.1.0', platform: 'test' },
      user: { user_id, email, device_id },
      cursor: { since: 0 },
      sessions: [
        { session_id: 'sess-old', source: 'claude-code', last_updated_at: t0, message_count: 4 },
        { session_id: 'sess-new', source: 'claude-code', last_updated_at: t1, message_count: 1 },
      ],
      session_stats: [
        { session_id: 'sess-old', total_messages: 4 },
        { session_id: 'sess-new', total_messages: 1 },
      ],
      messages: [
        { session_id: 'sess-old', seq: 0, role: 'system', content: 'sys' },
        { session_id: 'sess-old', seq: 1, role: 'user', content: 'old user msg', model: 'claude' },
        { session_id: 'sess-old', seq: 2, role: 'assistant', content: 'asst' },
        { session_id: 'sess-old', seq: 3, role: 'tool', content: 'tool' },
        { session_id: 'sess-new', seq: 0, role: 'user', content: 'new user msg', model: 'claude' },
      ],
    },
    headers
  );

  return { org_api_key, org_id, user_id, t0, t1 };
}

test('public users + messages APIs', { skip: !process.env.RUN_INTEGRATION_TESTS }, async () => {
  const { org_api_key, user_id, t0, t1 } = await seedOrg(`pub-${randomUUID()}@example.com`);
  const key = { 'X-Org-Api-Key': org_api_key };

  // --- API 1: users ---
  const users = await request('GET', '/v1/public/organization/users?page=1&pageSize=10', null, key);
  assert.equal(users.status, 200);
  assert.equal(users.body.page, 1);
  assert.equal(users.body.pageSize, 10);
  assert.ok(typeof users.body.total === 'number' && users.body.total >= 1);
  const me = users.body.users.find((u) => u.user_id === user_id);
  assert.ok(me, 'created user present in list');
  assert.ok('email' in me && 'name' in me && 'created_at' in me);
  assert.ok(!('status' in me), 'status field omitted');

  const usersNoKey = await request('GET', '/v1/public/organization/users');
  assert.equal(usersNoKey.status, 401);

  // --- API 2: messages ---
  const msgs = await request(
    'GET',
    `/v1/public/organization/users/${user_id}/messages`,
    null,
    key
  );
  assert.equal(msgs.status, 200);
  // Only the two user messages; system/assistant/tool excluded.
  assert.equal(msgs.body.total, 2);
  assert.equal(msgs.body.messages.length, 2);
  for (const m of msgs.body.messages) {
    assert.ok(m.message_id && m.user_id === user_id);
    assert.ok('content' in m && 'timestamp' in m);
    assert.deepEqual(Object.keys(m.metadata).sort(), ['model', 'source']);
    assert.ok(!('input_tokens' in m.metadata) && !('output_tokens' in m.metadata));
  }

  // Date filter: only sessions after t0 (exclusive of the old one).
  const filtered = await request(
    'GET',
    `/v1/public/organization/users/${user_id}/messages?startDate=${t0 + 1}&endDate=${t1 + 1}`,
    null,
    key
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1, 'only the recent user message remains');

  // 400 invalid date
  const badDate = await request(
    'GET',
    `/v1/public/organization/users/${user_id}/messages?startDate=not-a-date`,
    null,
    key
  );
  assert.equal(badDate.status, 400);

  // 401 missing key
  const noKey = await request('GET', `/v1/public/organization/users/${user_id}/messages`);
  assert.equal(noKey.status, 401);

  // 404 unknown user
  const notFound = await request(
    'GET',
    '/v1/public/organization/users/usr_doesnotexist/messages',
    null,
    key
  );
  assert.equal(notFound.status, 404);

  // 403 user belongs to a different org
  const other = await seedOrg(`other-${randomUUID()}@example.com`);
  const forbidden = await request(
    'GET',
    `/v1/public/organization/users/${other.user_id}/messages`,
    null,
    key
  );
  assert.equal(forbidden.status, 403);
});

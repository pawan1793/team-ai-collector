const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');
const { SCHEMA_VERSION, applyMessagePolicy } = require('@team-ai/shared');
const { getDb, getMeta, setMeta } = require('./db');
const { detectEditors } = require('@team-ai/adapters');
const { scanAll } = require('./scanner');

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const CLIENT_VERSION = '0.1.0';

function parseApiBase(apiBase) {
  const u = new URL(apiBase.replace(/\/$/, ''));
  return {
    scheme: u.protocol === 'https:' ? 'https' : 'http',
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    pathPrefix: u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''),
  };
}

function buildSyncPayload(config, since) {
  const db = getDb();
  const sessions = [];
  const session_stats = [];
  const messages = [];

  const chatRows = db
    .prepare(
      `SELECT id, source, name, mode, folder, created_at, last_updated_at, bubble_count
       FROM chats WHERE last_updated_at IS NULL OR last_updated_at > ?`
    )
    .all(since);

  for (const chat of chatRows) {
    sessions.push({
      session_id: chat.id,
      source: chat.source,
      name: chat.name,
      mode: chat.mode,
      project_path: chat.folder,
      created_at: chat.created_at,
      last_updated_at: chat.last_updated_at,
      message_count: chat.bubble_count,
      encrypted: false,
    });

    const stat = db.prepare('SELECT * FROM chat_stats WHERE chat_id = ?').get(chat.id);
    if (stat) {
      session_stats.push({
        session_id: chat.id,
        total_messages: stat.total_messages,
        user_messages: stat.user_messages,
        assistant_messages: stat.assistant_messages,
        tool_messages: stat.tool_messages,
        system_messages: stat.system_messages,
        tool_calls: JSON.parse(stat.tool_calls || '[]'),
        models: JSON.parse(stat.models || '[]'),
        total_input_tokens: stat.total_input_tokens,
        total_output_tokens: stat.total_output_tokens,
        total_cache_read: stat.total_cache_read,
        total_cache_write: stat.total_cache_write,
        total_user_chars: stat.total_user_chars,
        total_assistant_chars: stat.total_assistant_chars,
        analyzed_at: stat.analyzed_at,
      });
    }

    const policy = config.privacy?.message_content || 'none';
    if (policy !== 'none') {
      const msgRows = db
        .prepare(
          'SELECT chat_id, seq, role, content, model, input_tokens, output_tokens FROM messages WHERE chat_id = ? ORDER BY seq'
        )
        .all(chat.id);
      const mapped = msgRows.map((m) => ({
        session_id: m.chat_id,
        seq: m.seq,
        role: m.role,
        content: m.content,
        model: m.model,
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
      }));
      messages.push(...applyMessagePolicy(mapped, policy));
    }
  }

  const payload = {
    schema_version: SCHEMA_VERSION,
    sync_id: randomUUID(),
    sent_at: Date.now(),
    client: {
      name: 'team-ai-collector',
      version: CLIENT_VERSION,
      platform: process.platform,
      node_version: process.version,
    },
    user: {
      user_id: config.user_id,
      email: config.user_email,
      device_id: config.device_id,
    },
    cursor: { since },
    summary: {
      sessions_scanned: chatRows.length,
      sessions_changed: sessions.length,
      messages_uploaded: messages.length,
    },
    sessions,
    session_stats,
    messages,
    heartbeat: {
      editors_detected: detectEditors(),
      collector_uptime_sec: Math.floor(process.uptime()),
    },
  };

  return payload;
}

function uploadSync(config, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) {
      return reject(new Error('Payload exceeds 5MB limit'));
    }

    const { scheme, host, port, pathPrefix } = parseApiBase(config.api_base);
    const path = `${pathPrefix}/v1/sync`;
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Authorization: `Bearer ${config.device_token}`,
      'X-Org-Id': config.org_id,
      'X-Schema-Version': SCHEMA_VERSION,
    };

    const client = scheme === 'https' ? https : http;
    const req = client.request(
      { hostname: host, port, path, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.code || parsed.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
    req.write(body);
    req.end();
  });
}

function enqueuePayload(payload) {
  getDb()
    .prepare('INSERT INTO outbound_queue (payload, created_at, attempts) VALUES (?, ?, 0)')
    .run(JSON.stringify(payload), Date.now());
}

async function flushQueue(config) {
  const rows = getDb()
    .prepare('SELECT id, payload, attempts FROM outbound_queue ORDER BY created_at ASC LIMIT 5')
    .all();
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    try {
      await uploadSync(config, payload);
      getDb().prepare('DELETE FROM outbound_queue WHERE id = ?').run(row.id);
    } catch {
      getDb()
        .prepare('UPDATE outbound_queue SET attempts = attempts + 1 WHERE id = ?')
        .run(row.id);
      break;
    }
  }
}

async function runSyncCycle(config, { verbose } = {}) {
  await flushQueue(config);
  scanAll(verbose ? console.log : null, { resetCaches: true });

  const since = parseInt(getMeta('cursor_since') || '0', 10);
  const payload = buildSyncPayload(config, since);

  try {
    const result = await uploadSync(config, payload);
    const nextSince = result.next_cursor?.since ?? Date.now();
    setMeta('cursor_since', String(nextSince));
    setMeta('last_sync_at', String(Date.now()));
    setMeta('last_sync_id', payload.sync_id);
    setMeta('last_sync_error', '');
    return result;
  } catch (err) {
    enqueuePayload(payload);
    setMeta('last_sync_error', err.message);
    throw err;
  }
}

function deviceLogin(apiBase, orgApiKey, email, deviceName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      org_api_key: orgApiKey,
      email,
      device_name: deviceName || require('os').hostname(),
    });
    const { scheme, host, port, pathPrefix } = parseApiBase(apiBase);
    const path = `${pathPrefix}/v1/auth/device`;
    const client = scheme === 'https' ? https : http;
    const req = client.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            else resolve(parsed);
          } catch {
            reject(new Error(data));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  buildSyncPayload,
  uploadSync,
  runSyncCycle,
  deviceLogin,
  flushQueue,
};

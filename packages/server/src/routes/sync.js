const express = require('express');
const { syncPayloadSchema } = require('@team-ai/shared');
const { getPool } = require('../db');
const { requireDeviceAuth } = require('../auth');

const router = express.Router();

const RATE_LIMIT_PER_HOUR = 120;

async function checkRateLimit(deviceId) {
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const pool = getPool();
  const row = await pool.query(
    `INSERT INTO rate_limits (device_id, window_start, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (device_id, window_start)
     DO UPDATE SET request_count = rate_limits.request_count + 1
     RETURNING request_count`,
    [deviceId, windowStart.toISOString()]
  );
  return row.rows[0].request_count <= RATE_LIMIT_PER_HOUR;
}

router.post('/', requireDeviceAuth(), async (req, res) => {
  try {
    const device = req.device;
    if (!(await checkRateLimit(device.device_id))) {
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED' });
    }

    const parsed = syncPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_SCHEMA',
        details: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;

    if (payload.user.user_id !== device.user_id || payload.user.device_id !== device.device_id) {
      return res.status(403).json({ ok: false, code: 'POLICY_VIOLATION', error: 'User mismatch' });
    }

    const pool = getPool();
    const existing = await pool.query(
      'SELECT response_json FROM sync_events WHERE sync_id = $1 AND status = $2',
      [payload.sync_id, 'ok']
    );
    if (existing.rows[0]?.response_json) {
      return res.json(existing.rows[0].response_json);
    }

    const orgRow = await pool.query('SELECT policies FROM organizations WHERE org_id = $1', [
      device.org_id,
    ]);
    const policies = orgRow.rows[0]?.policies || { message_content: 'none' };
    if (policies.message_content === 'none' && payload.messages.length > 0) {
      return res.status(403).json({
        ok: false,
        code: 'POLICY_VIOLATION',
        error: 'Message content not allowed for this org',
      });
    }

    const client = await pool.connect();
    let accepted = { sessions: 0, session_stats: 0, messages: 0 };
    try {
      await client.query('BEGIN');

      for (const s of payload.sessions) {
        await client.query(
          `INSERT INTO sessions (org_id, user_id, source, session_id, name, mode, project_path, created_at, last_updated_at, message_count, encrypted)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (org_id, user_id, source, session_id) DO UPDATE SET
             name = EXCLUDED.name, mode = EXCLUDED.mode, project_path = EXCLUDED.project_path,
             last_updated_at = EXCLUDED.last_updated_at, message_count = EXCLUDED.message_count`,
          [
            device.org_id,
            device.user_id,
            s.source,
            s.session_id,
            s.name,
            s.mode,
            s.project_path,
            s.created_at,
            s.last_updated_at,
            s.message_count || 0,
            s.encrypted || false,
          ]
        );
        accepted.sessions++;
      }

      for (const st of payload.session_stats) {
        const sess = payload.sessions.find((x) => x.session_id === st.session_id);
        const source = sess?.source || 'unknown';
        await client.query(
          `INSERT INTO session_stats (
            org_id, user_id, source, session_id,
            total_messages, user_messages, assistant_messages, tool_messages, system_messages,
            tool_calls, models, total_input_tokens, total_output_tokens,
            total_cache_read, total_cache_write, total_user_chars, total_assistant_chars, analyzed_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (org_id, user_id, source, session_id) DO UPDATE SET
            total_messages = EXCLUDED.total_messages,
            user_messages = EXCLUDED.user_messages,
            assistant_messages = EXCLUDED.assistant_messages,
            tool_messages = EXCLUDED.tool_messages,
            system_messages = EXCLUDED.system_messages,
            tool_calls = EXCLUDED.tool_calls,
            models = EXCLUDED.models,
            total_input_tokens = EXCLUDED.total_input_tokens,
            total_output_tokens = EXCLUDED.total_output_tokens,
            total_cache_read = EXCLUDED.total_cache_read,
            total_cache_write = EXCLUDED.total_cache_write,
            total_user_chars = EXCLUDED.total_user_chars,
            total_assistant_chars = EXCLUDED.total_assistant_chars,
            analyzed_at = EXCLUDED.analyzed_at`,
          [
            device.org_id,
            device.user_id,
            source,
            st.session_id,
            st.total_messages || 0,
            st.user_messages || 0,
            st.assistant_messages || 0,
            st.tool_messages || 0,
            st.system_messages || 0,
            JSON.stringify(st.tool_calls || []),
            JSON.stringify(st.models || []),
            st.total_input_tokens || 0,
            st.total_output_tokens || 0,
            st.total_cache_read || 0,
            st.total_cache_write || 0,
            st.total_user_chars || 0,
            st.total_assistant_chars || 0,
            st.analyzed_at || Date.now(),
          ]
        );
        accepted.session_stats++;
      }

      if (policies.message_content !== 'none') {
        for (const m of payload.messages) {
          const sess = payload.sessions.find((x) => x.session_id === m.session_id);
          const source = sess?.source || 'unknown';
          await client.query(
            `INSERT INTO messages (org_id, user_id, session_id, source, seq, role, content, model, input_tokens, output_tokens)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (org_id, user_id, session_id, seq) DO UPDATE SET
               role = EXCLUDED.role, content = EXCLUDED.content, model = EXCLUDED.model`,
            [
              device.org_id,
              device.user_id,
              m.session_id,
              source,
              m.seq,
              m.role,
              m.content,
              m.model,
              m.input_tokens,
              m.output_tokens,
            ]
          );
          accepted.messages++;
        }
      }

      await client.query('UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1', [
        device.device_id,
      ]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const nextCursor = { since: Date.now() };
    const response = {
      ok: true,
      sync_id: payload.sync_id,
      accepted,
      rejected: [],
      next_cursor: nextCursor,
      server_time: Date.now(),
      next_sync_after_sec: 3600,
    };

    await pool.query(
      `INSERT INTO sync_events (sync_id, org_id, user_id, device_id, status, response_json, bytes_in, sessions_count, messages_count)
       VALUES ($1,$2,$3,$4,'ok',$5,$6,$7,$8)`,
      [
        payload.sync_id,
        device.org_id,
        device.user_id,
        device.device_id,
        JSON.stringify(response),
        JSON.stringify(req.body).length,
        accepted.sessions,
        accepted.messages,
      ]
    );

    res.json(response);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

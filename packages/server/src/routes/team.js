const express = require('express');
const { getPool } = require('../db');
const { requireOrgApiKey } = require('../auth');

const router = express.Router();

function parseRange(req) {
  const now = Date.now();
  const to = req.query.to ? parseInt(req.query.to, 10) : now;
  const from = req.query.from ? parseInt(req.query.from, 10) : now - 7 * 24 * 60 * 60 * 1000;
  return { from, to };
}

router.get('/overview', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const pool = getPool();

    const stats = await pool.query(
      `SELECT
         COUNT(DISTINCT s.user_id) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS active_members,
         COUNT(DISTINCT s.session_id) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS total_sessions,
         COALESCE(SUM(st.total_messages) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_messages,
         COALESCE(SUM(st.total_input_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_input_tokens,
         COALESCE(SUM(st.total_output_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_output_tokens
       FROM sessions s
       LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       WHERE s.org_id = $1`,
      [orgId, from, to]
    );

    const bySource = await pool.query(
      `SELECT source, COUNT(*) AS sessions
       FROM sessions WHERE org_id = $1 AND COALESCE(last_updated_at, created_at) >= $2 AND COALESCE(last_updated_at, created_at) <= $3
       GROUP BY source ORDER BY sessions DESC`,
      [orgId, from, to]
    );

    res.json({
      org_id: orgId,
      from,
      to,
      ...stats.rows[0],
      by_source: bySource.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/members', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const rows = await getPool().query(
      `SELECT
         u.user_id, u.email, u.display_name,
         COUNT(DISTINCT s.session_id) AS sessions,
         COALESCE(SUM(st.total_messages), 0) AS messages,
         COALESCE(SUM(st.total_input_tokens), 0) AS input_tokens,
         COALESCE(SUM(st.total_output_tokens), 0) AS output_tokens,
         MAX(COALESCE(s.last_updated_at, s.created_at)) AS last_active_at
       FROM users u
       LEFT JOIN sessions s ON s.org_id = u.org_id AND s.user_id = u.user_id
         AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3
       LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       WHERE u.org_id = $1
       GROUP BY u.user_id, u.email, u.display_name
       ORDER BY last_active_at DESC NULLS LAST`,
      [orgId, from, to]
    );
    res.json({ members: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const userId = req.query.user_id;

    let sql = `SELECT s.*, st.total_messages, st.total_input_tokens, st.total_output_tokens
      FROM sessions s
      LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
        AND st.source = s.source AND st.session_id = s.session_id
      WHERE s.org_id = $1 AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3`;
    const params = [orgId, from, to];
    if (userId) {
      params.push(userId);
      sql += ` AND s.user_id = $${params.length}`;
    }
    sql += ` ORDER BY COALESCE(s.last_updated_at, s.created_at) DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rows = await getPool().query(sql, params);
    res.json({ sessions: rows.rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:id', requireOrgApiKey(), async (req, res) => {
  try {
    const orgId = req.org.org_id;
    const sessionId = req.params.id;
    const row = await getPool().query(
      `SELECT s.*, st.*
       FROM sessions s
       LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       WHERE s.org_id = $1 AND s.session_id = $2
       LIMIT 1`,
      [orgId, sessionId]
    );
    if (!row.rows[0]) return res.status(404).json({ error: 'Not found' });

    const policies = req.org.policies || {};
    let messages = [];
    if (policies.message_content !== 'none') {
      const msgs = await getPool().query(
        `SELECT seq, role, content, model FROM messages
         WHERE org_id = $1 AND session_id = $2 ORDER BY seq`,
        [orgId, sessionId]
      );
      messages = msgs.rows;
    }

    res.json({ session: row.rows[0], messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const { getPool } = require('../db');
const { requireOrgApiKey } = require('../auth');

const router = express.Router();

function parsePagination(req) {
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '50', 10) || 50, 1), 200);
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

// Accepts epoch-ms (numeric) or any Date.parse-able string. Returns epoch ms,
// or null when the value is absent. Throws on an unparseable value so callers
// can return 400.
function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+$/.test(String(value))) return parseInt(value, 10);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error('Invalid date format');
  return ms;
}

// GET /v1/public/organization/users
router.get('/organization/users', requireOrgApiKey(), async (req, res) => {
  try {
    const orgId = req.org.org_id;
    const { page, pageSize, limit, offset } = parsePagination(req);
    const pool = getPool();

    const rows = await pool.query(
      `SELECT user_id, display_name AS name, email, created_at
       FROM users WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    const count = await pool.query('SELECT COUNT(*)::int AS total FROM users WHERE org_id = $1', [
      orgId,
    ]);

    res.json({ users: rows.rows, total: count.rows[0].total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/public/organization/users/:userId/messages
router.get('/organization/users/:userId/messages', requireOrgApiKey(), async (req, res) => {
  try {
    const orgId = req.org.org_id;
    const userId = req.params.userId;
    const pool = getPool();

    // Ownership check: 404 if the user does not exist, 403 if it belongs to a
    // different organization than the API key.
    const userRow = await pool.query('SELECT org_id FROM users WHERE user_id = $1', [userId]);
    if (!userRow.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRow.rows[0].org_id !== orgId) {
      return res.status(403).json({ error: 'User does not belong to this organization' });
    }

    let startDate;
    let endDate;
    try {
      startDate = parseDate(req.query.startDate);
      endDate = parseDate(req.query.endDate);
    } catch {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const { page, pageSize, limit, offset } = parsePagination(req);

    // Messages have no timestamp of their own; derive it from the parent session.
    const where = `m.org_id = $1 AND m.user_id = $2 AND m.role = 'user'`;
    const params = [orgId, userId];
    let dateClause = '';
    if (startDate !== null) {
      params.push(startDate);
      dateClause += ` AND COALESCE(s.last_updated_at, s.created_at) >= $${params.length}`;
    }
    if (endDate !== null) {
      params.push(endDate);
      dateClause += ` AND COALESCE(s.last_updated_at, s.created_at) <= $${params.length}`;
    }

    const fromJoin = `FROM messages m
       JOIN sessions s
         ON s.org_id = m.org_id AND s.user_id = m.user_id
        AND s.source = m.source AND s.session_id = m.session_id
       WHERE ${where}${dateClause}`;

    const count = await pool.query(`SELECT COUNT(*)::int AS total ${fromJoin}`, params);

    const listParams = params.slice();
    listParams.push(limit, offset);
    const rows = await pool.query(
      `SELECT m.session_id, m.seq, m.user_id, m.content, m.model, m.source,
              COALESCE(s.last_updated_at, s.created_at) AS timestamp
       ${fromJoin}
       ORDER BY timestamp DESC, m.seq
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const messages = rows.rows.map((m) => ({
      message_id: `${m.session_id}:${m.seq}`,
      user_id: m.user_id,
      content: m.content,
      timestamp: m.timestamp,
      metadata: { model: m.model, source: m.source },
    }));

    res.json({ messages, total: count.rows[0].total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

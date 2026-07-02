const express = require('express');
const { getPool } = require('../db');
const { requireOrgApiKey } = require('../auth');
const { normalizeModelName } = require('../pricing');

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;

function parseRange(req) {
  const now = Date.now();
  const to = req.query.to ? parseInt(req.query.to, 10) : now;
  const from = req.query.from ? parseInt(req.query.from, 10) : now - 7 * DAY;
  return { from, to };
}

function accountFilter(req) {
  return req.query.account || null;
}

// Append an optional account constraint on sessions (via users lookup) and return the
// SQL fragment. orgId is always $1; the account value is pushed onto params.
function sessionAccountClause(account, params) {
  if (!account) return '';
  params.push(account);
  return ` AND s.user_id IN (SELECT user_id FROM users WHERE org_id = $1 AND account = $${params.length})`;
}

// Human-friendly label for a model key ("claude-sonnet-4" -> "Claude Sonnet 4").
const PROVIDER_CASE = { gpt: 'GPT', glm: 'GLM' };
function prettyModel(key) {
  if (!key) return 'Unknown';
  return key
    .split('-')
    .map((part) => PROVIDER_CASE[part] || (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

// Turn raw `{ model, count }` rows (raw model strings, possibly versioned/duplicated across
// keys) into a normalized, sorted distribution with percentages.
function buildDistribution(rows) {
  const counts = new Map();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.count) || 0;
    if (!n) continue;
    const key = normalizeModelName(r.model) || String(r.model || 'unknown');
    counts.set(key, (counts.get(key) || 0) + n);
    total += n;
  }
  const dist = [...counts.entries()]
    .map(([model, count]) => ({
      model,
      label: prettyModel(model),
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { distribution: dist, total };
}

router.get('/overview', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const account = accountFilter(req);
    const pool = getPool();

    const now = Date.now();
    const todayStart = now - DAY;
    const weekStart = now - 7 * DAY;
    const monthStart = now - 30 * DAY;

    // $1 orgId, $2 from, $3 to, $4 todayStart, $5 weekStart, $6 monthStart, $7 now
    const statsParams = [orgId, from, to, todayStart, weekStart, monthStart, now];
    const statsAccount = sessionAccountClause(account, statsParams);
    const stats = await pool.query(
      `SELECT
         COUNT(DISTINCT s.user_id) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS active_members,
         COUNT(DISTINCT s.session_id) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS total_sessions,
         COALESCE(SUM(st.total_messages) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_messages,
         COALESCE(SUM(st.total_input_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_input_tokens,
         COALESCE(SUM(st.total_output_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS total_output_tokens,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS selected_range_cost,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $4 AND COALESCE(s.last_updated_at, s.created_at) <= $7), 0) AS today_cost,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $5 AND COALESCE(s.last_updated_at, s.created_at) <= $7), 0) AS week_cost,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $6 AND COALESCE(s.last_updated_at, s.created_at) <= $7), 0) AS month_cost,
         COALESCE(SUM(st.estimated_cost), 0) AS total_cost
       FROM sessions s
       LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       WHERE s.org_id = $1${statsAccount}`,
      statsParams
    );

    const sourceParams = [orgId, from, to];
    const sourceAccount = sessionAccountClause(account, sourceParams);
    const bySource = await pool.query(
      `SELECT s.source, COUNT(*) AS sessions
       FROM sessions s
       WHERE s.org_id = $1 AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3${sourceAccount}
       GROUP BY s.source ORDER BY sessions DESC`,
      sourceParams
    );

    const modelParams = [orgId, from, to];
    const modelAccount = sessionAccountClause(account, modelParams);
    const modelRows = await pool.query(
      `SELECT m.model AS model, COUNT(*) AS count
       FROM sessions s
       JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       CROSS JOIN LATERAL jsonb_array_elements_text(st.models) AS m(model)
       WHERE s.org_id = $1 AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3${modelAccount}
       GROUP BY m.model`,
      modelParams
    );
    const { distribution, total } = buildDistribution(modelRows.rows);

    const row = stats.rows[0];
    res.json({
      org_id: orgId,
      from,
      to,
      account: account || null,
      ...row,
      by_source: bySource.rows,
      model_distribution: distribution,
      total_usage_count: total,
      total_token_count: Number(row.total_input_tokens || 0) + Number(row.total_output_tokens || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/members', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const account = accountFilter(req);
    const pool = getPool();

    const now = Date.now();
    const todayStart = now - DAY;

    // $1 orgId, $2 from, $3 to, $4 todayStart, $5 now [, $6 account]
    const params = [orgId, from, to, todayStart, now];
    let accountWhere = '';
    if (account) {
      params.push(account);
      accountWhere = ` AND u.account = $${params.length}`;
    }
    const members = await pool.query(
      `SELECT
         u.user_id, u.email, u.display_name, u.account,
         COUNT(DISTINCT s.session_id) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS sessions,
         COALESCE(SUM(st.total_messages) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS messages,
         COALESCE(SUM(st.total_input_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS input_tokens,
         COALESCE(SUM(st.total_output_tokens) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS output_tokens,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3), 0) AS estimated_cost,
         COALESCE(SUM(st.estimated_cost) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $4 AND COALESCE(s.last_updated_at, s.created_at) <= $5), 0) AS today_cost,
         COALESCE(SUM(st.estimated_cost), 0) AS total_cost,
         MAX(COALESCE(s.last_updated_at, s.created_at)) FILTER (WHERE COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3) AS last_active_at
       FROM users u
       LEFT JOIN sessions s ON s.org_id = u.org_id AND s.user_id = u.user_id
       LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       WHERE u.org_id = $1${accountWhere}
       GROUP BY u.user_id, u.email, u.display_name, u.account
       ORDER BY last_active_at DESC NULLS LAST`,
      params
    );

    // Per-member model distribution (Feature 4, user level).
    const distParams = [orgId, from, to];
    const distAccount = sessionAccountClause(account, distParams);
    const distRows = await pool.query(
      `SELECT s.user_id, m.model AS model, COUNT(*) AS count
       FROM sessions s
       JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
         AND st.source = s.source AND st.session_id = s.session_id
       CROSS JOIN LATERAL jsonb_array_elements_text(st.models) AS m(model)
       WHERE s.org_id = $1 AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3${distAccount}
       GROUP BY s.user_id, m.model`,
      distParams
    );
    const byUser = new Map();
    for (const r of distRows.rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r);
    }

    const rows = members.rows.map((m) => ({
      ...m,
      model_distribution: buildDistribution(byUser.get(m.user_id) || []).distribution,
    }));

    res.json({ members: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions', requireOrgApiKey(), async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const orgId = req.org.org_id;
    const account = accountFilter(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const userId = req.query.user_id;

    let sql = `SELECT s.*, st.total_messages, st.total_input_tokens, st.total_output_tokens,
        st.estimated_cost, st.cost_currency, st.cost_model
      FROM sessions s
      LEFT JOIN session_stats st ON st.org_id = s.org_id AND st.user_id = s.user_id
        AND st.source = s.source AND st.session_id = s.session_id
      WHERE s.org_id = $1 AND COALESCE(s.last_updated_at, s.created_at) >= $2 AND COALESCE(s.last_updated_at, s.created_at) <= $3`;
    const params = [orgId, from, to];
    sql += sessionAccountClause(account, params);
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

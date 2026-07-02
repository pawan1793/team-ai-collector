#!/usr/bin/env node
/**
 * Recalculate estimated_cost for every stored session from its token totals and
 * dominant model, using the current pricing table. Run this after editing
 * packages/server/src/pricing.json so historical costs reflect new prices.
 *
 * Usage (inside server container or with DATABASE_URL set):
 *   node packages/server/scripts/recalculate-costs.js
 *   npm run recalc:costs
 */
require('../src/env'); // load .env before anything reads process.env
const { initDb, getPool } = require('../src/db');
const { estimateCost, dominantModel } = require('../src/pricing');

async function main() {
  await initDb();
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT org_id, user_id, source, session_id, models,
            total_input_tokens, total_output_tokens, total_cache_read, total_cache_write
     FROM session_stats`
  );

  let updated = 0;
  let priced = 0;
  for (const st of rows) {
    const models = Array.isArray(st.models) ? st.models : [];
    const costModel = dominantModel(models);
    const { estimated_cost, currency } = estimateCost({
      model: costModel,
      input_tokens: Number(st.total_input_tokens) || 0,
      output_tokens: Number(st.total_output_tokens) || 0,
      cache_read_tokens: Number(st.total_cache_read) || 0,
      cache_write_tokens: Number(st.total_cache_write) || 0,
    });
    await pool.query(
      `UPDATE session_stats
       SET estimated_cost = $1, cost_currency = $2, cost_model = $3
       WHERE org_id = $4 AND user_id = $5 AND source = $6 AND session_id = $7`,
      [estimated_cost, currency, costModel, st.org_id, st.user_id, st.source, st.session_id]
    );
    updated++;
    if (estimated_cost != null) priced++;
  }

  console.log(
    JSON.stringify({ sessions_updated: updated, sessions_priced: priced }, null, 2)
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

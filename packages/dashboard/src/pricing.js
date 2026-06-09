// Frontend-only spend estimation. No data is persisted — this is computed in the
// browser from the per-session token totals the /v1/team/sessions/:id endpoint
// already returns (total_input_tokens, total_output_tokens, total_cache_read,
// total_cache_write, models).
//
// Prices are USD per 1M tokens. Source: Anthropic pricing (claude-api skill).
// Cache read ≈ 0.1× input; cache write (5-min TTL) ≈ 1.25× input.
const TIERS = [
  { match: /opus/i, label: 'Claude Opus', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /sonnet/i, label: 'Claude Sonnet', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /haiku/i, label: 'Claude Haiku', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
];

// Resolve a model name (e.g. "claude-opus-4-20250514") to its price tier, or null
// if we don't have authoritative pricing for it (e.g. non-Claude Cursor models).
export function tierForModel(model) {
  if (!model) return null;
  return TIERS.find((t) => t.match.test(model)) || null;
}

// Estimate spend for one session.
//
// session_stats aggregates token totals across all models used in the session, so
// when a session mixes pricing tiers (e.g. Opus + Sonnet) we can't cost it exactly
// from this table alone — we apply the first recognized tier and flag it as an
// estimate. Returns null when no model in the session has known pricing.
export function estimateSessionCost(session) {
  if (!session) return null;

  const models = Array.isArray(session.models) ? session.models : [];
  const tiers = models.map(tierForModel).filter(Boolean);
  const unpriced = models.filter((m) => !tierForModel(m));

  // Fall back to the first recognized tier; if models[] is empty (older rows),
  // we have no basis to price it.
  const tier = tiers[0];
  if (!tier) return null;

  const inTok = Number(session.total_input_tokens || 0);
  const outTok = Number(session.total_output_tokens || 0);
  const cacheRead = Number(session.total_cache_read || 0);
  const cacheWrite = Number(session.total_cache_write || 0);

  const usd =
    (inTok / 1e6) * tier.input +
    (outTok / 1e6) * tier.output +
    (cacheRead / 1e6) * tier.cacheRead +
    (cacheWrite / 1e6) * tier.cacheWrite;

  // Distinct price tiers in the session → blended/estimated rather than exact.
  const distinctTiers = new Set(tiers.map((t) => t.label));
  const estimated = distinctTiers.size > 1 || unpriced.length > 0;

  return { usd, tier, estimated, unpriced };
}

export function formatUsd(usd) {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

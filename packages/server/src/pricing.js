// Centralized model pricing + cost calculation (ModelPricingService / CostCalculatorService).
// Load pricing data from JSON – edit pricing.json to add/update models. Do NOT hardcode
// prices elsewhere in the codebase; always go through this module.
const _raw = require('./pricing.json');
const MODEL_PRICING = Object.fromEntries(
  Object.entries(_raw).filter(([k]) => !k.startsWith('_'))
);

// Normalize a model identifier to match pricing keys
// Handles versioned names like "claude-sonnet-4-20250514", "gpt-4o-2024-08-06", etc.
function normalizeModelName(name) {
  if (!name) return null;
  let n = name.toLowerCase().trim();

  // Strip leading provider prefixes (e.g. "anthropic/claude-..." or "openai/gpt-...")
  const slashIdx = n.lastIndexOf('/');
  if (slashIdx !== -1) n = n.substring(slashIdx + 1);

  // Strip dot-delimited provider prefixes (e.g. "us.anthropic.claude-sonnet-4-6")
  // Only strip if all prefix segments are simple words (no dashes), to avoid
  // splitting version dots like "claude-4.6-opus"
  const dotParts = n.split('.');
  if (dotParts.length > 1) {
    const prefixes = dotParts.slice(0, -1);
    const last = dotParts[dotParts.length - 1];
    if (last.includes('-') && prefixes.every((p) => !p.includes('-'))) n = last;
  }

  // Handle MODEL_CLAUDE_* / MODEL_GPT_* enum constants
  if (n.startsWith('model_')) {
    n = n.substring(6).replace(/_/g, '-');
  }

  // Build candidate list: original + dots→dashes + reversed claude names
  const candidates = [n];
  if (n.includes('.')) candidates.push(n.replace(/\./g, '-'));

  // Rearrange reversed claude names: "claude-4-6-opus-..." → "claude-opus-4-6"
  // Run on all candidates so dots→dashes variant is also checked
  for (const c of [...candidates]) {
    const rev = c.match(/^(claude)-(\d+)-(\d+)-(opus|sonnet|haiku)/);
    if (rev) candidates.push(`${rev[1]}-${rev[4]}-${rev[2]}-${rev[3]}`);
  }

  // Pass 1: exact and precise matches across ALL candidates first
  for (const c of candidates) {
    if (MODEL_PRICING[c]) return c;
  }
  for (const c of candidates) {
    const withoutDate = c.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
    if (MODEL_PRICING[withoutDate]) return withoutDate;
    const withoutTag = c.replace(/:(latest|thinking)$/, '');
    if (MODEL_PRICING[withoutTag]) return withoutTag;
    const withoutQual = c.replace(/-(thinking|high|xhigh|preview|latest)(-thinking|-high|-xhigh|-preview)*/g, '');
    if (withoutQual !== c && MODEL_PRICING[withoutQual]) return withoutQual;
  }

  // Pass 2: fuzzy startsWith (longest key match wins)
  const keys = Object.keys(MODEL_PRICING);
  for (const c of candidates) {
    let best = null;
    for (const key of keys) {
      if (c.startsWith(key) && (!best || key.length > best.length)) best = key;
    }
    if (best) return best;
  }

  return null;
}

function getModelPricing(modelName) {
  const key = normalizeModelName(modelName);
  return key ? MODEL_PRICING[key] : null;
}

// Calculate cost for a set of token counts and a model
// Returns cost in USD or null if model is unknown
function calculateCost(modelName, inputTokens, outputTokens, cacheRead, cacheWrite) {
  const pricing = getModelPricing(modelName);
  if (!pricing) return null;

  const input = ((inputTokens || 0) / 1_000_000) * pricing.input;
  const output = ((outputTokens || 0) / 1_000_000) * pricing.output;
  const cr = ((cacheRead || 0) / 1_000_000) * pricing.cacheRead;
  const cw = ((cacheWrite || 0) / 1_000_000) * pricing.cacheWrite;

  return input + output + cr + cw;
}

// CostCalculatorService entry point.
// Input:  { model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens }
// Output: { estimated_cost, currency, breakdown, model }
//   estimated_cost is null (unknown model) so callers can distinguish "no data" from $0.
function estimateCost({
  model,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
} = {}) {
  const pricing = getModelPricing(model);
  const breakdown = pricing
    ? {
        input: ((input_tokens || 0) / 1_000_000) * pricing.input,
        output: ((output_tokens || 0) / 1_000_000) * pricing.output,
        cache_read: ((cache_read_tokens || 0) / 1_000_000) * pricing.cacheRead,
        cache_write: ((cache_write_tokens || 0) / 1_000_000) * pricing.cacheWrite,
      }
    : null;
  const estimated_cost = breakdown
    ? breakdown.input + breakdown.output + breakdown.cache_read + breakdown.cache_write
    : null;
  return {
    estimated_cost,
    currency: 'USD',
    breakdown,
    model: normalizeModelName(model),
  };
}

// Given the session_stats.models array (one entry per assistant message, repeats kept),
// return the most frequently used model string, or null when empty.
function dominantModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const counts = new Map();
  for (const m of models) {
    if (!m) continue;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

module.exports = {
  MODEL_PRICING,
  normalizeModelName,
  getModelPricing,
  calculateCost,
  estimateCost,
  dominantModel,
};

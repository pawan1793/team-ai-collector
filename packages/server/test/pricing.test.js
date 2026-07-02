const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeModelName,
  getModelPricing,
  estimateCost,
  dominantModel,
} = require('../src/pricing');

test('normalizeModelName maps dotted and versioned names to pricing keys', () => {
  assert.strictEqual(normalizeModelName('gpt-4.1'), 'gpt-4-1');
  assert.strictEqual(normalizeModelName('gpt-4.1-mini'), 'gpt-4-1-mini');
  assert.strictEqual(normalizeModelName('gemini-2.5-pro'), 'gemini-2-5-pro');
  assert.strictEqual(normalizeModelName('gemini-2.5-flash'), 'gemini-2-5-flash');
  // versioned + provider-prefixed Claude names resolve to a priced entry at Sonnet-4 rates
  assert.strictEqual(getModelPricing('claude-sonnet-4-20250514').input, 3);
  assert.strictEqual(getModelPricing('us.anthropic.claude-opus-4-1').input, 15);
});

test('estimateCost computes per-million-token cost with breakdown', () => {
  // claude-sonnet-4: input 3, output 15, cacheRead 0.3, cacheWrite 3.75 (USD / 1M tokens)
  const res = estimateCost({
    model: 'claude-sonnet-4',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_tokens: 1_000_000,
    cache_write_tokens: 1_000_000,
  });
  assert.strictEqual(res.currency, 'USD');
  assert.strictEqual(res.breakdown.input, 3);
  assert.strictEqual(res.breakdown.output, 15);
  assert.strictEqual(res.breakdown.cache_read, 0.3);
  assert.strictEqual(res.breakdown.cache_write, 3.75);
  assert.ok(Math.abs(res.estimated_cost - 22.05) < 1e-9);
});

test('estimateCost returns null cost for unknown models', () => {
  const res = estimateCost({ model: 'totally-made-up-model', input_tokens: 1000 });
  assert.strictEqual(res.estimated_cost, null);
  assert.strictEqual(res.breakdown, null);
  assert.strictEqual(res.currency, 'USD');
});

test('estimateCost handles missing/zero tokens without throwing', () => {
  const res = estimateCost({ model: 'gpt-5' });
  assert.strictEqual(res.estimated_cost, 0);
});

test('dominantModel returns the most frequent entry', () => {
  assert.strictEqual(
    dominantModel(['claude-sonnet-4', 'gpt-5', 'claude-sonnet-4']),
    'claude-sonnet-4'
  );
  assert.strictEqual(dominantModel([]), null);
  assert.strictEqual(dominantModel(null), null);
});

test('a normalized model distribution sums to ~100%', () => {
  // Mimic the server buildDistribution math: counts -> percentages.
  const counts = { 'claude-sonnet-4': 58, 'gpt-5': 21, 'gemini-2-5-pro': 15, 'gpt-4-1-mini': 6 };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pcts = Object.values(counts).map((c) => Math.round((c / total) * 1000) / 10);
  const sum = pcts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) <= 0.5, `distribution summed to ${sum}`);
});

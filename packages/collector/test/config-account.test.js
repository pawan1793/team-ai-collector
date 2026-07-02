const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULTS,
  ALLOWED_ACCOUNTS,
  isValidAccount,
} = require('../lib/config');

test('account defaults to null for backward compatibility', () => {
  assert.strictEqual(DEFAULTS.account, null);
});

test('allowed accounts match the documented set', () => {
  assert.deepStrictEqual(ALLOWED_ACCOUNTS, ['vibe2', 'vibe3', 'info', 'vibe4', 'vibe5']);
});

test('isValidAccount accepts allowed values and rejects others', () => {
  for (const a of ['vibe2', 'vibe3', 'info', 'vibe4', 'vibe5']) {
    assert.ok(isValidAccount(a), `${a} should be valid`);
  }
  assert.ok(!isValidAccount('vibe1'));
  assert.ok(!isValidAccount('VIBE2'));
  assert.ok(!isValidAccount(''));
  assert.ok(!isValidAccount(undefined));
});

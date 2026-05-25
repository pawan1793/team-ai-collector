const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const claude = require('../src/editors/claude');

test('claude getMessages parses fixture jsonl', () => {
  const fixture = path.join(__dirname, 'fixtures', 'claude-sample.jsonl');
  const chat = {
    source: 'claude-code',
    composerId: 'test-session',
    _fullPath: fixture,
  };
  const messages = claude.getMessages(chat);
  assert.ok(messages.length >= 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
});

test('registry exports getAllChats without throwing', () => {
  const adapters = require('../src/index');
  assert.equal(typeof adapters.getAllChats, 'function');
  const chats = adapters.getAllChats();
  assert.ok(Array.isArray(chats));
});

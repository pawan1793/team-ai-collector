const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key['":\s=]+['"]?[a-zA-Z0-9._-]{16,}/gi,
];

function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function applyMessagePolicy(messages, policy) {
  if (!messages || messages.length === 0) return [];
  if (policy === 'none') return [];
  return messages.map((m) => {
    let content = m.content ?? '';
    if (policy === 'redacted') {
      content = scrubSecrets(content);
      if (content.length > 500) content = content.slice(0, 500) + '…';
    }
    return { ...m, content };
  });
}

module.exports = { scrubSecrets, applyMessagePolicy };

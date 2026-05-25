const crypto = require('crypto');

function hashToken(secret, token) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function resolveDeviceAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  const secret = process.env.DEVICE_TOKEN_SECRET || 'dev-secret';
  const tokenHash = hashToken(secret, token);
  const orgHeader = req.headers['x-org-id'];

  const { getPool } = require('./db');
  const row = await getPool().query(
    `SELECT d.device_id, d.org_id, d.user_id, u.email
     FROM devices d
     JOIN users u ON u.user_id = d.user_id
     WHERE d.token_hash = $1`,
    [tokenHash]
  );
  if (!row.rows[0]) return null;
  const device = row.rows[0];
  if (orgHeader && orgHeader !== device.org_id) return null;
  return device;
}

function requireDeviceAuth() {
  return async (req, res, next) => {
    const device = await resolveDeviceAuth(req);
    if (!device) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid token' });
    }
    req.device = device;
    next();
  };
}

function requireAdminKey() {
  return (req, res, next) => {
    const key = req.headers['x-admin-key'] || req.body?.admin_key;
    if (key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Invalid admin key' });
    }
    next();
  };
}

function requireOrgApiKey() {
  return async (req, res, next) => {
    const apiKey = req.headers['x-org-api-key'] || req.query.org_api_key;
    if (!apiKey) {
      return res.status(401).json({ error: 'Org API key required' });
    }
    const { getPool } = require('./db');
    const hash = hashApiKey(apiKey);
    const row = await getPool().query(
      'SELECT org_id, name, policies FROM organizations WHERE api_key_hash = $1',
      [hash]
    );
    if (!row.rows[0]) {
      return res.status(401).json({ error: 'Invalid org API key' });
    }
    req.org = row.rows[0];
    next();
  };
}

module.exports = {
  hashToken,
  generateToken,
  hashApiKey,
  resolveDeviceAuth,
  requireDeviceAuth,
  requireAdminKey,
  requireOrgApiKey,
};

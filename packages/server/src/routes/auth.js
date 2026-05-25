const express = require('express');
const { randomUUID } = require('crypto');
const { deviceAuthSchema } = require('@team-ai/shared');
const { getPool } = require('../db');
const { hashApiKey, hashToken, generateToken } = require('../auth');

const router = express.Router();

router.post('/device', async (req, res) => {
  try {
    const parsed = deviceAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { org_api_key, email, device_name } = parsed.data;
    const keyHash = hashApiKey(org_api_key);
    const orgRow = await getPool().query(
      'SELECT org_id, policies FROM organizations WHERE api_key_hash = $1',
      [keyHash]
    );
    if (!orgRow.rows[0]) {
      return res.status(401).json({ error: 'Invalid org API key' });
    }
    const orgId = orgRow.rows[0].org_id;

    let userRow = await getPool().query(
      'SELECT user_id FROM users WHERE org_id = $1 AND email = $2',
      [orgId, email]
    );
    let userId;
    if (userRow.rows[0]) {
      userId = userRow.rows[0].user_id;
    } else {
      userId = `usr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await getPool().query(
        'INSERT INTO users (user_id, org_id, email, display_name) VALUES ($1, $2, $3, $4)',
        [userId, orgId, email, email.split('@')[0]]
      );
    }

    const deviceId = `dev_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const deviceToken = generateToken();
    const secret = process.env.DEVICE_TOKEN_SECRET || 'dev-secret';
    const tokenHash = hashToken(secret, deviceToken);

    await getPool().query(
      `INSERT INTO devices (device_id, org_id, user_id, device_name, token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [deviceId, orgId, userId, device_name || 'unknown', tokenHash]
    );

    res.json({
      device_token: deviceToken,
      user_id: userId,
      org_id: orgId,
      device_id: deviceId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

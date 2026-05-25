const express = require('express');
const { randomUUID } = require('crypto');
const { getPool } = require('../db');
const { requireAdminKey, hashApiKey, generateToken } = require('../auth');

const router = express.Router();

router.post('/orgs', requireAdminKey(), async (req, res) => {
  try {
    const name = req.body.name || 'Organization';
    const orgId = `org_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const apiKey = `org_${generateToken().slice(0, 24)}`;
    const defaultContent = process.env.DEFAULT_MESSAGE_CONTENT || 'none';
    const policies = {
      message_content: defaultContent,
      hash_project_paths: false,
      retention_days: 90,
      ...(req.body.policies || {}),
    };

    await getPool().query(
      'INSERT INTO organizations (org_id, name, api_key_hash, policies) VALUES ($1, $2, $3, $4)',
      [orgId, name, hashApiKey(apiKey), JSON.stringify(policies)]
    );

    res.status(201).json({
      org_id: orgId,
      name,
      org_api_key: apiKey,
      policies,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

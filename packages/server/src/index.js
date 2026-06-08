require('./env'); // load .env before anything reads process.env

const express = require('express');
const path = require('path');
const { initDb } = require('./db');
const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const teamRoutes = require('./routes/team');
const adminRoutes = require('./routes/admin');

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  await initDb();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/v1/health', (req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  app.use('/v1/auth', authRoutes);
  app.use('/v1/sync', syncRoutes);
  app.use('/v1/team', teamRoutes);
  app.use('/v1/admin', adminRoutes);

  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));

  app.listen(PORT, () => {
    console.log(`Team AI server listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

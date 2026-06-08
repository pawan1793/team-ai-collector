// Shared env loader. Require this FIRST (before anything reads process.env)
// from any directly-launched entry point (server, scripts, tests).
//
// Resolves the path relative to this file, so it loads packages/server/.env
// no matter which directory the process is started from. dotenv does not
// override variables that are already set, so values injected by Docker
// Compose or the shell still take precedence.
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

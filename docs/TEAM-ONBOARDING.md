# Team Onboarding

How to get your team sending AI coding-session data to the server — in **one command** per engineer.

There are two roles: the **admin** (you, one-time setup) and each **engineer** (one command).

---

## 1. Admin — one-time setup

### a. Start the server

```bash
cp .env.example .env
# Edit ADMIN_API_KEY and DEVICE_TOKEN_SECRET to your own secrets
docker compose up -d --build
```

Verify it's up: `curl http://localhost:8080/v1/health` → `{"ok":true,...}`

### b. Create the organization and get the team key

```bash
docker compose exec server node scripts/bootstrap-org.js --name "Your Team"
```

This prints an `org_api_key` (starts with `org_…`) **exactly once**. Save it — it's the
key every engineer uses to join, and it's also what unlocks the dashboard. If you lose it
you'll have to create a new org.

### c. Bake your server URL into `join.sh`

Edit one line in [`join.sh`](../join.sh) so engineers only have to paste a key:

```bash
DEFAULT_ORG="http://your-server:8080"   # ← your real server address
```

Commit and push. If your server isn't on localhost, put it behind HTTPS — the device
token is a Bearer credential.

### d. Share two things with the team

1. The repo URL.
2. The `org_api_key`.

---

## 2. Engineer — one command

```bash
git clone <your-repo-url> && cd team-ai-collector
./join.sh org_xxxxxxxx
```

That's the whole setup. `join.sh` will:

1. Install dependencies (first run only).
2. Log you in and save a device token to `~/.team-ai/config.json` (mode `0600`).
3. Scan your local sessions and upload the first batch.

> **Before you run it:** make sure `git config user.email` is set — that email is your
> identity in the team dashboard.

### Send new sessions later

Just re-run it any time:

```bash
./join.sh org_xxxxxxxx
```

### Auto-sync every hour (recommended)

After the first run, `join.sh` prints a ready-to-paste cron line. Or set it up directly:

```bash
(crontab -l 2>/dev/null; echo "0 * * * * cd $(pwd) && node packages/collector/bin/cli.js connect --once") | crontab -
```

### Check it worked

```bash
node packages/collector/bin/cli.js status
# or: npm run collector:status
```

Shows last sync time, pending queue depth, and which editors were detected
(Claude Code, Cursor).

---

## What gets uploaded

**Only aggregate usage statistics — no message text.** Per session: message counts by
role, models used, tool-call names, token totals, and char counts. This is the default
and is enforced on both the client and the server.

If your org later opts into message content (`redacted` or `full` policy), it must be
changed in **both** the org policy and each engineer's config — otherwise the server
rejects message bodies.

---

## Command reference

| Command | What it does |
|---------|--------------|
| `./join.sh <key>` | Install + login + first sync (the one-command path) |
| `npm run join -- <key>` | Same as above, via npm |
| `npm run sync` | Upload latest sessions (`connect --once`) |
| `npm run collector:status` | Show sync status |
| `node packages/collector/bin/cli.js scan` | Scan locally **without** uploading |
| `node packages/collector/bin/cli.js logout` | Remove the saved device token |

Long-form equivalents (no `join.sh`):

```bash
node packages/collector/bin/cli.js login --org http://your-server:8080 --key org_xxxxxxxx
node packages/collector/bin/cli.js connect --once
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Not logged in` | Run `./join.sh <key>` first. |
| `Login failed` | Check the server URL in `join.sh` and that the key is correct/current. |
| `No email…` | Set `git config user.email`, or run login with `--email you@company.com`. |
| Sync says "queued" | Server was unreachable; the payload is queued and retried on the next run. Check `status` for queue depth. |
| `Editors detected: none` | You have no local Claude Code / Cursor sessions yet, or they're in a non-standard location. |
| `RATE_LIMITED` | More than 120 syncs/hour from one device — back off; hourly cron is plenty. |

See also: [RUNNING.md](RUNNING.md) for full server/dev details.

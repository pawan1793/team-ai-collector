# Team AI Collector

Local terminal client that scans AI coding agent sessions (Claude Code, Cursor) and uploads usage telemetry to a self-hosted team server.

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Edit ADMIN_API_KEY and DEVICE_TOKEN_SECRET

docker compose up -d --build

# Create organization + API key (prints org_api_key once)
docker compose exec server node scripts/bootstrap-org.js --name "Acme Engineering"

# Open dashboard: http://localhost:3000
# API: http://localhost:8080/v1/health
```

## Engineer setup (macOS)

```bash
npm install

# Login with org API key from bootstrap step
node packages/collector/bin/cli.js login \
  --org http://localhost:8080 \
  --key org_xxxxxxxx

# Hourly sync (or --once for cron)
node packages/collector/bin/cli.js connect --once
node packages/collector/bin/cli.js status
```

Config is stored at `~/.team-ai/config.json` (mode `0600`). Default privacy: **no message bodies** uploaded.

## Monorepo packages

| Package | Description |
|---------|-------------|
| `@team-ai/shared` | Zod schemas, redaction helpers |
| `@team-ai/adapters` | Claude Code + Cursor readers |
| `team-ai-collector` | CLI: login, connect, scan, status |
| `@team-ai/server` | Postgres ingest + team API |
| `@team-ai/dashboard` | Manager KPI dashboard |

## Docs

- **[Team onboarding](docs/TEAM-ONBOARDING.md)** — get your team sending data in one command (`./join.sh`)
- **[Running guide](docs/RUNNING.md)** — detailed setup (Docker, local dev, CLI, dashboard, troubleshooting)
- [PRD](docs/PRD-team-ai-usage-collector.md)
- [Greenfield reference pack](docs/GREENFIELD-REFERENCE-PACK.md)
- [OpenAPI sketch](docs/openapi.yaml)

## License

ISC. Editor adapters forked from [Agentlytics](https://github.com/f/agentlytics) — see `references/agentlytics/`.

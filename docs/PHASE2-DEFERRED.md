# Phase 2 — Deferred (v1)

Not implemented in MVP. Planned scope:

- 30-second incremental sync with change detection
- gzip payloads > 64KB and chunking
- Additional adapters: VS Code, Codex, OpenCode
- Full manager dashboard (drill-down, heatmap)
- `POST /v1/auth/refresh` and token rotation

## Delivered after MVP

- **Cost estimates from pricing.json** — `packages/server/src/pricing.js` (+ `pricing.json`)
  computes per-session `estimated_cost` at ingest; surfaced org/user/session-wide on the
  dashboard. Re-run `npm run recalc:costs` after editing prices.
- **Model usage percentage** — per-user and org-level distribution + pie chart.
- **Internal account** during `connect --account <name>` — stored, synced, displayed, filterable.
- **"Last 1 day" date filter** on the dashboard.

See [PRD §13 Phase 2](PRD-team-ai-usage-collector.md).

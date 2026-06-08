#!/usr/bin/env bash
#
# Team AI Collector — one-command onboarding for engineers.
#
#   ./join.sh org_xxxxxxxx
#
# Installs deps (first run only), logs in, and uploads the first sync.
# Re-run any time to push the latest sessions.
#
set -euo pipefail
cd "$(dirname "$0")"

# ── Admin: set your server URL here so engineers only paste a key ──────────────
DEFAULT_ORG="http://localhost:8080"
# ──────────────────────────────────────────────────────────────────────────────

ORG="${TEAM_AI_ORG:-$DEFAULT_ORG}"
KEY="${TEAM_AI_KEY:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --org) ORG="$2"; shift 2;;
    --key) KEY="$2"; shift 2;;
    -h|--help) echo "Usage: ./join.sh <org_api_key> [--org URL]"; exit 0;;
    *) KEY="$1"; shift;;
  esac
done

if [ -z "$KEY" ]; then
  echo "Usage: ./join.sh <org_api_key>   (ask your admin for the key)"
  exit 1
fi

CLI="node packages/collector/bin/cli.js"

# 1. Install deps once
if [ ! -d node_modules ]; then
  echo "→ Installing dependencies…"
  npm install --silent
fi

# 2. Log in (saves device token to ~/.team-ai/config.json)
echo "→ Logging in to $ORG…"
$CLI login --org "$ORG" --key "$KEY"

# 3. First sync
echo "→ Uploading session data…"
$CLI connect --once

echo ""
echo "✓ Done. To sync automatically in the background (hourly, survives reboot):"
echo "  $CLI service install"
echo "Or just re-run './join.sh $KEY' whenever you want to push the latest sessions."

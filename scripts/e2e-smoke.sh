#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Starting Docker Compose..."
docker compose up -d --build --wait

echo "==> Waiting for API health..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/v1/health >/dev/null; then break; fi
  sleep 2
done
curl -sf http://localhost:8080/v1/health | head -c 200
echo ""

echo "==> Bootstrap organization..."
ORG_JSON=$(docker compose exec -T server node scripts/bootstrap-org.js --name "E2E Org")
echo "$ORG_JSON"
ORG_KEY=$(echo "$ORG_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).org_api_key))")

echo "==> Device login..."
AUTH=$(curl -sf -X POST http://localhost:8080/v1/auth/device \
  -H 'Content-Type: application/json' \
  -d "{\"org_api_key\":\"$ORG_KEY\",\"email\":\"e2e@example.com\",\"device_name\":\"e2e\"}")
echo "$AUTH"
TOKEN=$(echo "$AUTH" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).device_token))")
USER_ID=$(echo "$AUTH" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).user_id))")
DEVICE_ID=$(echo "$AUTH" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).device_id))")
ORG_ID=$(echo "$AUTH" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).org_id))")

SYNC_ID=$(node -e "console.log(require('crypto').randomUUID())")
NOW=$(node -e "console.log(Date.now())")

echo "==> POST /v1/sync..."
SYNC_RES=$(curl -sf -X POST http://localhost:8080/v1/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Org-Id: $ORG_ID" \
  -H "X-Schema-Version: 1.0" \
  -H 'Content-Type: application/json' \
  -d "{
    \"schema_version\": \"1.0\",
    \"sync_id\": \"$SYNC_ID\",
    \"sent_at\": $NOW,
    \"client\": {\"name\":\"e2e\",\"version\":\"0.1.0\",\"platform\":\"linux\"},
    \"user\": {\"user_id\":\"$USER_ID\",\"email\":\"e2e@example.com\",\"device_id\":\"$DEVICE_ID\"},
    \"cursor\": {\"since\": 0},
    \"sessions\": [{\"session_id\":\"e2e-s1\",\"source\":\"claude-code\",\"name\":\"E2E\",\"last_updated_at\":$NOW}],
    \"session_stats\": [{\"session_id\":\"e2e-s1\",\"total_messages\":1,\"total_input_tokens\":10,\"total_output_tokens\":5}],
    \"messages\": []
  }")
echo "$SYNC_RES"

echo "==> Team overview..."
curl -sf "http://localhost:8080/v1/team/overview" -H "X-Org-Api-Key: $ORG_KEY" | head -c 500
echo ""

MSG_COUNT=$(docker compose exec -T postgres psql -U teamai -d teamai -t -c "SELECT COUNT(*) FROM messages;")
MSG_COUNT=$(echo "$MSG_COUNT" | tr -d ' ')
if [ "$MSG_COUNT" != "0" ]; then
  echo "FAIL: expected 0 messages (privacy none), got $MSG_COUNT"
  exit 1
fi

echo "==> E2E smoke passed."

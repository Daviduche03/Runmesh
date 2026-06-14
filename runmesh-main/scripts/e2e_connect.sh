#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JWT_SECRET="${JWT_SECRET:-your-long-random-secret}"
BASE="${BASE_URL:-http://localhost:8787}"
REDIRECT="${REDIRECT_URI:-http://localhost:3000/callback}"
DEV_USER_ID="${DEV_USER_ID:-1bed4fc1-b610-41bc-a406-56f95fb8c8cf}"
DEV_EMAIL="${DEV_EMAIL:-daviduche4809@gmail.com}"
DEV_NAME="${DEV_NAME:-David uche}"
MODE="${CONNECT_MODE:-authenticate}"
SCOPES="${CONNECT_SCOPES:-gmail.readonly,youtube.readonly,drive.readonly}"
USER_EMAIL="${CONNECT_USER_EMAIL:-$DEV_EMAIL}"
OTP_CODE="${CONNECT_OTP_CODE:-}"
EXTERNAL_USER_ID="${CONNECT_EXTERNAL_USER_ID:-e2e_user_1}"
CONNECT_USER_ID="${CONNECT_USER_ID:-}"

JWT=$(cd "$ROOT/src" && uv run python -c "
from utils.auth import encode_token
print(encode_token({
    'id': '$DEV_USER_ID',
    'email': '$DEV_EMAIL',
    'name': '$DEV_NAME',
}, '$JWT_SECRET'))
")

SCOPES_JSON=$(python3 -c "import json; print(json.dumps([s.strip() for s in '$SCOPES'.split(',') if s.strip()]))")
EMAIL_JSON=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$USER_EMAIL")

SLUG="e2e-$(date +%s)"
echo "=== Providers catalog ==="
curl -s "$BASE/api/v1/connect/providers" | python3 -m json.tool

echo ""
echo "=== Create Connect app ==="
CREATE_RESP=$(curl -s -X POST "$BASE/api/v1/connect/apps" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"E2E App\",\"slug\":\"$SLUG\",\"redirect_uris\":[\"$REDIRECT\"],\"allowed_providers\":[\"google\",\"slack\",\"meta\"]}")

echo "$CREATE_RESP" | python3 -m json.tool
APP_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

authenticate_user() {
  echo ""
  echo "=== Create authenticate session (OTP sent internally) ==="
  AUTH_SESSION=$(curl -s -X POST "$BASE/api/v1/connect/sessions" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\":\"$APP_ID\",\"external_user_id\":\"$EXTERNAL_USER_ID\",\"mode\":\"authenticate\",\"redirect_uri\":\"$REDIRECT\",\"email\":$EMAIL_JSON}")

  echo "$AUTH_SESSION" | python3 -m json.tool
  CHALLENGE_ID=$(echo "$AUTH_SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['challenge_id'])")

  if [ -z "$OTP_CODE" ]; then
    echo ""
    echo "OTP was sent. Without RESEND_API_KEY it logs as [connect-otp] in wrangler."
    echo "Re-run with: CONNECT_OTP_CODE=<code> CONNECT_MODE=$MODE $0"
    exit 0
  fi

  echo ""
  echo "=== Verify OTP (API) ==="
  VERIFY_RESP=$(curl -s -X POST "$BASE/api/v1/connect/otp/verify" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"challenge_id\":\"$CHALLENGE_ID\",\"code\":\"$OTP_CODE\"}")

  echo "$VERIFY_RESP" | python3 -m json.tool
  CONNECT_USER_ID=$(echo "$VERIFY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['connect_user_id'])")
  AUTH_CODE=$(echo "$VERIFY_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('code',''))")
  export CONNECT_USER_ID AUTH_CODE
}

if [ "$MODE" = "authenticate" ]; then
  authenticate_user
  echo ""
  echo "PASS: authenticate completed. connect_user_id=$CONNECT_USER_ID"
  if [ -n "$AUTH_CODE" ]; then
    echo ""
    echo "Token exchange:"
    echo "curl -s -X POST $BASE/api/v1/connect/token \\"
    echo "  -H 'Authorization: Bearer $JWT' \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -d '{\"app_id\":\"$APP_ID\",\"code\":\"$AUTH_CODE\"}'"
  fi
  exit 0
fi

if [ -z "$CONNECT_USER_ID" ]; then
  authenticate_user
fi

echo ""
echo "=== Create session (mode=$MODE) ==="
SESSION_BODY="{\"app_id\":\"$APP_ID\",\"external_user_id\":\"$EXTERNAL_USER_ID\",\"connect_user_id\":\"$CONNECT_USER_ID\",\"mode\":\"$MODE\",\"redirect_uri\":\"$REDIRECT\""
if [ "$MODE" = "connect" ] || [ "$MODE" = "grant" ]; then
  SESSION_BODY="$SESSION_BODY,\"provider\":\"google\",\"scopes\":$SCOPES_JSON"
fi
SESSION_BODY="$SESSION_BODY}"

SESSION_RESP=$(curl -s -X POST "$BASE/api/v1/connect/sessions" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "$SESSION_BODY")

echo "$SESSION_RESP" | python3 -m json.tool
STATE=$(echo "$SESSION_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['state'])")
AUTH_URL=$(echo "$SESSION_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['authorize_url'])")

echo ""
echo "=== Authorize redirect check ==="
LOCATION=$(curl -s -D - -o /dev/null "$BASE/connect/authorize?state=$STATE" | grep -i "^location:" | cut -d' ' -f2- | tr -d '\r' || true)
echo "Redirect: ${LOCATION:-<inline>}"

if [ "$MODE" = "connect" ]; then
  if echo "$LOCATION" | grep -q "accounts.google.com"; then
    echo "PASS: connect goes straight to Google OAuth"
  else
    echo "FAIL: expected Google OAuth redirect"
    exit 1
  fi
elif [ "$MODE" = "grant" ]; then
  if echo "$LOCATION" | grep -q "/connect/consent"; then
    echo "PASS: grant goes to consent (connection exists)"
  elif echo "$LOCATION" | grep -q "accounts.google.com"; then
    echo "PASS: grant needs provider connection first (Google OAuth)"
  elif echo "$LOCATION" | grep -q "error=authentication_required"; then
    echo "FAIL: session missing connect_user_id"
    exit 1
  else
    echo "FAIL: unexpected grant authorize response"
    exit 1
  fi
else
  echo "FAIL: unknown mode (use authenticate, connect, or grant)"
  exit 1
fi

echo ""
echo "=== Manual step ==="
echo "connect_user_id=$CONNECT_USER_ID"
echo "Open authorize URL to finish provider OAuth or grant consent:"
echo "$AUTH_URL"
echo ""
echo "Token exchange:"
echo "curl -s -X POST $BASE/api/v1/connect/token \\"
echo "  -H 'Authorization: Bearer $JWT' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"app_id\":\"$APP_ID\",\"code\":\"<code>\"}'"

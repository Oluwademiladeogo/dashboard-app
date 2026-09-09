#!/usr/bin/env bash
# Thursday pre-report schedule sync.
#
# The team keeps the weekly CS schedule in a Google Sheet published to the web
# as CSV. This pulls that CSV and feeds it through the dashboard's existing
# upload endpoint (/api/cs-schedule/upload), which reuses the same CSV parser +
# lib/schedule.ts upsert the manual "Upload CSV" button uses — so there is one
# code path for both manual and automatic schedule loads.
#
# Config is read from the dashboard's .env.local (never hard-coded here):
#   GOOGLE_SCHEDULE_CSV_URL  published-to-web CSV link for the schedule sheet
#   EF_DASH_AUTH             the dashboard auth token (lib/auth AUTH_TOKEN)
# Both must be set for the sync to run; otherwise it logs and exits 0 so the
# cron stays quiet until the sheet is wired up.
#
# Usage: schedule-sync.sh [ENV_FILE]   (defaults to ../.env.local next to this)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$SCRIPT_DIR/../.env.local}"
DASH_URL="${DASH_URL:-http://127.0.0.1:3000}"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

envval() {
  # KEY=value from the env file, quotes/whitespace stripped; never fails the run
  local line
  line="$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" 2>/dev/null | head -1 || true)"
  line="${line#*=}"
  printf '%s' "$line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}

URL="$(envval GOOGLE_SCHEDULE_CSV_URL)"
AUTH="$(envval EF_DASH_AUTH)"

if [ -z "$URL" ]; then echo "$(ts) schedule-sync: GOOGLE_SCHEDULE_CSV_URL unset in $ENV_FILE; skipping"; exit 0; fi
if [ -z "$AUTH" ]; then echo "$(ts) schedule-sync: EF_DASH_AUTH unset in $ENV_FILE; skipping"; exit 0; fi

TMP="$(mktemp /tmp/cs_schedule.XXXXXX.csv)"
trap 'rm -f "$TMP"' EXIT

if ! curl -fsSL --max-time 60 "$URL" -o "$TMP"; then
  echo "$(ts) schedule-sync: failed to fetch published CSV"; exit 1
fi

RESP="$(curl -s --max-time 60 -X POST "$DASH_URL/api/cs-schedule/upload" \
  -b "ef_dash_auth=$AUTH" -F "file=@$TMP;type=text/csv")"
echo "$(ts) schedule-sync: $RESP"

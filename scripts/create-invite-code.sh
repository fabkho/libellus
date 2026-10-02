#!/usr/bin/env bash
# Creates an invite code with a use limit and an expiry and prints it.
#
#   scripts/create-invite-code.sh [--uses N] [--days N] [--label TEXT] [--code CODE]
#
# Defaults: one use, valid for 14 days, a random code like K7QM-X2PA. `--days 0`
# means the code never expires. It calls public.create_invite_code through the
# REST API with the service-role key, which only the owner holds:
#
#   local   no setup; the URL and key come from `supabase status` in this repo
#   hosted  export SUPABASE_URL=https://<ref>.supabase.co
#           export SUPABASE_SERVICE_ROLE_KEY=<service_role key>
#
# The key never goes in web/.env or anywhere the app can read it.
set -euo pipefail

uses=1
days=14
label=''
code=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uses) uses="${2:?--uses needs a number}"; shift 2 ;;
    --days) days="${2:?--days needs a number}"; shift 2 ;;
    --label) label="${2:?--label needs text}"; shift 2 ;;
    --code) code="${2:?--code needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

[[ "$uses" =~ ^[1-9][0-9]*$ ]] || { echo "--uses must be a positive whole number" >&2; exit 2; }
[[ "$days" =~ ^[0-9]+$ ]] || { echo "--days must be a whole number (0 = never expires)" >&2; exit 2; }

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  cd "$(dirname "$0")/.."
  status="$(supabase status -o env 2>/dev/null)" || {
    echo "No local stack answering. Run \`supabase start\`, or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." >&2
    exit 1
  }
  SUPABASE_URL="${SUPABASE_URL:-$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$status")}"
  SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p' <<<"$status")}"
fi

if [[ "$days" -gt 0 ]]; then
  # `date` differs between macOS and GNU; python is on both.
  expires="$(python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=int(sys.argv[1]))).isoformat())" "$days")"
else
  expires=''
fi

body="$(python3 - "$uses" "$expires" "$label" "$code" <<'PY'
import json, sys
uses, expires, label, code = sys.argv[1:5]
print(json.dumps({
    "p_max_uses": int(uses),
    "p_expires_at": expires or None,
    "p_label": label or None,
    "p_code": code or None,
}))
PY
)"

response="$(curl -sS -w '\n%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/create_invite_code" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d "$body")"
status_code="${response##*$'\n'}"
payload="${response%$'\n'*}"

if [[ "$status_code" != 2* ]]; then
  echo "Could not create the code ($status_code): $payload" >&2
  exit 1
fi

python3 - "$payload" <<'PY'
import json, sys
row = json.loads(sys.argv[1])
print(row["code"])
print(f'  uses: {row["max_uses"]}   expires: {row["expires_at"] or "never"}', file=sys.stderr)
PY

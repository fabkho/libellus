#!/usr/bin/env bash
# Proves the backup chain on the local stack: dump → age → decrypt → restore,
# with a throwaway age key, into a scratch database next to the stack's own,
# and compares the row counts table by table. Run from the repository's root
# with `supabase start` up; CI runs it after the data-layer suite.
#
#   scripts/test-backup-roundtrip.sh
#
# Connection: PGHOST (127.0.0.1), PGPORT (55322), PGUSER (postgres), PGPASSWORD
# (postgres). It reads the stack's `postgres` database and never writes to it;
# it creates the database libellus_restore_test and drops it again, twice:
#
#   1. --mode full into the empty database: schema and data.
#   2. --mode data into a database that looks like a freshly pushed project
#      (the backup's schema, its migration record, the rows migrations seed):
#      the way a restore into a new Supabase project goes. Then the guards: a
#      second restore into it is refused (it has members), and a wrong key fails.
#
# Needs pg_dump, pg_restore and psql of the server's major version, age and age-keygen.
set -euo pipefail
cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55322}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
scratch=libellus_restore_test
base="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT"
source_url="$base/postgres"
scratch_url="$base/$scratch"

work="$(mktemp -d)"
cleanup() {
  psql "$source_url" -X -q -c 'set client_min_messages = warning' -c "drop database if exists $scratch with (force)" || true
  rm -rf "$work"
}
trap cleanup EXIT
fresh_scratch() {
  psql "$source_url" -X -q -v ON_ERROR_STOP=1 -c 'set client_min_messages = warning' -c "drop database if exists $scratch with (force)" -c "create database $scratch"
}

age-keygen -o "$work/key.txt" 2>/dev/null
recipient="$(age-keygen -y "$work/key.txt")"
age-keygen -o "$work/wrong-key.txt" 2>/dev/null

echo "== Backup"
DATABASE_URL="$source_url" scripts/backup-db.sh --recipient "$recipient" --out "$work/libellus.dump.age"
if age --decrypt --identity "$work/wrong-key.txt" "$work/libellus.dump.age" > /dev/null 2>&1; then
  echo "FAIL: the backup opened with the wrong key." >&2; exit 1
fi

# The rows the backup holds, "schema.table count" per line: its COPY blocks, one line a row.
age --decrypt --identity "$work/key.txt" --output "$work/plain.dump" "$work/libellus.dump.age"
pg_restore --data-only -f - "$work/plain.dump" \
  | awk '/^COPY / { t = $2; gsub(/"/, "", t); n[t] = 0; on = 1; next }
         /^\\\.$/ { on = 0; next }
         on { n[t]++ }
         END { for (t in n) print t, n[t] }' | LC_ALL=C sort > "$work/archive.counts"

# Exact row counts in the database $1 of the tables named in the file $2.
counts() {
  local sql
  sql="$(awk '{ split($1, p, "."); printf "%sselect '"'"'%s'"'"' as t, count(*) as n from \"%s\".\"%s\"", (NR > 1 ? " union all " : ""), $1, p[1], p[2] }' "$2")"
  psql "$1" -X -A -t -F ' ' -v ON_ERROR_STOP=1 -c "$sql" | LC_ALL=C sort
}
# Restored must equal the backup, table by table. The live database is shown too:
# it may have moved on since the dump (the stack is shared), so it only informs.
compare() {
  local label="$1" pattern="$2"
  grep -E "$pattern" "$work/archive.counts" > "$work/expected.counts"
  counts "$scratch_url" "$work/expected.counts" > "$work/restored.counts"
  counts "$source_url" "$work/expected.counts" > "$work/source.counts"
  echo "-- $label: rows per table (live database / backup / restored)"
  join "$work/source.counts" "$work/expected.counts" | join -a 1 -e missing -o 0,1.2,1.3,2.2 - "$work/restored.counts" \
    | awk '{ flag = ($3 == $4) ? "" : "  MISMATCH"; printf "  %-36s %7s %7s %7s%s\n", $1, $2, $3, $4, flag }' | tee "$work/compare"
  if grep -q MISMATCH "$work/compare"; then echo "FAIL: $label: restored rows differ from the backup's." >&2; exit 1; fi
  [[ "$(wc -l < "$work/compare")" == "$(wc -l < "$work/expected.counts")" ]] || { echo "FAIL: $label: tables missing." >&2; exit 1; }
}

echo "== 1. --mode full into an empty database"
fresh_scratch
scripts/restore-backup.sh --identity "$work/key.txt" --target "$scratch_url" --mode full "$work/libellus.dump.age" > /dev/null
compare "full" "."

echo "== 2. --mode data into a freshly pushed project"
fresh_scratch
{
  echo 'create schema if not exists extensions;'
  for e in citext unaccent pgcrypto '"uuid-ossp"'; do echo "create extension if not exists $e with schema extensions;"; done
} | psql "$scratch_url" -X -q -v ON_ERROR_STOP=1 -f - > /dev/null
pg_restore --list "$work/plain.dump" | grep -vE ' SCHEMA - "?public"? | COMMENT - SCHEMA "?public"? ' > "$work/schema.list"
pg_restore --schema-only --no-owner --no-privileges --exit-on-error --use-list="$work/schema.list" --dbname="$scratch_url" "$work/plain.dump"
pg_restore --data-only --schema=supabase_migrations --table=schema_migrations --dbname="$scratch_url" "$work/plain.dump"
psql "$scratch_url" -X -q -v ON_ERROR_STOP=1 \
  -c 'insert into private.shelf_publish default values' -c 'insert into private.client_error_salt default values'
scripts/restore-backup.sh --identity "$work/key.txt" --target "$scratch_url" "$work/libellus.dump.age" > /dev/null
compare "data" '^(public|private)\.|^auth\.(users|identities) '
# The rows a fresh project's migrations seed are the backup's now, not the new project's.
salt="select md5(salt) from private.client_error_salt"
[[ "$(psql "$scratch_url" -X -A -t -c "$salt")" == "$(psql "$source_url" -X -A -t -c "$salt")" ]] \
  || { echo "FAIL: the seeded salt row was not replaced by the backup's." >&2; exit 1; }
echo "  the seeded rows (salt, shelf_publish): replaced by the backup's"

echo "== Guards"
if scripts/restore-backup.sh --identity "$work/key.txt" --target "$scratch_url" "$work/libellus.dump.age" > /dev/null 2>&1; then
  echo "FAIL: a restore into a database with members went ahead without --i-know." >&2; exit 1
fi
echo "  a target with members: refused"
if scripts/restore-backup.sh --identity "$work/wrong-key.txt" --target "$scratch_url" --dry-run "$work/libellus.dump.age" > /dev/null 2>&1; then
  echo "FAIL: the wrong key decrypted the backup." >&2; exit 1
fi
echo "  the wrong key: refused"
echo "PASS"

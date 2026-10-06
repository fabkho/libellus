#!/usr/bin/env bash
# Dumps the Libellus database, encrypts it with age on the way out and checks
# the result. The plaintext dump never touches the disk: pg_dump streams into
# age, and a copy of the same stream goes to `pg_restore --list`, which reads
# only the archive's table of contents.
#
#   DATABASE_URL=postgresql://… scripts/backup-db.sh --recipient age1… --out FILE
#
#   --recipient KEY   the age public key to encrypt to (age1…), or a file of them
#   --out FILE        where the encrypted dump goes (FILE.dump.age by convention)
#   --min-bytes N     fail when the encrypted dump is smaller (default 20000)
#
# What is in it (docs/OPERATIONS.md, "Backups"): schema and data of `public`,
# `private` and `auth` (members and their sign-in identities), and
# `supabase_migrations` (which migrations the data belongs to). Left out: the
# data of auth's sessions, tokens and audit log, and every other schema (Vault,
# pg_cron, pg_net, storage). Restore with scripts/restore-backup.sh.
#
# The check fails the run when the dump is too small or misses the data of any
# table the database has in those schemas, so a nightly job goes red instead
# of uploading something useless. Needs pg_dump, pg_restore and psql of the
# server's major version or newer, and age. Prints no connection details, no
# row counts, nothing of the data.
set -euo pipefail

recipient=''
out=''
min_bytes=20000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recipient) recipient="${2:?--recipient needs a key}"; shift 2 ;;
    --out) out="${2:?--out needs a file}"; shift 2 ;;
    --min-bytes) min_bytes="${2:?--min-bytes needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is not set." >&2; exit 2; }
[[ -n "$recipient" ]] || { echo "--recipient is required." >&2; exit 2; }
[[ -n "$out" ]] || { echo "--out is required." >&2; exit 2; }
[[ "$min_bytes" =~ ^[0-9]+$ ]] || { echo "--min-bytes must be a whole number." >&2; exit 2; }
if [[ -f "$recipient" ]]; then
  recipient_args=(-R "$recipient")
elif [[ "$recipient" == age1* ]]; then
  recipient_args=(-r "$recipient")
else
  echo "--recipient must be an age public key (age1…) or a file of them." >&2
  exit 2
fi
for tool in pg_dump pg_restore psql age; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed." >&2; exit 1; }
done

# The schemas whose schema and data are kept, and the tables whose data is not:
# what only makes sense on the project it came from (sign-in sessions and
# tokens, half-finished flows, GoTrue's own migration record, the audit log)
# and the CLI's local seed record.
SCHEMAS=(public private auth supabase_migrations)
NO_DATA=(
  auth.sessions auth.refresh_tokens auth.mfa_amr_claims auth.mfa_challenges
  auth.flow_state auth.one_time_tokens auth.saml_relay_states auth.audit_log_entries
  auth.schema_migrations auth.oauth_authorizations auth.oauth_client_states
  auth.webauthn_challenges supabase_migrations.seed_files
)

q() { psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }

server="$(q 'show server_version_num')"
server_major=$((server / 10000))
client_major="$(pg_dump --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
if (( client_major < server_major )); then
  echo "pg_dump $client_major cannot dump a Postgres $server_major server; install postgresql-client-$server_major." >&2
  exit 1
fi

# Every table the dump must hold data for, as the server lists them now.
schema_list="$(printf "'%s'," "${SCHEMAS[@]}")"
no_data_list="$(printf "'%s'," "${NO_DATA[@]}")"
expected="$(q "select n.nspname || '.' || c.relname
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r', 'p')
                  and n.nspname in (${schema_list%,})
                  and n.nspname || '.' || c.relname not in (${no_data_list%,})
                order by 1")"
# The ones without which a backup is no backup: if any is missing, the dump
# came from the wrong database or with too few rights.
for core in auth.users auth.identities public.accounts public.books public.library_entries \
            public.reading_sessions supabase_migrations.schema_migrations; do
  grep -qxF "$core" <<<"$expected" || { echo "The database has no table $core: is DATABASE_URL the Libellus database?" >&2; exit 1; }
done

# Owners and grants stay in the archive; scripts/restore-backup.sh leaves them out.
dump_args=(--format=custom --quote-all-identifiers)
for s in "${SCHEMAS[@]}"; do dump_args+=(--schema="$s"); done
for t in "${NO_DATA[@]}"; do dump_args+=(--exclude-table-data="$t"); done

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work" "$out.partial"' EXIT
mkfifo "$work/stream"
mkdir -p "$(dirname "$out")"

# The table of contents is read from a copy of the stream. The reader drains
# what it does not need, so tee never writes into a closed pipe.
{ status=0; pg_restore --list > "$work/toc" || status=$?; cat > /dev/null; exit "$status"; } < "$work/stream" &
lister=$!

pg_dump "${dump_args[@]}" --dbname="$DATABASE_URL" | tee "$work/stream" | age "${recipient_args[@]}" > "$out.partial"
wait "$lister" || { echo "pg_restore could not read the dump's table of contents." >&2; exit 1; }

# TOC lines: "<id>; <oid> <oid> TABLE DATA <schema> <table> <owner>".
listed="$(awk '$4 == "TABLE" && $5 == "DATA" { gsub(/"/, ""); print $6 "." $7 }' "$work/toc" | sort -u)"
missing="$(comm -23 <(sort -u <<<"$expected") <(printf '%s\n' "$listed"))"
if [[ -n "$missing" ]]; then
  echo "The dump has no data for:" >&2
  sed 's/^/  /' <<<"$missing" >&2
  exit 1
fi

bytes="$(wc -c < "$out.partial" | tr -d ' ')"
if (( bytes < min_bytes )); then
  echo "The encrypted dump is $bytes bytes, less than the $min_bytes expected." >&2
  exit 1
fi
mv "$out.partial" "$out"

echo "Dumped Postgres $server_major with pg_dump $client_major: data of $(wc -l <<<"$listed" | tr -d ' ') tables, $bytes bytes encrypted."

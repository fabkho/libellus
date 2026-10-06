#!/usr/bin/env bash
# Restores a backup made by scripts/backup-db.sh (the nightly workflow,
# .github/workflows/backup.yml) into a database. Step by step, and what a backup
# holds and does not: docs/OPERATIONS.md, "Backups".
#
#   RESTORE_DATABASE_URL=postgresql://… scripts/restore-backup.sh --identity KEYFILE [options] SOURCE
#
# SOURCE is one of
#   FILE.dump.age   a backup already downloaded
#   r2:KEY          the object KEY in the bucket (db/2026/10/07/libellus-….dump.age)
#   r2:latest       the newest object under db/
# r2: needs the aws CLI and R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
# CLOUDFLARE_ACCOUNT_ID (and BACKUP_R2_BUCKET, default libellus-backups).
#
# Options
#   --identity FILE  the age private key (AGE-SECRET-KEY-1…) the backup was encrypted to
#   --target URL     the database to restore into (default: $RESTORE_DATABASE_URL)
#   --mode data      (default) the data only, into a Supabase project whose schema is
#                    already there (`supabase db push` with at least the backup's migrations)
#   --mode full      schema and data, into an empty database: to read a backup next to
#                    the live data, never to bring a project back
#   --dry-run        decrypt, check the target and say what would happen; write nothing
#   --i-know         restore although the target is the production project or has members;
#                    the rows of every table the backup covers are replaced
#
# Everything runs in one transaction: a restore that fails leaves the target as it
# was. The decrypted dump lives only in a private temporary folder that is removed
# on exit. Needs age, and pg_restore and psql of the backup's major version or newer.
set -euo pipefail

# The owner's hosted project. A self-hoster sets her own.
PRODUCTION_REF="${LIBELLUS_PRODUCTION_REF:-ltedflcewdcqtqzcjeyr}"

identity=''
target="${RESTORE_DATABASE_URL:-}"
mode=data
dry_run=false
i_know=false
source=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) identity="${2:?--identity needs a key file}"; shift 2 ;;
    --target) target="${2:?--target needs a URL}"; shift 2 ;;
    --mode) mode="${2:?--mode needs data or full}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --i-know) i_know=true; shift ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    *) [[ -z "$source" ]] || { echo "Only one SOURCE, please." >&2; exit 2; }; source="$1"; shift ;;
  esac
done

[[ -n "$source" ]] || { echo "Which backup? Pass a FILE.dump.age, r2:KEY or r2:latest (try --help)." >&2; exit 2; }
[[ -n "$identity" && -r "$identity" ]] || { echo "--identity must name a readable age key file." >&2; exit 2; }
[[ -n "$target" ]] || { echo "No target: set RESTORE_DATABASE_URL or pass --target." >&2; exit 2; }
[[ "$mode" == data || "$mode" == full ]] || { echo "--mode is data or full." >&2; exit 2; }
for tool in age pg_restore psql; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed." >&2; exit 1; }
done

refuse() {
  if [[ "$i_know" == true ]]; then
    echo "Warning: $1 Going ahead (--i-know)." >&2
  else
    echo "Refusing: $1 Pass --i-know to restore anyway." >&2
    exit 1
  fi
}

if [[ -n "$PRODUCTION_REF" && "$target" == *"$PRODUCTION_REF"* ]]; then
  refuse "the target is the production project ($PRODUCTION_REF)."
fi

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ------------------------------------------------------------------ the backup

if [[ "$source" == r2:* ]]; then
  command -v aws >/dev/null || { echo "The aws CLI is needed for r2: sources." >&2; exit 1; }
  for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID; do
    [[ -n "${!v:-}" ]] || { echo "$v is not set (needed for r2: sources)." >&2; exit 2; }
  done
  bucket="${BACKUP_R2_BUCKET:-libellus-backups}"
  r2() {
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
      AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
      aws --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" "$@"
  }
  key="${source#r2:}"
  if [[ "$key" == latest ]]; then
    key="$(r2 s3api list-objects-v2 --bucket "$bucket" --prefix db/ --query 'Contents[].Key' --output text \
      | tr '\t' '\n' | grep '\.dump\.age$' | sort | tail -n 1 || true)"
    [[ -n "$key" ]] || { echo "No backups under db/ in $bucket." >&2; exit 1; }
  fi
  echo "Downloading $bucket/$key"
  r2 s3 cp --only-show-errors "s3://$bucket/$key" "$work/backup.dump.age"
  encrypted="$work/backup.dump.age"
else
  [[ -r "$source" ]] || { echo "Cannot read $source." >&2; exit 1; }
  encrypted="$source"
fi

age --decrypt --identity "$identity" --output "$work/backup.dump" "$encrypted" \
  || { echo "Could not decrypt the backup with that key." >&2; exit 1; }
dump="$work/backup.dump"
pg_restore --list "$dump" > "$work/toc" || { echo "The decrypted file is no pg_dump archive." >&2; exit 1; }

created="$(sed -n 's/^;[[:space:]]*Archive created at //p' "$work/toc")"
dumped_from="$(sed -n 's/^;[[:space:]]*Dumped from database version: //p' "$work/toc")"
dumped_by="$(sed -n 's/^;[[:space:]]*Dumped by pg_dump version: //p' "$work/toc")"
echo "Backup made $created from Postgres $dumped_from with pg_dump $dumped_by."

# The migrations the data belongs to, from the archive's supabase_migrations.schema_migrations.
pg_restore --data-only --schema=supabase_migrations --table=schema_migrations -f - "$dump" \
  | awk '/^COPY /{on=1; next} /^\\\.$/{on=0} on {print $1}' | sort -u > "$work/backup_migrations"
last_migration="$(tail -n 1 "$work/backup_migrations")"
echo "Its last migration: ${last_migration:-none recorded}."

# ------------------------------------------------------------------ the target

q() { psql "$target" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
echo "Target: Postgres $(q 'show server_version'), database $(q 'select current_database()')."

if [[ "$mode" == data ]]; then
  [[ "$(q "select to_regclass('supabase_migrations.schema_migrations') is not null")" == t ]] \
    || { echo "The target has no supabase_migrations.schema_migrations: run \`supabase db push\` on it first." >&2; exit 1; }
  q 'select version from supabase_migrations.schema_migrations' | sort -u > "$work/target_migrations"
  missing="$(comm -23 "$work/backup_migrations" "$work/target_migrations")"
  if [[ -n "$missing" ]]; then
    echo "The target lacks migrations the backup was made with; push them first (\`supabase db push\` from a checkout that has them):" >&2
    sed 's/^/  /' <<<"$missing" >&2
    exit 1
  fi
  members="$(q 'select (select count(*) from auth.users) + (select count(*) from public.accounts)')"
  if [[ "$members" != 0 ]]; then
    refuse "the target already has members (auth.users or public.accounts are not empty); their rows would be replaced."
  fi

  # The data of public and private, and of the members' sign-in records. The rest of
  # auth (sessions, tokens, MFA, SSO) belongs to the project it came from.
  awk '($4 == "TABLE" && $5 == "DATA") || ($4 == "SEQUENCE" && $5 == "SET") {
         s = $6; t = $7; gsub(/"/, "", s); gsub(/"/, "", t)
         if (s == "public" || s == "private" || (s == "auth" && (t == "users" || t == "identities"))) print
       }' "$work/toc" > "$work/restore.list"
  awk '$4 == "TABLE" { s = $6; t = $7; gsub(/"/, "", s); gsub(/"/, "", t); print s "." t }' \
    "$work/restore.list" > "$work/tables"

  # Triggers and foreign keys are off for the session (session_replication_role), so the
  # sign-up trigger does not run for restored members and the order of tables does not
  # matter. What a fresh project's migrations put in (the shelf_publish and salt rows) or
  # the target holds is cleared first: the backup's rows take their place.
  {
    echo 'set session_replication_role = replica;'
    while read -r t; do printf 'delete from "%s"."%s";\n' "${t%%.*}" "${t#*.}"; done < "$work/tables"
  } > "$work/before.sql"
  restore_args=(--data-only --no-owner --no-privileges --use-list="$work/restore.list")
else
  in_use="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'auth', 'supabase_migrations')")"
  [[ "$in_use" == 0 ]] || { echo "--mode full needs an empty database; this one has tables in public, private, auth or supabase_migrations." >&2; exit 1; }
  awk '$4 == "TABLE" && $5 != "DATA" { s = $5; t = $6; gsub(/"/, "", s); gsub(/"/, "", t); print s "." t }' \
    "$work/toc" > "$work/tables"
  # The extensions the schema uses live in `extensions`, as on Supabase.
  cat > "$work/before.sql" <<'SQL'
create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL
  # Every database has a schema public already; the archive's would clash with it.
  grep -vE ' SCHEMA - "?public"? | COMMENT - SCHEMA "?public"? ' "$work/toc" > "$work/restore.list"
  restore_args=(--no-owner --no-privileges --use-list="$work/restore.list")
fi

echo "Restoring ($mode): $(wc -l < "$work/tables" | tr -d ' ') tables."
if [[ "$dry_run" == true ]]; then
  echo "Dry run: nothing written."
  exit 0
fi

pg_restore "${restore_args[@]}" -f - "$dump" \
  | psql "$target" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$work/before.sql" -f - > /dev/null

# What arrived, table by table.
count_sql="$(while read -r t; do printf "select '%s' as t, count(*) as n from \"%s\".\"%s\" union all\n" "$t" "${t%%.*}" "${t#*.}"; done < "$work/tables")"
q "select t || ' ' || n from (${count_sql% union all}) c order by t" | awk '{ printf "  %-40s %8s\n", $1, $2 }'
echo "Restored."
if [[ "$mode" == data ]]; then
  echo "Not in a backup, to set up again: the Vault secret github_dispatch_token, the edge functions and their secrets, Auth settings (docs/OPERATIONS.md, Backups)."
fi

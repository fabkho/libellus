#!/usr/bin/env bash
# Manual check of the store-against-GC race with TWO real sessions (pgTAP runs in one transaction and cannot):
# docs/plans/owned-covers.md §6, supabase/migrations/20261110010000_cover_gc.sql.
#
#   supabase start && DB_CONTAINER=supabase_db_<project_id> supabase/functions/cover-store/gc_race_check.sh
#
# Uses its own keys (`aaaa…`, `bbbb…`) and sets `enabled` back to false and removes its rows at the end. LOCAL STACK ONLY.
set -euo pipefail
DB="${DB_CONTAINER:?set DB_CONTAINER to the local db container, e.g. supabase_db_libellus}"
psql() { docker exec -i "$DB" psql -U postgres -d postgres -X -q -t -A "$@"; }
A=$(printf 'a%.0s' {1..32}); B=$(printf 'b%.0s' {1..32})
cleanup() { psql -c "delete from private.cover_objects where key in ('$A','$B'); update private.cover_store_settings set enabled = false" >/dev/null; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; exit 1; }

psql -c "update private.cover_store_settings set enabled = true;
  insert into private.cover_objects (key, widths, orphaned_at) values ('$A','{120}', now() - interval '40 days'), ('$B','{120}', now() - interval '40 days')"

# 1. A reservation holds the row (uncommitted); a claim at the same time must skip it, and the object stays.
psql -c "begin; select public.cover_store_reserve('$A'); select pg_sleep(3); commit" >/dev/null &
sleep 1
claimed=$(psql -c "select key from public.cover_gc_claim(100) where key = '$A'")
wait
[ -z "$claimed" ] || fail "the claim took an object a reservation held"
[ "$(psql -c "select orphaned_at is null and deleting_at is null from private.cover_objects where key = '$A'")" = t ] || fail "the reservation did not keep the object"
echo "ok: reserve first, the claim skips the object and it is kept"

# 2. A claim holds the row (uncommitted); a reservation at the same time waits, then is refused.
psql -c "update private.cover_objects set deleting_at = null, orphaned_at = now() - interval '40 days' where key = '$B'"
psql -c "begin; select key from public.cover_gc_claim(100) where key = '$B'; select pg_sleep(3); commit" >/tmp/gc_race_claim.out &
sleep 1
reserved=$(psql -c "select public.cover_store_reserve('$B')")
wait
grep -q "$B" /tmp/gc_race_claim.out || fail "the claim did not take the old object"
[ "$reserved" = f ] || fail "a reservation after the claim was accepted"
echo "ok: claim first, the reservation waits and is refused"

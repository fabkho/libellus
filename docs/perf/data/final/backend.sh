#!/usr/bin/env bash
# The backend benchmark of docs/perf/final-round.md: scripts/perf/measure.sh with the throwaway stack's container and API
# given (`libellus-perf-final`, API on 55771), plus the screens as v1.9.1 asks them (screens-now.mjs) and Social V1.1's Home.
#   docs/perf/data/final/backend.sh s2 --members 300 --entries 150 --pool 15000 --heavy-entries 1000
# Needs a throwaway stack (seed.sh refuses anything else). Results in $OUT (default /tmp/perf-final/backend).
set -euo pipefail
label=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
perf=$here/../../../../scripts/perf
out=${OUT:-/tmp/perf-final/backend}; mkdir -p "$out"
member=${MEMBER:-2}
export container=${CONTAINER:-supabase_db_libellus-perf-final} API=${API:-http://127.0.0.1:55771}
export ANON_KEY=${ANON_KEY:?set ANON_KEY to the stack anon key}
"$perf/seed.sh" --container "$container" "$@" | tee "$out/$label-seed.txt" | tail -9
# The seed loads with triggers off and nothing analyses the tables: the first EXPLAINs would show plans no real database has.
docker exec "$container" psql -U postgres -d postgres -qc 'analyze' >/dev/null
node "$perf/explain.mjs" --container "$container" --member "$member" --role authenticated --plans "/tmp/plans-final-$label" > "$out/$label-explain-auth.txt"
node "$perf/explain.mjs" --container "$container" --member "$member" --role service_role > "$out/$label-explain-service.txt"
node "$perf/screens.mjs" --screen all --base "$member" --rounds 30 > "$out/$label-screens-old-requests.txt"
node "$here/screens-now.mjs" --screen all --base "$member" --rounds 30 > "$out/$label-screens.txt"
node "$here/screens-now.mjs" --screen home --members 20 --base 2 --rounds 10 > "$out/$label-home-x20.txt"
echo "done: $out/$label-*.txt"

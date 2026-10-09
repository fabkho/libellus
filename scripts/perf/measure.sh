#!/usr/bin/env bash
# One scenario, start to end, on the throwaway stack: seed, then EXPLAIN as a member with and without
# RLS, the screens alone, and 20 members opening Home at once. Results go to $OUT (default /tmp/perf-results).
#   scripts/perf/measure.sh s1 --members 30 --entries 150 --pool 2500
set -euo pipefail
label=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-/tmp/perf-results}; mkdir -p "$out"
member=${MEMBER:-2}
"$here/seed.sh" "$@" | tee "$out/$label-seed.txt" | tail -9
node "$here/explain.mjs" --member "$member" --role authenticated --plans "/tmp/plans-$label" > "$out/$label-explain-auth.txt"
node "$here/explain.mjs" --member "$member" --role service_role > "$out/$label-explain-service.txt"
MEMBER_BASE=$member node "$here/screens.mjs" --screen all --base "$member" --rounds 30 > "$out/$label-screens.txt"
node "$here/screens.mjs" --screen home --members 20 --base 2 --rounds 10 > "$out/$label-home-x20.txt"
echo "done: $out/$label-*.txt"

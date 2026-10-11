#!/usr/bin/env bash
# Loads scripts/perf/seed.sql into a THROWAWAY local stack (never a real project).
#   scripts/perf/seed.sh [--container supabase_db_libellus-perf] [--members 30] [--entries 150]
#                        [--pool 2500] [--heavy-entries 0]
set -euo pipefail
container=supabase_db_libellus-perf members=30 entries=150 pool=2500 heavy=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --container) container=$2; shift 2 ;;
    --members) members=$2; shift 2 ;;
    --entries) entries=$2; shift 2 ;;
    --pool) pool=$2; shift 2 ;;
    --heavy-entries) heavy=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
here=$(cd "$(dirname "$0")" && pwd)
docker exec -i "$container" psql -U postgres -d postgres -v confirm=throwaway \
  -v members="$members" -v entries="$entries" -v pool="$pool" -v heavy_entries="$heavy" < "$here/seed.sql"

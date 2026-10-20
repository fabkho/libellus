#!/usr/bin/env bash
# The local Supabase stack for a CI job, started in the background so the job
# can install and build while the images are pulled and the database boots.
#
#   scripts/ci-supabase.sh start   # returns at once; the start runs on in the background
#   scripts/ci-supabase.sh wait    # blocks until it has finished, prints its log, fails with it
#
# A failed start is tried once more from clean (`run`, the background part).
#
# A step's background process outlives the step (the runner only reaps it when
# the job ends), so `start` and `wait` can be steps apart. The start's output and
# exit status go to $RUNNER_TEMP, where `wait` reads them.
#
# Only what the suites use is started: the database, auth, the API (kong,
# PostgREST), the mail catcher (the sign-in code is read out of it), storage and realtime
# (the import job's live feed, web/e2e/import-job.spec.ts: the pill and the import page follow
# the member's job over a WebSocket). The pooler is off in config.toml. Not for local use: there,
# `supabase start` in the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${RUNNER_TEMP:-/tmp}"
log="$dir/supabase-start.log"
status="$dir/supabase-start.status"
EXCLUDE=studio,imgproxy,edge-runtime,logflare,vector,postgres-meta,supavisor

case "${1:-}" in
  start)
    rm -f "$status"
    nohup "$0" run > "$log" 2>&1 &
    echo "supabase start -x $EXCLUDE: in the background (log: $log)"
    ;;
  run)
    # The stack's ports (553xx, supabase/config.toml) lie in Linux's range of ports for outgoing
    # connections (32768-60999), and while it starts the job installs and downloads beside it: a
    # connection that drew 55322 kept the database from binding it. That is what failed the pgTAP
    # job's start twice in a row on 2026-10-11 ("failed to bind host port for 0.0.0.0:55322").
    # Outgoing connections keep below the range from here on, and the stack's own ports are never
    # handed out to one — also on the retry, which is why this sits here and not in `start`.
    if [ -n "${CI:-}" ] && [ "$(uname)" = Linux ]; then
      sudo sysctl -q -w net.ipv4.ip_local_port_range="32768 54999" \
        || echo "could not narrow the outgoing port range" >&2
      sudo sysctl -q -w net.ipv4.ip_local_reserved_ports="55320-55329" \
        || echo "could not reserve the stack's ports" >&2
    fi
    # A start can fail on the runner for reasons of the moment (the registry's rate limit, a
    # port the Docker proxy has not let go of yet): once more from clean before giving up.
    code=1
    started=$SECONDS
    for attempt in 1 2; do
      if supabase start -x "$EXCLUDE"; then code=0; break; fi
      echo "supabase start failed (attempt $attempt)"
      supabase stop --no-backup || true
      sleep 5
    done
    echo "supabase start took $((SECONDS - started)) s"
    # The status file appears whole (mv), never half written.
    echo "$code" > "$status.tmp"
    mv "$status.tmp" "$status"
    ;;
  wait)
    until [ -f "$status" ]; do sleep 1; done
    cat "$log"
    code="$(cat "$status")"
    echo "waited ${SECONDS}s more for it; exit status $code"
    exit "$code"
    ;;
  *)
    echo "usage: $0 start|wait" >&2
    exit 2
    ;;
esac

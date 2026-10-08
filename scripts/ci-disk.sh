#!/usr/bin/env bash
# The disk of a CI runner, for the flows job (.github/workflows/e2e.yml). A standard
# runner has little of it, and one job that runs every flow filled it: ENOSPC and
# "WebKit encountered an internal error" (run 37842426225, docs/TESTING.md, "Disk").
#
#   scripts/ci-disk.sh free     # remove what the job never uses; prints the disk before and after
#   scripts/ci-disk.sh sample   # returns at once; a line every two minutes goes to $RUNNER_TEMP
#   scripts/ci-disk.sh report   # df, the biggest consumers, docker, and the samples so far
#
# Not for local use: `free` deletes system folders.
set -uo pipefail

dir="${RUNNER_TEMP:-/tmp}"
samples="$dir/disk-samples.log"

# What is on the disk that this job owns, biggest suspects first. Each one is skipped
# when it is not there, so a missing folder never fails a step.
consumers() {
  local paths=(
    /var/lib/docker
    "$HOME/.cache/ms-playwright"
    "$HOME/.local/share/pnpm"
    "$HOME/.cache/pnpm"
    /opt/hostedtoolcache
    web/node_modules
    web/.nuxt
    web/.output-e2e
    web/test-results
    web/blob-report
    /tmp
  )
  for p in "${paths[@]}"; do
    [ -e "$p" ] && sudo du -sxh "$p" 2>/dev/null
  done
  return 0
}

case "${1:-}" in
  free)
    echo "::group::disk before"
    df -h /
    echo "::endgroup::"
    started=$SECONDS
    # Preinstalled and unused here: the Android SDK, .NET, Haskell, Swift, boost, CodeQL's
    # bundles, PowerShell, the images of Docker's cache. Several GB each (the Android SDK
    # alone is more than ten); the flows need Docker (the stack), Node and pnpm (set up by actions) and
    # WebKit and Chromium (Playwright's own).
    for p in /usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/.ghcup \
      /usr/share/swift /usr/local/share/boost /usr/local/share/powershell \
      /opt/hostedtoolcache/CodeQL; do
      sudo rm -rf "$p" &
    done
    docker image prune --all --force > /dev/null 2>&1 &
    wait
    echo "freed in $((SECONDS - started)) s"
    echo "::group::disk after"
    df -h /
    echo "::endgroup::"
    ;;
  sample)
    : > "$samples"
    # setsid: the step ends, the loop goes on until the job does.
    # shellcheck disable=SC2016 # the variables are the loop's own
    setsid nohup bash -c '
      while :; do
        printf "%s  " "$(date +%T)"
        df -h --output=used,avail,pcent / | tail -1
        sleep 120
      done
    ' >> "$samples" 2>&1 < /dev/null &
    echo "sampling the disk every 120 s into $samples"
    ;;
  report)
    echo "::group::df"
    df -h
    echo "::endgroup::"
    echo "::group::what the job holds"
    consumers
    echo "::endgroup::"
    echo "::group::docker"
    docker system df 2>&1 || true
    echo "::endgroup::"
    echo "::group::used / avail / use% on / since the start of the job"
    cat "$samples" 2>/dev/null || true
    echo "::endgroup::"
    ;;
  *)
    echo "usage: $0 free|sample|report" >&2
    exit 2
    ;;
esac

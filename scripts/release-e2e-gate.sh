#!/usr/bin/env bash
# A release ships only a commit whose full suite is green (docs/TESTING.md, "CI: what runs
# when"). Pull requests run the core flows; every run of CI on `main` (a push, the nightly run,
# a manual one) runs all of them, the `@full` flows included. This finds main's latest such run
# for the release's commit, or for its nearest first-parent ancestor that has one (the release
# commit itself only changes CHANGELOG.md and version.txt, which start no CI run), and fails
# unless it passed and its flows ran. A run still going is waited for (up to WAIT_SECONDS).
#
#   scripts/release-e2e-gate.sh <commit>      # GH_TOKEN (actions: read), GITHUB_REPOSITORY
#
# Run from a checkout with the commit's history (fetch-depth: 0).
set -euo pipefail

target="${1:?usage: $0 <commit>}"
repo="${GITHUB_REPOSITORY:-fabkho/libellus}"
wait_seconds="${WAIT_SECONDS:-1800}"
server="${GITHUB_SERVER_URL:-https://github.com}"

# The runs of CI on main for one commit that run the whole suite, newest first.
full_runs() {
  gh api "repos/$repo/actions/workflows/ci.yml/runs?branch=main&head_sha=$1&per_page=30" \
    --jq '[.workflow_runs[] | select(.event == "push" or .event == "schedule" or .event == "workflow_dispatch")] | sort_by(.created_at) | reverse'
}

checked=0
for commit in $(git rev-list --first-parent --max-count=30 "$target"); do
  checked=$((checked + 1))
  runs="$(full_runs "$commit")"
  [ "$(jq length <<< "$runs")" -gt 0 ] || continue

  run_id="$(jq -r '.[0].id' <<< "$runs")"
  while :; do
    run="$(gh api "repos/$repo/actions/runs/$run_id")"
    status="$(jq -r .status <<< "$run")"
    [ "$status" = completed ] && break
    if [ "$SECONDS" -ge "$wait_seconds" ]; then
      echo "::error::CI on main for ${commit:0:7} ($server/$repo/actions/runs/$run_id) is still $status after ${wait_seconds}s. Run the release again once it has passed."
      exit 1
    fi
    echo "CI on main for ${commit:0:7} is $status; waiting for it ($server/$repo/actions/runs/$run_id)"
    sleep 30
  done

  conclusion="$(jq -r .conclusion <<< "$run")"
  url="$(jq -r .html_url <<< "$run")"
  if [ "$conclusion" != success ]; then
    echo "::error::Not released: main's latest full CI run for ${commit:0:7} ended '$conclusion' ($url). The full suite (the @full flows included) must be green on main first: fix it there, or re-run that run if it was a flake, then run Release again (Actions → Release → Run workflow, with the tag)."
    exit 1
  fi
  # Green, and the flows really ran (a run whose e2e jobs were skipped proves nothing).
  flows="$(gh api "repos/$repo/actions/runs/$run_id/jobs?per_page=100" \
    --jq '[.jobs[] | select(.name | startswith("user flows (shard")) | .conclusion]')"
  if [ "$(jq length <<< "$flows")" -eq 0 ] || [ "$(jq '[.[] | select(. != "success")] | length' <<< "$flows")" -ne 0 ]; then
    echo "::error::Not released: main's latest CI run for ${commit:0:7} ($url) passed without running the user flows ($flows). Run CI on main by hand (gh workflow run CI --ref main), then Release again."
    exit 1
  fi
  echo "The full suite passed on main for ${commit:0:7}$([ "$commit" = "$(git rev-parse "$target^{commit}")" ] || echo ", the release's nearest ancestor with a run"): $url"
  exit 0
done

echo "::error::Not released: no CI run on main for ${target:0:7} or the $checked commits before it. Run CI on main by hand (gh workflow run CI --ref main), then Release again."
exit 1

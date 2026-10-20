#!/usr/bin/env bash
# Opens the bump pull request for @fabkho/ui when fabkho/ui has a release newer than the tag
# web/package.json pins. Run by .github/workflows/ui-bump.yml (weekly), or by hand from the repo root.
#
#   DRY_RUN=1 .github/scripts/ui-bump.sh   plan + local lockfile change; no push, no pull request
#
# Needs: gh (GH_TOKEN), pnpm, git, node. Writes the branch chore/ui-bump-<tag>; never touches main.
# Idempotent: a branch that already has a pull request (open or closed) is left alone.
set -euo pipefail

UI_REPO=fabkho/ui
DRY_RUN=${DRY_RUN:-0}

say() { echo "$*"; }
out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT" || true; }

pin=$(node -e '
  const p = require("./web/package.json");
  console.log((p.dependencies || {})["@fabkho/ui"] || (p.devDependencies || {})["@fabkho/ui"] || "");
')
case "$pin" in
  "github:$UI_REPO#v"*) current=${pin#github:$UI_REPO#} ;;
  *) echo "::error::@fabkho/ui must pin a tag (github:$UI_REPO#vX.Y.Z), found: '$pin'"; exit 1 ;;
esac

# releases/latest skips drafts and pre-releases; a tag without a release is not offered.
latest=$(gh api "repos/$UI_REPO/releases/latest" --jq .tag_name)
newest=$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)
say "pinned $current, latest release $latest"
if [ "$latest" = "$current" ] || [ "$newest" != "$latest" ]; then
  say "up to date: nothing to bump"
  out bump false
  exit 0
fi

branch="chore/ui-bump-$latest"
existing=$(gh pr list --head "$branch" --state all --json number --jq 'length')
if [ "$existing" != "0" ]; then
  say "a pull request for $branch already exists: nothing to do"
  out bump false
  exit 0
fi

say "plan: bump @fabkho/ui $current -> $latest on $branch"
out bump true
out branch "$branch"
out tag "$latest"
[ "$DRY_RUN" = 1 ] && say "DRY_RUN=1: the pull request is not opened"

git switch -c "$branch"
(cd web && pnpm add -E "@fabkho/ui@github:$UI_REPO#$latest")

changed=$(git diff --name-only)
if [ "$changed" != "$(printf 'web/package.json\nweb/pnpm-lock.yaml')" ]; then
  echo "::error::the bump changed more than web/package.json and web/pnpm-lock.yaml:"
  echo "$changed"
  exit 1
fi
git diff -- web/package.json

notes=$(mktemp)
{
  echo "Bumps \`@fabkho/ui\` from \`$current\` to \`$latest\`, the newest release of [$UI_REPO](https://github.com/$UI_REPO/releases/tag/$latest)."
  echo
  echo "Opened by \`.github/workflows/ui-bump.yml\` (weekly). The job dispatched the checks of \`ci.yml\` on this branch itself (\`flows=false\`: no Playwright flows), because pull requests made with \`GITHUB_TOKEN\` start no workflow; that run is the CI for this bump."
  echo
  echo "### Release notes from $UI_REPO"
  echo
  gh release view "$latest" --repo "$UI_REPO" --json body --jq .body || echo "(no release notes)"
} > "$notes"

if [ "$DRY_RUN" = 1 ]; then
  say "--- pull request body ---"
  cat "$notes"
  exit 0
fi

git add web/package.json web/pnpm-lock.yaml
git -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "chore(web): bump @fabkho/ui to $latest"
git push -q -u origin "$branch"
url=$(gh pr create --base main --head "$branch" \
  --title "chore(web): bump @fabkho/ui to $latest" --body-file "$notes")
say "opened $url"
gh workflow run ci.yml --ref "$branch" -f flows=false
say "dispatched the checks of ci.yml on $branch (no Playwright flows)"

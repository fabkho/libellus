#!/usr/bin/env bash
# Opens the bump pull request for a shared package when its repository has a release newer than the tag
# web/package.json pins. Two packages, each with its own pull request (they release independently, and a bad
# release of one must not hold the other up):
#
#   ui    @fabkho/ui    from fabkho/ui     branch chore/ui-bump-<tag>
#   chat  @fabkho/chat  from fabkho/chat   branch chore/chat-bump-<tag>
#
# Run by .github/workflows/ui-bump.yml (weekly, a matrix of the two), or by hand from the repo root:
#
#   .github/scripts/ui-bump.sh [ui|chat]   one package; none = both, one after the other
#   DRY_RUN=1 .github/scripts/ui-bump.sh   a plan per package + the local lockfile change; no push, no pull request,
#                                          and the working tree is left as it was
#
# Needs: gh (GH_TOKEN), pnpm, git, node. Never touches main.
# Idempotent: a branch that already has a pull request (open or closed) is left alone.
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}

say() { echo "$*"; }
out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT" || true; }

# No argument: every package, each by itself; one failing does not stop the other, but the run fails.
if [ $# -eq 0 ]; then
  status=0
  for key in ui chat; do
    say "=== $key ==="
    "$0" "$key" || status=1
  done
  exit $status
fi

key=$1
case "$key" in
  ui) PKG=@fabkho/ui REPO=fabkho/ui ;;
  chat) PKG=@fabkho/chat REPO=fabkho/chat ;;
  *) echo "::error::unknown package '$key' (ui or chat)"; exit 1 ;;
esac

pin=$(PKG=$PKG node -e '
  const p = require("./web/package.json");
  const n = process.env.PKG;
  console.log((p.dependencies || {})[n] || (p.devDependencies || {})[n] || "");
')
case "$pin" in
  "github:$REPO#v"*) current=${pin#github:$REPO#} ;;
  *) echo "::error::$PKG must pin a tag (github:$REPO#vX.Y.Z), found: '$pin'"; exit 1 ;;
esac

# releases/latest skips drafts and pre-releases; a tag without a release is not offered.
latest=$(gh api "repos/$REPO/releases/latest" --jq .tag_name)
newest=$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)
say "$PKG: pinned $current, latest release $latest"
if [ "$latest" = "$current" ] || [ "$newest" != "$latest" ]; then
  say "plan: $PKG is up to date, nothing to bump"
  out bump false
  exit 0
fi

branch="chore/$key-bump-$latest"
existing=$(gh pr list --head "$branch" --state all --json number --jq 'length')
if [ "$existing" != "0" ]; then
  say "plan: a pull request for $branch already exists, nothing to do"
  out bump false
  exit 0
fi

say "plan: bump $PKG $current -> $latest on $branch (title: chore(web): bump $PKG to $latest)"
out bump true
out branch "$branch"
out tag "$latest"
[ "$DRY_RUN" = 1 ] && say "DRY_RUN=1: the pull request is not opened"

if ! git diff --quiet -- web/package.json web/pnpm-lock.yaml; then
  echo "::error::web/package.json or web/pnpm-lock.yaml has changes already: commit or discard them first"
  exit 1
fi
start=$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)
git switch -c "$branch"
# A dry run leaves the tree as it found it, however it ends.
restore() {
  git checkout -q -- web/package.json web/pnpm-lock.yaml
  git checkout -q "$start"
  git branch -q -D "$branch"
}
[ "$DRY_RUN" = 1 ] && trap restore EXIT
# --lockfile-only: package.json and the lockfile are all a bump changes; node_modules stays as it is.
(cd web && pnpm add -E --lockfile-only "$PKG@github:$REPO#$latest")

changed=$(git diff --name-only)
if [ "$changed" != "$(printf 'web/package.json\nweb/pnpm-lock.yaml')" ]; then
  echo "::error::the bump changed more than web/package.json and web/pnpm-lock.yaml:"
  echo "$changed"
  exit 1
fi
# The other package's pin must not move with this one: they are bumped in separate pull requests.
git diff -U0 -- web/package.json | grep -E '^[+-] ' | grep -v -F "\"$PKG\"" && {
  echo "::error::the bump changed a line of web/package.json that is not the $PKG pin"
  exit 1
} || true
git diff -- web/package.json

notes=$(mktemp)
{
  echo "Bumps \`$PKG\` from \`$current\` to \`$latest\`, the newest release of [$REPO](https://github.com/$REPO/releases/tag/$latest). This pull request changes the \`$PKG\` pin only; the other shared package is bumped in its own pull request."
  echo
  echo "Opened by \`.github/workflows/ui-bump.yml\` (weekly). The job dispatched the checks of \`ci.yml\` on this branch itself (\`flows=false\`: no Playwright flows), because pull requests made with \`GITHUB_TOKEN\` start no workflow; that run is the CI for this bump."
  echo
  echo "### Release notes from $REPO"
  echo
  gh release view "$latest" --repo "$REPO" --json body --jq .body || echo "(no release notes)"
} > "$notes"

if [ "$DRY_RUN" = 1 ]; then
  say "--- pull request body ---"
  cat "$notes"
  exit 0
fi

git add web/package.json web/pnpm-lock.yaml
git -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "chore(web): bump $PKG to $latest"
git push -q -u origin "$branch"
url=$(gh pr create --base main --head "$branch" \
  --title "chore(web): bump $PKG to $latest" --body-file "$notes")
say "opened $url"
gh workflow run ci.yml --ref "$branch" -f flows=false
say "dispatched the checks of ci.yml on $branch (no Playwright flows)"

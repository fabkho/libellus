#!/usr/bin/env bash
# Regenerates the Android project from android/origin.txt and the shell's choices (docs/ANDROID.md):
# twa-manifest.mjs writes twa-manifest.json, `bubblewrap update` generates the project from it (fetching
# the icons it wants from the live site), patch-project.mjs and render-assets.mjs put the shell's own
# theme, icons and splash back over what Bubblewrap wrote. Review `git diff android/` and commit.
#
#   android/scripts/regenerate.sh          after changing origin.txt, twa-manifest.mjs or the design icons
#   android/scripts/regenerate.sh --bump   the same, and appVersionCode + 1 for a new release
#
# Needs Node, pnpm and Bubblewrap's config (~/.bubblewrap/config.json: JDK 17 and the Android SDK).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile --silent

if [ "${1:-}" = "--bump" ]; then
  # Bubblewrap's own bump would also set the version name to the code; keep "major.minor.patch"
  # by hand and only count the code up.
  node -e '
    const fs = require("node:fs")
    const manifest = JSON.parse(fs.readFileSync("twa-manifest.json", "utf8"))
    manifest.appVersionCode += 1
    fs.writeFileSync("twa-manifest.json", JSON.stringify(manifest, null, 2) + "\n")
    console.log(`appVersionCode ${manifest.appVersionCode} (appVersion ${manifest.appVersion}: change it by hand if you want)`)
  '
fi

node scripts/twa-manifest.mjs
pnpm exec bubblewrap update --skipVersionUpgrade
node scripts/patch-project.mjs
node scripts/render-assets.mjs
echo "Regenerated. Review git diff android/ and commit it."

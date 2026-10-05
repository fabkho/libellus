#!/usr/bin/env bash
# Regenerates the Android project from twa-manifest.json (#90), then puts Libellus' own icons
# back: `bubblewrap update` rewrites everything it generated (and fetches the icons from the live
# web manifest), so render-icons.mjs has to run after it every time.
#
#   android/scripts/regenerate.sh          after changing twa-manifest.json
#   android/scripts/regenerate.sh --bump   the same, and appVersionCode + 1 for a new Play release
#
# Needs Node, web/node_modules (pnpm install in web/, for Playwright) and Bubblewrap's config
# (~/.bubblewrap/config.json: the JDK 17 and the Android SDK; docs/ANDROID.md).
set -euo pipefail
cd "$(dirname "$0")/.."

BUBBLEWRAP="npx --yes @bubblewrap/cli@1.25.0"

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

$BUBBLEWRAP update --skipVersionUpgrade
node scripts/render-icons.mjs
echo "Regenerated. Review git diff android/ and commit it."

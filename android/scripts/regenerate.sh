#!/usr/bin/env bash
# Regenerates the Android project from android/origin.txt and the shell's choices (docs/ANDROID.md):
# twa-manifest.mjs writes twa-manifest.json, `bubblewrap update` generates the project from it (fetching
# the icons it wants from the live site), patch-project.mjs and render-assets.mjs put the shell's own
# theme, icons and splash back over what Bubblewrap wrote. Review `git diff android/` and commit.
#
#   android/scripts/regenerate.sh          after changing origin.txt, twa-manifest.mjs or the design icons, and for
#                                          a new web version: the APK's version is version.txt's (twa-manifest.mjs)
#
# Needs Node, pnpm and Bubblewrap's config (~/.bubblewrap/config.json: JDK 17 and the Android SDK).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile --silent

node scripts/twa-manifest.mjs
pnpm exec bubblewrap update --skipVersionUpgrade
node scripts/patch-project.mjs
node scripts/render-assets.mjs
echo "Regenerated. Review git diff android/ and commit it."

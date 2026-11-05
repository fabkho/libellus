#!/usr/bin/env bash
# Builds the signed release of the Android app (docs/ANDROID.md): an APK for installing by hand
# (`adb install`, or the file on the phone) and an AAB for Google Play, later.
#
#   android/scripts/build-release.sh [out-dir]    (default: /tmp/betterreads-android-release)
#
# The keystore is ~/.android-keys/betterreads-upload.jks (android/scripts/create-upload-key.sh);
# its password comes from the macOS login Keychain (services betterreads-android-store and
# betterreads-android-key), never from a file. Override with BETTERREADS_KEYSTORE, or set
# BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD yourself (CI).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-/tmp/betterreads-android-release}"
KEYSTORE="${BETTERREADS_KEYSTORE:-$HOME/.android-keys/betterreads-upload.jks}"
ALIAS=betterreads-upload
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"

if [ ! -f "$KEYSTORE" ]; then
  echo "No keystore at $KEYSTORE: run android/scripts/create-upload-key.sh first (docs/ANDROID.md)." >&2
  exit 1
fi

# The project must match twa-manifest.json; otherwise Bubblewrap stops to ask, and its
# regeneration would drop the splash, the icons and the theme the shell adds (regenerate.sh).
if [ "$(shasum -a 1 twa-manifest.json | cut -d' ' -f1)" != "$(cat manifest-checksum.txt)" ]; then
  echo "twa-manifest.json changed since the project was generated: run android/scripts/regenerate.sh first." >&2
  exit 1
fi

pnpm install --frozen-lockfile --silent

if [ -z "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" ]; then
  BUBBLEWRAP_KEYSTORE_PASSWORD="$(security find-generic-password -a betterreads -s betterreads-android-store -w)"
fi
if [ -z "${BUBBLEWRAP_KEY_PASSWORD:-}" ]; then
  BUBBLEWRAP_KEY_PASSWORD="$(security find-generic-password -a betterreads -s betterreads-android-key -w)"
fi
export BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD

pnpm exec bubblewrap build --skipPwaValidation --signingKeyPath="$KEYSTORE" --signingKeyAlias="$ALIAS"

mkdir -p "$OUT"
VERSION="$(node -p 'const m = require("./twa-manifest.json"); `${m.appVersion}-${m.appVersionCode}`')"
cp app-release-bundle.aab "$OUT/betterreads-$VERSION.aab"
cp app-release-signed.apk "$OUT/betterreads-$VERSION.apk"
mkdir -p "$HOME/Downloads"
cp "$OUT/betterreads-$VERSION.apk" "$HOME/Downloads/BetterReads-$(node -p 'require("./twa-manifest.json").appVersion').apk"
rm -f app-release-bundle.aab app-release-signed.apk app-release-unsigned-aligned.apk app-release-signed.apk.idsig

# The key the build was signed with has to be in web/public/.well-known/assetlinks.json, or the
# app opens with Chrome's address bar (a Custom Tab instead of a Trusted Web Activity).
FINGERPRINT="$("$JAVA_HOME/bin/keytool" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" \
  -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD" | sed -n 's/^.*SHA256: *//p')"
echo
echo "Built $OUT/betterreads-$VERSION.apk (adb install, or the file on the phone) and $OUT/betterreads-$VERSION.aab (Play, later)."
echo "Copied to ~/Downloads/BetterReads-<version>.apk"
echo "Signing key SHA-256: $FINGERPRINT"
if ! grep -q "$FINGERPRINT" ../web/public/.well-known/assetlinks.json; then
  echo "WARNING: this fingerprint is not in web/public/.well-known/assetlinks.json yet (docs/ANDROID.md)." >&2
fi

#!/usr/bin/env bash
# Builds the signed release of the Android app (#90): the AAB for Google Play and an APK for
# installing by hand (`adb install`), signed with the upload key.
#
#   android/scripts/build-release.sh [out-dir]    (default: /tmp/libellus-android-release)
#
# The upload keystore is ~/.android-keys/libellus-upload.jks (android/scripts/create-upload-key.sh);
# its password comes from the macOS login Keychain (services libellus-android-upload-store and
# libellus-android-upload-key), never from a file. Override with LIBELLUS_UPLOAD_KEYSTORE, or set
# BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD yourself (CI, docs/ANDROID.md).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-/tmp/libellus-android-release}"
KEYSTORE="${LIBELLUS_UPLOAD_KEYSTORE:-$HOME/.android-keys/libellus-upload.jks}"
ALIAS=libellus-upload
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
BUBBLEWRAP="npx --yes @bubblewrap/cli@1.25.0"

if [ ! -f "$KEYSTORE" ]; then
  echo "No upload keystore at $KEYSTORE: run android/scripts/create-upload-key.sh first (docs/ANDROID.md)." >&2
  exit 1
fi

# The project must match twa-manifest.json; otherwise Bubblewrap stops to ask, and its
# regeneration would drop the icons render-icons.mjs draws.
if [ "$(shasum -a 1 twa-manifest.json | cut -d' ' -f1)" != "$(cat manifest-checksum.txt)" ]; then
  echo "twa-manifest.json changed since the project was generated: run android/scripts/regenerate.sh first." >&2
  exit 1
fi

if [ -z "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" ]; then
  BUBBLEWRAP_KEYSTORE_PASSWORD="$(security find-generic-password -a libellus -s libellus-android-upload-store -w)"
fi
if [ -z "${BUBBLEWRAP_KEY_PASSWORD:-}" ]; then
  BUBBLEWRAP_KEY_PASSWORD="$(security find-generic-password -a libellus -s libellus-android-upload-key -w)"
fi
export BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD

$BUBBLEWRAP build --signingKeyPath="$KEYSTORE" --signingKeyAlias="$ALIAS"

mkdir -p "$OUT"
VERSION="$(node -p 'const m = require("./twa-manifest.json"); `${m.appVersion}-${m.appVersionCode}`')"
cp app-release-bundle.aab "$OUT/libellus-$VERSION.aab"
cp app-release-signed.apk "$OUT/libellus-$VERSION.apk"
rm -f app-release-bundle.aab app-release-signed.apk app-release-unsigned-aligned.apk app-release-signed.apk.idsig

# The key the build was signed with has to be in web/public/.well-known/assetlinks.json, or the
# app opens with Chrome's address bar (a Custom Tab instead of a Trusted Web Activity).
FINGERPRINT="$("$JAVA_HOME/bin/keytool" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" \
  -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD" | sed -n 's/^.*SHA256: *//p')"
echo
echo "Built $OUT/libellus-$VERSION.aab (Play) and $OUT/libellus-$VERSION.apk (adb install)."
echo "Upload key SHA-256: $FINGERPRINT"
if ! grep -q "$FINGERPRINT" ../web/public/.well-known/assetlinks.json; then
  echo "WARNING: this fingerprint is not in web/public/.well-known/assetlinks.json yet (docs/ANDROID.md)." >&2
fi

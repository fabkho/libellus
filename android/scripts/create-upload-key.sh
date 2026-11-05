#!/usr/bin/env bash
# Creates BetterReads' signing key, once, on the owner's Mac (docs/ANDROID.md).
#
# It signs the APK you sideload now and is the upload key if the app goes to Google Play later.
# The keystore lives outside the repository, in ~/.android-keys/; its password goes into the
# macOS login Keychain (never into a file). PKCS12 keystores have a single password for the
# store and the key, so the same random password is stored under both Keychain services the
# build reads (…-store and …-key). Prints the key's SHA-256 fingerprint for assetlinks.json.
set -euo pipefail

KEYSTORE="${BETTERREADS_KEYSTORE:-$HOME/.android-keys/betterreads-upload.jks}"
ALIAS=betterreads-upload
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
KEYTOOL="$JAVA_HOME/bin/keytool"

if [ -e "$KEYSTORE" ]; then
  echo "$KEYSTORE exists already; not overwriting the key." >&2
  exit 1
fi
if security find-generic-password -a betterreads -s betterreads-android-store >/dev/null 2>&1; then
  echo "The Keychain already has betterreads-android-store; remove it first if the keystore is really gone." >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYSTORE")"
chmod 700 "$(dirname "$KEYSTORE")"

PASSWORD="$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40)"
security add-generic-password -a betterreads -s betterreads-android-store \
  -l "BetterReads Android keystore password" -w "$PASSWORD"
security add-generic-password -a betterreads -s betterreads-android-key \
  -l "BetterReads Android key password" -w "$PASSWORD"

"$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=BetterReads, O=BetterReads, C=DE" \
  -storepass "$PASSWORD" -keypass "$PASSWORD"
chmod 600 "$KEYSTORE"

"$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$PASSWORD" | grep -E 'SHA(1|256):'
echo
echo "Put the SHA-256 into web/public/.well-known/assetlinks.json and back the .jks and the password up (docs/ANDROID.md)."

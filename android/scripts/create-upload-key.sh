#!/usr/bin/env bash
# Creates Libellus' Play upload key (#90), once, on the owner's Mac.
#
# The keystore lives outside the repository, in ~/.android-keys/; its password goes into the
# macOS login Keychain (never into a file). PKCS12 keystores have a single password for the
# store and the key, so the same random password is stored under both Keychain services the
# build reads (…-store and …-key). Prints the key's SHA-256 fingerprint for assetlinks.json.
set -euo pipefail

KEYSTORE="${LIBELLUS_UPLOAD_KEYSTORE:-$HOME/.android-keys/libellus-upload.jks}"
ALIAS=libellus-upload
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
KEYTOOL="$JAVA_HOME/bin/keytool"

if [ -e "$KEYSTORE" ]; then
  echo "$KEYSTORE exists already; not overwriting the upload key." >&2
  exit 1
fi
if security find-generic-password -a libellus -s libellus-android-upload-store >/dev/null 2>&1; then
  echo "The Keychain already has libellus-android-upload-store; remove it first if the keystore is really gone." >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYSTORE")"
chmod 700 "$(dirname "$KEYSTORE")"

PASSWORD="$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40)"
security add-generic-password -a libellus -s libellus-android-upload-store \
  -l "Libellus Android upload keystore password" -w "$PASSWORD"
security add-generic-password -a libellus -s libellus-android-upload-key \
  -l "Libellus Android upload key password" -w "$PASSWORD"

"$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Fabian Kirchhoff, O=Libellus, C=DE" \
  -storepass "$PASSWORD" -keypass "$PASSWORD"
chmod 600 "$KEYSTORE"

"$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$PASSWORD" | grep -E 'SHA(1|256):'

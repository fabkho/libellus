# The Android app (Google Play)

Libellus on Google Play is a **Trusted Web Activity** (TWA, issue #90): a small Android app,
`dev.fabkho.libellus`, that opens https://libellus.fabkho.dev in Chrome full screen, without
Chrome's address bar. It is the same web app, from the same deploy: a change to the website
reaches the Play app the moment Cloudflare Pages has it, with no app update. Only what the
Android shell itself carries (name, icons, colours, splash, shortcuts, share target, package,
version) needs a new build.

What the shell adds over the installed PWA: a Play Store listing (an invite-only app needs only
the internal testing track), a real adaptive icon with a **monochrome layer**, so Android's themed
icons work (a WebAPK ignores the manifest's `monochrome` icon, Chromium 40277264), a native
splash, links to `libellus.fabkho.dev` opening in the app, and an app that survives clearing
Chrome's data. Installing the PWA from Chrome keeps working for everybody else.

Chrome trusts the app with the full screen only if the site vouches for it:
`web/public/.well-known/assetlinks.json` (Digital Asset Links) has to list the SHA-256
fingerprint of every key the installed app may be signed with. Without a match, the app still
opens, but as a Custom Tab with the address bar on top.

## What is where

| | |
| --- | --- |
| `android/twa-manifest.json` | The source of truth: package, names, colours, icons, shortcuts, share target, version. Bubblewrap generates the project from it. |
| `android/app/`, `android/*.gradle`, `gradlew` | The generated Android project (Bubblewrap 1.25.0, `com.google.androidbrowserhelper`), committed. |
| `android/scripts/render-icons.mjs` | Draws the launcher icon (background, foreground and monochrome layers), the splash, the shortcut icons and the 512 px store icon from `design/icons/app/`. Runs after every regeneration. |
| `android/scripts/regenerate.sh` | `bubblewrap update` + `render-icons.mjs`; `--bump` counts the version code up. |
| `android/scripts/create-upload-key.sh` | Creates the upload key, once. |
| `android/scripts/build-release.sh` | The signed AAB (Play) and APK (by hand). |
| `android/scripts/store-screenshots.mts` | The listing's phone screenshots and feature graphic, from the emulator. |
| `docs/play/` | The listing's images: `icon-512.png`, `feature-graphic.png`, `phone-1…5-*.png`. |
| `web/public/.well-known/assetlinks.json` | Digital Asset Links. |
| `web/public/_headers` | Serves it as `application/json`, no redirect, cached an hour. |
| `web/app/pages/privacy.vue` | The privacy policy Play links to: https://libellus.fabkho.dev/privacy |

### The shell's choices

- Package `dev.fabkho.libellus`, app and launcher name *Libellus*, start URL `/`, scope the whole
  host, `standalone`, portrait.
- Splash: the rounded ribbons icon on `#0e0c0a` (the dark room), in both appearances.
- Status bar `#0e0c0a` while the splash shows; then the page's own `theme-color` (light or dark)
  takes over. Navigation bar: the room's surface per appearance, `#f4f0e9` light and `#0e0c0a`
  dark (a dark bar under the light page looked like a hole; tokens `color.surface`).
- Adaptive icon: the leather-red room as the background layer, the ribbons and lamp as the
  foreground, `monochrome.svg` as the monochrome layer (themed icons, Android 13+). Bubblewrap's
  own layout (the maskable icon shrunk onto white, no monochrome) is replaced by `render-icons.mjs`.
- Shortcuts (long-press the icon): Search (`/?search=1`), Update progress (`/?progress=1`),
  Library (`/library`), mirrored from the web manifest. Bubblewrap's "Site settings" shortcut is off.
- Share target: the web manifest's `/share` (GET `title`, `text`, `url`); Libellus shows up in
  Android's share sheet for text and links.
- Notifications delegation off (`enableNotifications: false`): the app sends none.
- Fallback when the site does not vouch for the key: a Custom Tab (`fallbackType: customtabs`).

## Building

Once per Mac:

```sh
brew install openjdk@17          # keg-only: nothing global changes, Bubblewrap is pointed at it
mkdir -p ~/.bubblewrap
echo '{"jdkPath":"/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk","androidSdkPath":"'$HOME'/Library/Android/sdk"}' > ~/.bubblewrap/config.json
yes | ~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "build-tools;36.1.0" "platforms;android-36"
# Bubblewrap looks for the SDK tools in <sdk>/tools or <sdk>/bin, the old layouts:
ln -s cmdline-tools/latest ~/Library/Android/sdk/tools
cd web && pnpm install           # render-icons.mjs draws with web's Playwright
```

(The SDK itself is the one `docs/TESTING.md` sets up for the emulator.)

- **A web change**: nothing to build. Deploy the website as usual.
- **A change to the shell** (`twa-manifest.json`, the icon SVGs): `android/scripts/regenerate.sh`,
  review and commit `android/`. Bubblewrap fetches the icons from the *live* web manifest and
  overwrites what it generated; `render-icons.mjs` then draws Libellus' own over them.
- **A new Play release**: Play refuses a version code it has seen.
  `android/scripts/regenerate.sh --bump` (version code + 1; change `appVersion`, the name people
  see, by hand if you like), commit, then `android/scripts/build-release.sh`.
- **The release build**: `android/scripts/build-release.sh [out-dir]` builds
  `libellus-<version>-<code>.aab` (for Play) and `.apk` (for `adb install`), signed with the upload
  key, into `/tmp/libellus-android-release/` unless told otherwise, and warns when the key's
  fingerprint is not in `assetlinks.json`. Builds are never committed (`.gitignore`: `*.aab`, `*.apk`).
- **A debug build** for the emulator, signed with Android's per-machine debug key:
  `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleDebug`
  → `android/app/build/outputs/apk/debug/app-debug.apk`.

### CI (optional, not set up)

A tag could build the AAB in GitHub Actions. Bubblewrap is not needed there (the project is
committed); Gradle builds it and `jarsigner` signs it. Secrets (repository settings, never in
the repo): `ANDROID_UPLOAD_KEYSTORE_BASE64` (`base64 -i ~/.android-keys/libellus-upload.jks`) and
`ANDROID_UPLOAD_KEYSTORE_PASSWORD`.

```yaml
# .github/workflows/android.yml (sketch)
on: { push: { tags: ['android-v*'] } }
jobs:
  aab:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - uses: android-actions/setup-android@v3
      - working-directory: android
        run: ./gradlew bundleRelease
      - working-directory: android
        env:
          KEYSTORE_BASE64: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_PASSWORD }}
        run: |
          echo "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/upload.jks"
          jarsigner -keystore "$RUNNER_TEMP/upload.jks" -storepass "$KEYSTORE_PASSWORD" \
            -signedjar libellus.aab app/build/outputs/bundle/release/app-release.aab libellus-upload
          rm "$RUNNER_TEMP/upload.jks"
      - uses: actions/upload-artifact@v4
        with: { name: libellus-aab, path: android/libellus.aab }
```

Uploading to Play from CI would need a Play service account as well; by hand is fine for an
invite-only app.

## Signing: the upload key

Play signs what people install with the **app signing key**, which Google keeps (Play App
Signing, mandatory for new apps). The owner signs only what he uploads, with the **upload key**.
Two keys, two fingerprints, both in `assetlinks.json`: the upload key for an APK installed by hand,
the app signing key for everything installed from Play.

| | |
| --- | --- |
| Keystore | `~/.android-keys/libellus-upload.jks` (outside the repo; PKCS12, RSA 4096, valid 10 000 days) |
| Alias | `libellus-upload` |
| Password | macOS login Keychain, account `libellus`, services `libellus-android-upload-store` and `libellus-android-upload-key` (PKCS12 has one password for store and key: the same value under both) |
| Backup | Bitwarden: one item with the keystore file as an **attachment** and the password |
| Upload key SHA-256 | *not created yet: `create-upload-key.sh` prints it; write it here* |
| App signing key SHA-256 | *Play Console, after the first upload: write it here* |

```sh
android/scripts/create-upload-key.sh
```

creates the keystore (refusing to overwrite one), stores a random password in the Keychain and
prints the SHA-1 and SHA-256 fingerprints. Read the password back with
`security find-generic-password -a libellus -s libellus-android-upload-store -w`, or print the
fingerprints again with
`keytool -list -v -keystore ~/.android-keys/libellus-upload.jks -alias libellus-upload` (JDK 17's
`keytool`: `/opt/homebrew/opt/openjdk@17/bin/keytool`).

**Back the keystore up into Bitwarden right after creating it** (the `.jks` file as an attachment
and the password in the same item). The Keychain alone dies with the Mac. Losing the upload key
is not the end of the app (Google holds the app signing key), but it means asking Play support
for an upload key reset, with a new key, a new fingerprint in `assetlinks.json` and a wait of
days before uploads work again.

Nothing of the key is ever committed: `.gitignore` refuses `*.jks`, `*.keystore`, `*.p12`, `*.pk8`.

## Digital Asset Links

`web/public/.well-known/assetlinks.json` holds one statement for `dev.fabkho.libellus` with the
list of fingerprints. In this PR the list holds two **placeholders** (`TODO-UPLOAD-KEY-SHA256…`,
`TODO-PLAY-APP-SIGNING-KEY-SHA256…`), because neither key exists yet; replace them before
merging (step 6 below):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "dev.fabkho.libellus",
      "sha256_cert_fingerprints": [
        "AB:CD:…:EF (upload key)",
        "12:34:…:56 (Play app signing key)"
      ]
    }
  }
]
```

(Fingerprints only, as 32 colon-separated upper-case hex pairs; JSON has no comments.)

The file has to come back from https://libellus.fabkho.dev/.well-known/assetlinks.json with
status 200, `Content-Type: application/json` and **no redirect**. `web/public/_headers` sets the
type (Cloudflare Pages would guess it anyway) and an hour's cache; `nuxt generate` copies both
into `.output/public/` (checked: `.output/public/.well-known/assetlinks.json` and
`.output/public/_headers`; `wrangler pages dev` serves it with exactly those headers). Check the
live one after a deploy:

```sh
curl -sI https://libellus.fabkho.dev/.well-known/assetlinks.json   # 200, content-type: application/json
```

and with Google's checker:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://libellus.fabkho.dev&relation=delegate_permission/common.handle_all_urls`.
Chrome caches a failed check; after fixing the file, clear the app's storage or reinstall it.

## Going live: the owner's steps

1. **Developer account.** https://play.google.com/console/signup, a personal account, the
   one-off **$25**. Google verifies the identity (an ID document) and wants an Android phone
   with the Play Console app to confirm it; allow a few days.
2. **Upload key.** On the Mac: `android/scripts/create-upload-key.sh`. Put the `.jks` and its
   password into Bitwarden at once. Write the printed SHA-256 into the table above.
3. **Create the app.** Play Console → *Create app*: name *Libellus*, default language English,
   *App*, *Free*, accept the declarations.
4. **Build and upload.** `android/scripts/build-release.sh`. Play Console → *Test and release* →
   *Testing* → *Internal testing* → *Create new release*. Play App Signing: accept
   *Google-generated app signing key* (the default). Upload `libellus-1.0.0-1.aab`, release
   name and notes, *Save*, *Review release*, *Start rollout to Internal testing*. Internal testing
   is invite-only and has no review wait.
5. **The app signing key's fingerprint.** Play Console → *Test and release* → *App integrity* →
   *App signing*: copy the **App signing key certificate SHA-256** (the page also shows a
   ready-made Digital Asset Links JSON snippet with it).
6. **assetlinks.json.** Replace the two placeholders in
   `web/public/.well-known/assetlinks.json` with the upload key's and the app signing key's
   SHA-256 (this branch, or a small PR on top), merge, let Pages deploy, check with `curl` as
   above. Until this is live the app opens with Chrome's address bar.
7. **Testers.** *Internal testing* → *Testers*: create an email list (up to 100 Google accounts),
   save, copy the **opt-in link** and send it. Each tester opens it on the phone signed in with
   that Google account, accepts, and installs Libellus from Play.
8. **Check on a phone**: no address bar, the dark splash, the themed icon, the shortcuts, sharing
   a link into Libellus, a `https://libellus.fabkho.dev/book/<id>` link opening in the app.
9. **Later, production (optional).** A personal developer account created after November 2023
   has to run a **closed test with at least 12 testers for 14 days** before Play allows a
   production release. Production also needs everything under *App content* and the store listing
   (below), an account for Play's reviewers (sign-in by emailed code: they need an invite and a
   way to get the code), and in-app account deletion (#101).

Every later release: `regenerate.sh --bump`, commit, `build-release.sh`, *Create new release* on
the track, upload. The fingerprints do not change.

Sideloading the APK (`adb install libellus-…apk`, or opening the file on the phone) needs
*Install unknown apps* allowed for the installer, and the upload key's fingerprint in
`assetlinks.json`. Google is rolling out developer verification for apps installed outside Play
on certified devices; registering the package in the Play account covers it. Check the current
state when sideloading to other people.

### Store listing

*Grow users* → *Store presence* → *Main store listing*:

| | |
| --- | --- |
| App name | Libellus |
| Short description (≤ 80) | Your books: what you want to read, what you are reading, what you have read. |
| Full description (≤ 4000) | Libellus keeps your reading quietly: the books you want to read, the one on your nightstand and everything you have finished, with the dates, your progress, your stars and your reviews. Find any book by title, author or ISBN (or scan its barcode), keep collections, see your year in reading. Light and dark, works offline, no ads, no tracking. Libellus is invite-only: you need a code from someone who uses it. |
| App icon | `docs/play/icon-512.png` (512 × 512, Play rounds it) |
| Feature graphic | `docs/play/feature-graphic.png` (1024 × 500) |
| Phone screenshots | `docs/play/phone-1-home-dark.png` … `phone-5-home-light.png` (1080 × 1920, 9:16; Play wants 2 to 8) |
| Category | Books & Reference |
| Contact email | fabian@fabkho.dev |
| Website | https://libellus.fabkho.dev |
| Privacy policy | https://libellus.fabkho.dev/privacy |

`android/scripts/store-screenshots.mts` makes the screenshots again (the dev server on the local
stack, the emulator with Chrome; see the script's header): a test member with a Library of real
books, signed in through the screens, Home, Library, a book and the search in dark and Home in
light, each framed in the dark room with a caption; and the feature graphic.

### App content (Policy → App content)

- **Privacy policy**: https://libellus.fabkho.dev/privacy (`web/app/pages/privacy.vue`, readable
  signed out, linked from sign-in, sign-up and the Profile).
- **Ads**: no ads.
- **App access**: all functionality needs an account (invite code + emailed code). For internal
  testing nothing is checked; for production, give Play's reviewers instructions and an account.
- **Content rating** (IARC questionnaire): category *Reference, News, or Educational*; no violence,
  no sexual content, no gambling, no user interaction (reviews are private to the member, nothing is
  shared between members) → *Everyone / PEGI 3*.
- **Target audience**: 16 and over (the privacy policy's minimum age): tick 16–17 and 18+. Not
  designed for children.
- **News app**: no. **Government app**: no. **Financial features**: none. **Health**: none.
- **Data safety**, the answers:

  | Question | Answer |
  | --- | --- |
  | Does the app collect or share any of the required user data types? | Yes |
  | Is all user data encrypted in transit? | Yes (HTTPS only) |
  | Which ways can users request that their data is deleted? | Users can request deletion: by email (https://libellus.fabkho.dev/privacy); in the app once #101 is done |
  | Personal info → **Email address** | Collected, not shared. Required. Purposes: *App functionality*, *Account management* |
  | Personal info → **Name** (first name) | Collected, not shared. Optional. Purpose: *App functionality* (Home's greeting) |
  | App activity → **Other user-generated content** (reviews, collections) | Collected, not shared. Optional. Purpose: *App functionality* |
  | App activity → **Other actions** (books in the Library, reading sessions with dates, progress, ratings) | Collected, not shared. Required for the app to be useful; purpose: *App functionality* |
  | Everything else (location, contacts, photos, files, device IDs, crash logs, diagnostics, search history, web browsing, financial, health, messages, audio) | Not collected |

  Notes for the form: Supabase, Cloudflare and Resend are service providers (processing for
  Libellus), which Play does not count as sharing. Search words go from the phone straight to
  Apple's iTunes Search and Open Library at the member's request and are not kept by Libellus
  (not "collected"). The camera (barcode scanner) reads frames on the device and sends nothing.
  A Goodreads import file is read on the device; only the books imported are stored.

## Testing the app on the emulator

The emulator rig is `docs/TESTING.md`'s (`emulator-5554`). Until `assetlinks.json` with a key
the build is signed with is live on production, Chrome would open the app as a Custom Tab; tell
this Chrome to skip the check for the site (the device already reads Chrome's command line,
`am set-debug-app --persistent com.android.chrome`, which stands in for chrome://flags' *Enable
command line on non-rooted devices*):

```sh
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run --disable-digital-asset-link-verification-for-url=https://libellus.fabkho.dev' > /data/local/tmp/chrome-command-line"
adb shell am force-stop com.android.chrome
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.fabkho.libellus/.LauncherActivity
# Links to the site open in the app only once Android has verified assetlinks.json; until then:
adb shell pm set-app-links-user-selection --user 0 --package dev.fabkho.libellus true libellus.fabkho.dev
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d https://libellus.fabkho.dev/book/<id>
# Afterwards, the command line back to docs/TESTING.md's:
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
adb shell am force-stop com.android.chrome
```

What the first run checked (Pixel 9 emulator, Android 17, Chrome 145, the debug build against
production; #90):

- Opens full screen with no address bar (`TranslucentCustomTabActivity` in the app's own task,
  Chrome's one-off "Running in Chrome" note at the bottom), the sign-in screen from production.
- The dark splash: the rounded ribbons icon on `#0e0c0a`, then the page.
- Back: inside the app it goes back in the app's history (sign-up → sign-in → Back → sign-up);
  at the first page it leaves the app for the launcher.
- `https://libellus.fabkho.dev/sign-up` and `/book/<id>` from another app open in the app (a book
  signed out lands on sign-in, as on the web).
- Long-press: Search, Update progress, Library, with their own icons; Search launches the app at
  `/?search=1` (signed out, sign-in takes over as on the web).
- The share sheet lists Libellus; sharing text opened
  `/share?text=Piranesi+by+Susanna+Clarke+https%3A%2F%2Fopenlibrary.org%2F…` in the app.
- Themed icons (Wallpaper & style → Icons → *Minimal*): Libellus is drawn from its monochrome layer,
  the ribbons and the lamp in the theme's colours.
- The debug key's SHA-256 (`52:14:DB:D9:…:8E:C5:F0`, Android's per-machine debug key) is
  deliberately **not** in `assetlinks.json`: the command-line flag stood in for it.

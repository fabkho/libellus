# The Android app (sideloaded APK)

BetterReads on Android is a **Trusted Web Activity** (TWA, issue #90): a small Android app,
`de.betterreads.app`, that opens https://betterreads.de in Chrome full screen, without Chrome's
address bar. It is the same web app from the same deploy: a change to the website reaches the
Android app the moment Cloudflare Pages has it, with no app update. Only what the shell itself
carries (name, icons, colours, splash, shortcuts, share target, package, version) needs a new build.

For now it is installed **by hand** (an APK from the owner's Mac, no Play Console). iOS stays a PWA.
The package id is **not final until a Play release**: an id, once on Play, is for good.

What the shell adds over the PWA installed from Chrome:

- **A real icon.** An adaptive icon (the night room, the mark) with a **monochrome layer**, so
  Android 13+'s themed icons work (Chrome's WebAPK ignores the manifest's `monochrome`, Chromium
  40277264), and no Chrome badge in the corner.
- **A native splash**: the mark's animation on the night room, drawn by the system (Android 12+).
  A web page cannot do that. What it can and cannot do is below.
- Links to `betterreads.de` open in the app; BetterReads is in Android's share sheet; the three
  shortcuts are on a long press; the app survives clearing Chrome's data.

What it is **not**: not a second codebase (no WebView, no native screens), not offline by itself (the
service worker and storage are Chrome's, as for the PWA), not on any store, not for iOS. It needs
Chrome (or another TWA-capable browser) on the phone. It does not update itself: a new shell is a new
APK; the web app updates as ever.

Chrome gives the app the full screen only if the site vouches for it: `web/public/.well-known/assetlinks.json`
(Digital Asset Links) has to list the SHA-256 fingerprint of the key the installed APK is signed with.
Without a match the app still opens, but as a Custom Tab with the address bar on top. This is the one
thing that needs a deploy ([Digital Asset Links](#digital-asset-links)).

## What is where

| | |
| --- | --- |
| `android/origin.txt` | **The one place the app's address lives** (`https://betterreads.de`). |
| `android/scripts/twa-manifest.mjs` | Writes `twa-manifest.json` (Bubblewrap's input) from `origin.txt`: package, names, colours, shortcuts, share target, version. The shell's choices are here. |
| `android/twa-manifest.json`, `android/app/`, `android/*.gradle`, `gradlew` | The generated Android project (Bubblewrap 1.27.0, `androidbrowserhelper` 2.7.4), committed. |
| `android/overlay/` | What the shell adds to it: the animated splash, the themes, the icon's layers (`res/`), the launcher activity (`java/`). Bubblewrap rewrites `res/` and the Java on every update, so these are copied back in. |
| `android/scripts/regenerate.sh` | `twa-manifest.mjs` → `bubblewrap update` → `patch-project.mjs` (manifest theme, adaptive icon, launcher activity, overlay) → `render-assets.mjs` (splash PNGs, shortcut icons). |
| `android/scripts/create-upload-key.sh` | Creates the signing key, once. |
| `android/scripts/build-release.sh` | The signed APK (sideload) and AAB (Play, later). |
| `web/public/.well-known/assetlinks.json` | Digital Asset Links. |
| `web/public/_headers` | Serves it as `application/json`, no redirect, cached an hour. |

### The shell's choices

- Package `de.betterreads.app`, name and launcher label *BetterReads*, start URL `/`, scope the whole
  host, `standalone`, **no orientation lock** (the web manifest has none: the app turns with the phone).
- Colours from `design/tokens.json`: the status bar is the night room `#0e0c0a` until the page's own
  `theme-color` takes over; the navigation bar is the room per appearance (`#f4f0e9` light,
  `#0e0c0a` dark).
- Shortcuts (long press), mirrored from the web manifest: Search (`/?search=1`), Update progress
  (`/?progress=1`), Library (`/library`); their icons are `design/icons/app/shortcuts/*.svg`.
- Share target: the web manifest's `/share` (`title`, `text`, `url`, and EPUB files); BetterReads shows
  up in the share sheet for text, links and `application/epub+zip`.
- minSdk 26 (Android 8): adaptive icons and vector drawables everywhere, no legacy PNG icons. Target and
  compile SDK 36.
- Notifications delegation off: the app sends none. "Site settings" on (`enableSiteSettingsShortcut`),
  which the PWA has no use for, but `androidbrowserhelper` 2.7.4 crashes at launch with
  `Component class …ManageDataLauncherActivity does not exist` when it is off. It gives Android's
  *Storage → Manage space* a way into Chrome's site settings.
- Fallback when the site does not vouch for the key: a Custom Tab (`fallbackType: customtabs`).
- `.epub` as a MIME type: Bubblewrap copies the share target's file filters into an intent filter, and
  `.epub` is an extension, not a MIME type (the install fails with `MalformedMimeTypeException`);
  `patch-project.mjs` removes it. `application/epub+zip` stays.

### Changing the address

`android/origin.txt` is the only place: `android/scripts/regenerate.sh` rewrites the host, start URL,
scope, share target, shortcuts and `assetStatements` from it. The new host has to serve
`/.well-known/assetlinks.json` too (it is the same file: both hosts are one Pages deploy today), and the
installed app then belongs to the new host only. `libellus.fabkho.dev` serves the same app, but a link
there opens in Chrome, not in the app (add it to `additionalTrustedOrigins` in `twa-manifest.mjs` if that
should change).

## Building

Tooling used (all current when this was written, 2 Nov 2026, except where noted):

| | |
| --- | --- |
| Bubblewrap | `@bubblewrap/cli` **1.27.0** (latest). Pins the rest: Gradle **8.11.1**, Android Gradle Plugin **8.9.1**, `androidbrowserhelper` **2.7.4** (latest). Gradle 9.8 and AGP 9 exist but are not what Bubblewrap generates for; they were not forced on it. |
| JDK | OpenJDK **17.0.20** (`brew install openjdk@17`; Bubblewrap's own choice, AGP 8.9 supports 17–21). |
| Android SDK | platform **36**, build-tools **36.1.0**, command-line tools 15641748 (`docs/TESTING.md` sets the SDK up for the emulator). |
| Node / pnpm | Node 24, pnpm 12. |

Once per Mac:

```sh
brew install openjdk@17          # keg-only: nothing global changes
yes | ~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "build-tools;36.1.0" "platforms;android-36"
# Bubblewrap reads where the JDK and the SDK are from here (it asks on first use otherwise):
mkdir -p ~/.bubblewrap && echo '{"jdkPath":"/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk","androidSdkPath":"'$HOME'/Library/Android/sdk"}' > ~/.bubblewrap/config.json
cd android && pnpm install
android/scripts/create-upload-key.sh        # the signing key, see Signing
```

- **A web change**: nothing to build.
- **A change to the shell** (`origin.txt`, `twa-manifest.mjs`, `overlay/`, the design icons):
  `android/scripts/regenerate.sh`, review and commit `android/`. It fetches the icons Bubblewrap wants
  from the *live* site, then replaces them with the shell's own.
- **A new APK to install**: its version is the web app's (`version.txt`: versionName `1.38.0`, versionCode
  `1·10000 + 38·100 + 0 = 13800`), so a newer web release is always a newer APK, which Android needs to
  update over an installed app. After a web release: `android/scripts/regenerate.sh`, commit, release build.
  A second APK of the same web version: `ANDROID_VERSION_CODE_OFFSET=1 android/scripts/regenerate.sh`.
- **The release build**: `android/scripts/build-release.sh [out-dir]` builds `betterreads-<version>-<code>.apk`
  and `.aab` into `/tmp/betterreads-android-release/` and copies the APK to `~/Downloads/BetterReads-<version>.apk`, signed with the key below, and warns when its
  fingerprint is not in `assetlinks.json`. Builds are never committed (`.gitignore`).
- **A debug build** for the emulator, signed with Android's per-machine debug key (uninstall a release
  build first, the signatures differ):
  `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleDebug`
  → `android/app/build/outputs/apk/debug/app-debug.apk`.

The committed project builds from a clean clone with exactly these steps (the first three of the block
above, `pnpm install`, the key, then `build-release.sh`); `regenerate.sh` is only needed to change the shell.

## Signing

The APK is signed with a key that lives **outside the repository**:

| | |
| --- | --- |
| Keystore | `~/.android-keys/betterreads-upload.jks` (PKCS12, RSA 4096, valid 10 000 days) |
| Alias | `betterreads-upload` |
| Password | macOS login Keychain, account `betterreads`, services `betterreads-android-store` and `betterreads-android-key` (PKCS12 has one password for store and key: the same value under both) |
| SHA-256 | `8C:F9:C1:85:76:F1:27:ED:8F:2A:11:C4:50:B2:B9:27:9F:71:94:46:0E:C6:81:B6:1B:E6:FD:85:7E:9E:86:AD` (public: it is in `assetlinks.json`) |
| Backup | **Bitwarden: one item with the `.jks` as an attachment and the password.** The Keychain alone dies with the Mac. |

`create-upload-key.sh` creates it (refusing to overwrite one), stores a random password in the Keychain
and prints the fingerprints. Read the password back with
`security find-generic-password -a betterreads -s betterreads-android-store -w`; print the fingerprints
again with `keytool -list -v -keystore ~/.android-keys/betterreads-upload.jks -alias betterreads-upload`
(JDK 17's `keytool`).

**Lose the key and the installed app can no longer be updated**: a new key means uninstalling and
installing again, and a new fingerprint in `assetlinks.json`. The same key is the *upload* key if the
app goes to Google Play later; Play then signs what people install with its own key, whose fingerprint
goes into `assetlinks.json` next to this one, and an APK from this key cannot be updated in place by the
Play build (and the other way round).

**Keep safe (back up together, never in the repo):** `~/.android-keys/betterreads-upload.jks` and the two
Keychain items `betterreads-android-store` and `betterreads-android-key` (account `betterreads`; the same
password under both).

Nothing of the key is ever committed: `.gitignore` refuses `*.jks`, `*.keystore`, `*.p12`, `*.pk8`.

## Installing and updating by hand

The APK is `~/Downloads/BetterReads-<version>.apk` after `build-release.sh` (also in
`/tmp/betterreads-android-release/`, next to the AAB). **The full-screen app needs
`assetlinks.json` live first** (next section): release the web app, then install.

1. Check the file you carry: `shasum -a 256 BetterReads-1.38.0.apk`
   (`73c90e206becfaa45c08ad889cdec5808602ae464148865bbcd02eb51fb34bb4` for the first build, 1.38.0) and, optional,
   `$ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs BetterReads-1.38.0.apk`: the certificate
   SHA-256 has to be the key's below.
2. **adb** (phone with Developer options → USB debugging, cable or `adb pair` over Wi-Fi):
   `adb install -r ~/Downloads/BetterReads-1.38.0.apk`. `-r` updates in place, keeping the app.
3. **Or the file**: get the `.apk` onto the phone (Drive, Signal's "Note to self", a USB cable) and open it
   there. Android asks to *allow installing from this source* (the app you opened it from: Files, Chrome,
   Drive), once: Settings → Apps → Special access → Install unknown apps. Play Protect may ask to scan an app
   it has not seen: "Install anyway".
4. Open BetterReads. **No address bar** = verified. If Chrome shows one, see *Digital Asset Links*.
- **Updating**: after a web release run `regenerate.sh` and the release build, install it the same way:
  it has to be signed with the same key. Nothing to do for a web change.
- **Idea, not built**: attach each APK to a GitHub Release and point
  [Obtainium](https://obtainium.imranr.dev) at the repository: the phone then offers new APKs itself
  (the repository is public, no token needed). It would want a release workflow that builds the APK with
  the key as a secret; by hand, `gh release upload` of the APK from `build-release.sh` does it.
- **Uninstall**: Settings → Apps → BetterReads. The site's data is Chrome's, not the app's.

### What works inside the app (microphone, vibration, push)

The app is Chrome with its address bar off, so it gets Chrome's web platform and Chrome's permission
prompts for `https://betterreads.de`; there is nothing to declare in the Android manifest for them (the
APK asks Android for no permission at all).

- **Microphone** (voice messages, hold to record): the page asks with `getUserMedia`; Chrome shows its own
  prompt for the site (and Android's microphone prompt for Chrome the first time), once; the choice is
  Chrome's site setting. Nothing blocks it: `web/public/_headers` sends `Permissions-Policy: …microphone=(self)…`
  (and `camera=(self)` for the barcode scanner; the camera goes the same way). Not tried on the emulator:
  it needs a signed-in member.
- **Vibration** (the haptics while recording): `navigator.vibrate` needs no permission.
- **Push** (the import job's "Notify me when it's done"): it is Web Push through the same service worker and
  Chrome's notification permission for the site; Chrome shows the notification (the app's notification
  delegation is off: `enableNotifications: false`, the shell sends none itself), and Android 13+ asks
  once for Chrome's notifications. Expected to work as in Chrome; not tried here (needs a signed-in member and
  the VAPID keys).

## Digital Asset Links

`web/public/.well-known/assetlinks.json` holds one statement for `de.betterreads.app` with the list of
fingerprints (32 colon-separated upper-case hex pairs):

the signing key above, the only entry. If the app ever goes to Google Play, add Play's app signing key SHA-256
next to it (Play re-signs what people install with its own key).

`betterreads.de` and `libellus.fabkho.dev` are one Pages deploy, so both serve the file; the entry is
about the app's package and key, not a host, and the app opens `https://betterreads.de` only.

The file has to come back from https://betterreads.de/.well-known/assetlinks.json with status 200,
`Content-Type: application/json` and **no redirect**. `web/public/_headers` sets the type and an hour's
cache; `nuxt generate` copies both into `.output/public/`. **Today the live site serves its HTML shell for
that address** (the file is not deployed), so the installed app opens with Chrome's address bar until
it is.

### Owner steps (the file is live only after a release)

1. Merge this change and let the release deploy it, then check:
   ```sh
   curl -sI https://betterreads.de/.well-known/assetlinks.json    # 200, content-type: application/json, no location:
   curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://betterreads.de&relation=delegate_permission/common.handle_all_urls'
   ```
   The second shows `de.betterreads.app` with the fingerprint. If you change `origin.txt`, check that host.
2. Build and install the APK ([above](#installing-and-updating-by-hand)). Open it: **no address bar** means
   it is verified. A bar means it is not: look at the two checks, then clear Chrome's data for the site
   (Chrome caches a failed verification) or reinstall the app.
3. Check that links open in the app: `adb shell pm get-app-links de.betterreads.app` should say `verified`
   for `betterreads.de` (Android checks at install; `adb shell pm verify-app-links --re-verify de.betterreads.app`
   asks again). Without it a `https://betterreads.de/…` link opens in Chrome, as on the emulator below.
4. Check the splash handover once on the phone: `adb logcat -s SplashScreenStrategy` after a launch
   should **not** say `Failed to transfer splash image` (see the splash notes: on the emulator,
   unverified, it did).

### On the emulator, without the deploy

Chrome has a command-line flag that skips the verification for one origin. With it the emulator behaves
like a verified phone as far as the address bar goes (`docs/TESTING.md` has the rest of the emulator
setup; Chrome prints a *"Chrome is loading flags from a command-line file"* banner):

```sh
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run --disable-digital-asset-link-verification-for-url=\"https://betterreads.de\"" > /data/local/tmp/chrome-command-line'
adb shell am set-debug-app --persistent com.android.chrome
adb shell am force-stop com.android.chrome
```

This is not the real thing: Android's own link verification (links opening in the app by themselves)
still needs the live file. For the test below, the app was allowed to open the domain's links by hand:
`adb shell pm set-app-links-user-selection --user 0 --package de.betterreads.app true betterreads.de`.

## The splash

Android 12+ draws a **system splash** when the app starts: the night room, and the app's
`windowSplashScreenAnimatedIcon`, here `drawable/splash_icon.xml`, an AnimatedVectorDrawable of the mark
(`android/overlay/res/`). The brand motion (`design/logo-options/6-lamp-over-page/motion/`,
`docs/MOTION.md`: the pages arrive over `gentle`, the lamp rises behind them and its glow swells over
`wave`, 1900 ms in all) is cut to what the system allows, **1000 ms**: the pages arrive over 200 ms from
120 ms, the lamp rises over 680 ms from 170 ms on the `standard` curve, the glow swells over 750 ms from
250 ms on the `wave` curve, everything at rest at 1000 ms. The last frame is the app icon's mark at
1.5× on the night room, with the lamp's glow.

What is true, measured on the emulator (Pixel 9 image, Android 17, Chrome 156, software GPU: slower than
a phone, so only the shape matters):

- **The animation is the system's, and the system takes the splash down when the launcher activity has
  drawn its first frame** (`am start` reported 150–240 ms), not when the animation ends, and Chrome's
  window then covers it. Without more, the splash was on screen about 0.35 s and the 1000 ms animation
  never finished. The shell's `LauncherActivity` therefore **keeps the splash up until the animation has
  played** (the splash screen exit listener), warms Chrome's process up meanwhile, and only then starts
  the Trusted Web Activity. A start from a link, a shortcut or a share does not wait (its intent carries
  data or extras). Cost: up to about 0.8 s on top of the launch (the splash window measured 0.8 s on
  the emulator); the page's first paint did not move beyond the noise between runs (4.8 s both
  ways, cold Chrome, slow emulator), because Chrome starts during the splash instead of after it. To trade
  the animation for speed, make `shouldLaunchImmediately` in `overlay/java/LauncherActivity.java` return `true`.
- **The window opens over the first ~300 ms of the animation** (the system's launch transition), so
  the animation starts 120 ms late: the first beat would be played to nobody. Tuned by eye on the
  emulator; worth one look on the phone.
- **The animation ends at the icon**: after it, the screen is the night room and the mark at rest, and
  nothing moves until Chrome's window replaces it. **Chrome's window is not ours**: on the emulator
  there was a dark gap of about 0.7 s (Chrome's window before it has drawn anything) and then Chrome's own
  launch frame, the web manifest's icon on `background_color`, until the page paints (the live site's
  manifest still serves the old plum-tile icons; the next deploy brings the mark alone,
  `design/icons/app/README.md`). `androidbrowserhelper` is meant to close that gap by handing Chrome our
  splash image (`drawable/splash.png`, the last frame) to show on the night room at once, but **Chrome
  refused the transfer** here (`Failed to transfer splash image`; verification skipped by the flag, so
  it may well accept it for a verified app: owner step 4 above). If it does, the mark stays still on the
  night room from the splash to the page, which is the best a TWA can do.
- **Below Android 12** (API 26–30; not tested, no image) there is no system splash animation: the window
  background is the night room, then the launcher's own splash view (`splash.png`, the last frame,
  static), then Chrome's. The animation cannot be
  longer than 1000 ms or loop, and nothing the shell draws can stay up until the page paints: Chrome's
  window is on top by then. The brand motion's third beat (the wordmark, the app fading in) is the web
  page's own and starts when the page paints.

## Checked on the emulator

Emulator: `libellus-pixel` (Pixel 9, Android 17 / API 37, Google Play image, Chrome 156), release APK,
Chrome's verification skipped by the flag above, the live site (signed out).

| Check | Result |
| --- | --- |
| Install, cold launch | Installs (`adb install`); the launcher icon starts it; the splash animation plays; Chrome opens the site **without an address bar** |
| Launcher icon | Night circle with the mark, **no Chrome badge** |
| Themed icon (Android 13+) | Wallpaper & style → Icons → Minimal: the monochrome layer, tinted |
| Shortcuts | Long press: Search, Update progress, Library, with their icons; Update progress opens the app |
| Share target | BetterReads is in Chrome's share sheet; picking it starts the app. Signed out, so the app lands on sign-in: the `/share` handling after sign-in is not exercised |
| Back | Sign-up → back → sign-in → back leaves the app, as a PWA does |
| Deep link | `https://betterreads.de/book/<id>` opens in the app once the domain is allowed (it opens in Chrome until the assetlinks file is live: link verification state `1024`); signed out the app redirects to sign-in, so the book page itself is not seen |
| Service worker | Registered and controlling in the TWA (`display-mode: standalone`, referrer `android-app://de.betterreads.app/`); same worker as in Chrome |
| "New version available" sheet | Not exercised: there is no new version to find without a deploy. Nothing in the shell touches the worker |

Not checked: a real phone, a verified origin, signed-in screens (voice messages, push), Android < 12, `/share` with an EPUB.

## Going to Google Play later

Not now. When it is: a Play developer account, `build-release.sh` → the AAB into Internal testing,
Play App Signing (accept Google's key), copy the **app signing key SHA-256** into the second entry of
`assetlinks.json`, and settle the package id first. The old draft (#102, Libellus) has a store listing,
Data safety answers and screenshots worth looking at for that day.

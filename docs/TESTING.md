# Testing on real devices

The everyday suites (README, Tests) run in desktop browsers: pgTAP, Vitest against the local stack,
and Playwright on an iPhone-sized viewport in WebKit. A desktop browser has no system bars, no
browser toolbar, no on-screen keyboard and reports every safe-area inset as 0, so whatever depends on
those is checked on a real device instead: Chrome on an Android emulator, driven by
`web/e2e/android/smoke.ts`. It is not part of CI and is not a Playwright test — it takes screenshots of
the whole screen (status bar, Chrome's toolbar, the keyboard, the navigation bar) and writes down what
the browser reports about its viewports and insets next to each one.

Run it after any change to the safe-area utilities in `main.css` (`--bar-top`, `--float-bottom`), the
tab bar, the top bars, the sheets, the search palette, `useKeyboardInset` or the viewport meta.

## The Android emulator (once)

On a Mac with Apple Silicon, without Android Studio. The SDK goes where Orca and the Android tools
look for it, `~/Library/Android/sdk`:

```sh
export ANDROID_HOME=~/Library/Android/sdk
mkdir -p $ANDROID_HOME/cmdline-tools
# The command-line tools (the current zip is named in https://dl.google.com/android/repository/repository2-3.xml)
curl -LO https://dl.google.com/android/repository/commandlinetools-mac-15641748_latest.zip
unzip -q commandlinetools-mac-*_latest.zip -d /tmp/clt && mv /tmp/clt/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager platform-tools emulator \
  "system-images;android-37.0;google_apis_playstore;arm64-v8a"
```

The Google Play image is the one that ships Chrome (Chrome 145 on `android-37.0` r6). It is 2.3 GB;
if `sdkmanager` stalls (`Premature EOF`), download
`https://dl.google.com/android/repository/sys-img/google_apis_playstore/arm64-v8a-37.0_r06.zip`
with `curl -C -` (or in a few ranges side by side), check its SHA-1 against `sys-img2-3.xml`, unzip it
into `$ANDROID_HOME/system-images/android-37.0/google_apis_playstore/` and add a `package.xml`
(copy one from another system image and change the path and API level).

A Pixel 9 (1080 × 2424 at 420 dpi: 411 × 923 CSS px), with the software keyboard:

```sh
echo no | $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n libellus-pixel \
  -k "system-images;android-37.0;google_apis_playstore;arm64-v8a" -d pixel_9
```

## Booting it

Headless:

```sh
$ANDROID_HOME/emulator/emulator -avd libellus-pixel -no-window -no-audio -gpu swiftshader_indirect -no-snapshot-save &
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
```

Or in Orca's emulator pane, where it can be watched and tapped: `orca emulator attach libellus-pixel`
(an already booted one: `orca emulator attach emulator-5554`).

Once per fresh device, let Chrome skip its first-run screens and read its command line:

```sh
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
adb shell am set-debug-app --persistent com.android.chrome
adb shell am force-stop com.android.chrome
```

Navigation mode (gesture navigation is the default; switch Chrome off and on again after a change):

```sh
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton
adb shell cmd uimode night yes   # the device in dark mode (no: light)
```

## Running the smoke script

The app comes from the Mac: the dev server, or — for the installed app, which needs the manifest and
the service worker — a static build. Both talk to the local stack; `smoke.ts` reverses the app's port
and the stack's API port (55321) into the device, so the phone's `localhost` is the Mac's, and forwards
Chrome's DevTools socket to `localhost:9333`.

```sh
cd web
export NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
export NUXT_PUBLIC_SUPABASE_ANON_KEY=$(cd .. && supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"/\1/p')

# The dev server …
LIBELLUS_E2E=1 ./node_modules/.bin/nuxt dev --port 3062 &
# … or a static build, served with the SPA fallback
pnpm generate && pnpm dlx serve -s .output/public -l 3063 &

adb reverse tcp:3063 tcp:3063
adb shell am start -a android.intent.action.VIEW -d http://localhost:3063/ com.android.chrome
pnpm tsx e2e/android/smoke.ts --base http://localhost:3063 --out /tmp/libellus-android --name gesture-tab
```

The first run signs up a test member (an address on the test domain; the suites' sweep removes her
and her Books once she is a day old)
and gives her a Book being read, two to read and one finished; later runs with the same `--out` reuse
her (`member.json`). It signs in through the screens (the code comes out of Mailpit), then takes:
`home`, `library`, `book` and `book-scrolled` (after a real swipe), `search-keyboard-scrolled` (Search
tapped on the scrolled book page), `finish-keyboard` (the review field tapped), `search-keyboard`,
`search-no-keyboard` and `name-keyboard`. `--only home,search` takes a subset. Taps that should raise
the keyboard are real ones (`adb shell input tap`, placed by a calibration tap the page measures);
the rest goes through the DevTools protocol.

Every screenshot is the whole screen as `<name>-<step>.jpg`, at most 1000 px high (larger images do
not fit an agent's context); `<name>.json` has the probe for each step: display mode, `innerHeight`,
the root's `clientHeight`, the visual viewport's height and `offsetTop`, `env(safe-area-inset-top|bottom)`,
`env(safe-area-max-inset-bottom)`, `100dvh|svh|lvh`, `--float-bottom`, `--bar-top`, and how far the
tab bar and the palette are from the bottom.

**The installed app.** In the Chrome tab: ⋮ → Add to Home screen → Install → Add to home screen.
Open it from its icon (on the launcher's second page), then:

```sh
pnpm tsx e2e/android/smoke.ts --base http://localhost:3063 --out /tmp/libellus-android --name gesture-pwa --standalone
```

For the three-button run, switch the navigation mode, restart Chrome and run `--name buttons-tab`
(and `buttons-pwa --standalone`) with `--only home,search`.

## What Chrome reports (Chrome 145, Pixel 9 emulator, Android 17)

CSS px. "Keyboard" is Gboard up in the search palette.

| | inset top / bottom | `innerHeight` = `clientHeight` | visual viewport | tab bar off the bottom |
| --- | --- | --- | --- | --- |
| Tab, gesture navigation | 0 / 24 (max 24) | 813 (869 with the toolbar scrolled away) | 813, offset 0 | 40 |
| Tab, gesture, keyboard | 0 / 0 | 477 | 477, offset 0 | palette 16 above the keyboard |
| Tab, three buttons | 0 / 0 | 765 | 765 | 16 |
| Installed, gesture | 0 / 0 | 845 (the page ends above the gesture bar) | 845 | 16 |
| Installed, keyboard | 0 / 0 | 533 | 533 | palette 16 above the keyboard |
| Installed, three buttons | 0 / 0 | 821 | 821 | 16 |

Before `interactive-widget=resizes-content` (#58) Chrome laid the keyboard over the page: in a tab
`innerHeight` 789, the visual viewport 477 tall, and focusing the Finish sheet's review field panned
it to `offsetTop` 312, so the keyboard inset read 0 and the sheet's header went off the top.

## iOS (by hand, for now)

The iOS Simulator is not set up on this machine yet. What to check on an iPhone, Safari tab and Home
Screen app, light and dark:

- **Home Screen app:** unchanged from before #58 — the tab header's row under the 59 pt status bar,
  the tab bar 21 pt off the bottom edge (`tabBarDrop` into the 34 pt inset), the search palette
  `--spacing-sm` above the keyboard, sheets riding on the keyboard.
- **Safari tab:** the header's avatar and a book page's back button 8 pt below Safari's top edge
  (`barTop`), not touching it; the tab bar clear of Safari's bottom toolbar, with the toolbar both
  expanded and collapsed (the bottom inset is what Safari reports there; on iOS the tab bar keeps
  `max(inset − 13, 12)`); the search palette and the Finish sheet's review field above the keyboard
  (Safari ignores `interactive-widget`, so this is still `useKeyboardInset` following the visual
  viewport).

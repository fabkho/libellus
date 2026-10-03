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

## iOS: the Simulator

There is no iOS smoke script yet; the Simulator is driven by hand (or by an agent) as below. What to
check, Safari tab and Home Screen app, light and dark: Home, the Library, a book page before and
after a swipe, the search palette and the Finish sheet's review field with the real keyboard up, the
name sheet.

- **Safari tab:** the header's avatar and a book page's back button `barTop` (8 pt) below the top of
  the page, which starts under the status bar, not touching it; the tab bar clear of Safari's
  floating bottom toolbar (the page ends above it; on iOS the tab bar keeps `max(inset − 13, 12)`);
  the search palette and a sheet standing on the keyboard, a sheet's header in view. Safari ignores
  `interactive-widget`, so this is `useKeyboardViewport` following the visual viewport.
- **Home Screen app** (not yet run in the Simulator): unchanged from before #58 — the tab header's row under the 59 pt status bar,
  the tab bar 21 pt off the bottom edge (`tabBarDrop` into the 34 pt inset), the search palette
  `--spacing-sm` above the keyboard, sheets riding on the keyboard.

**Setting it up.** Xcode with an iOS runtime; an iPhone 18 Pro (iOS 27) here. The Simulator shares
the Mac's network, so the dev server on port 3062 (as above) and the stack on 55321 are its
`localhost`; there is nothing to reverse:

```sh
U=<udid from xcrun simctl list devices>
xcrun simctl boot $U
xcrun simctl ui $U appearance light   # or dark
xcrun simctl openurl $U http://localhost:3062/
xcrun simctl io $U screenshot s.png && sips -s format jpeg -Z 1000 s.png --out s.jpg
```

Input goes through Orca's emulator (`orca emulator attach $U`, then `tap x y` in normalized
coordinates, `type`, `gesture`; a swipe is a `begin`, a few `move`s and an `end` on its WebSocket).
Two traps:

- **No software keyboard.** Typing through `orca emulator type` (or a Mac keyboard) attaches a
  hardware keyboard to the device, and from then on a focused field shows only Safari's accessory
  bar — the keyboard the member sees never comes up, and neither does what follows it. This Xcode
  ships no Simulator.app to untick I/O → Keyboard → Connect Hardware Keyboard in, and rebooting the
  device does not reset it. CoreSimulator's `-[SimDevice setHardwareKeyboardEnabled:keyboardType:error:]`
  with `NO` does (a ten-line Objective-C tool, run after any typing). Better: fill fields from the
  page and keep real taps for focusing.
- **Orca's helper** loads `SimulatorKit.framework` from `Developer/Library/PrivateFrameworks`; newer
  Xcodes keep it in `Contents/SharedFrameworks`. A symlink into the helper's `lib/` folder
  (`~/Library/Application Support/orca/serve-sim-runtime/<version>/lib`) fixes `Library not loaded:
  @rpath/SimulatorKit.framework`. After rebooting the device, `orca emulator kill` and attach again:
  the old helper still answers but its taps go nowhere.

To read what Safari reports, the page needs a way to run the probe in `e2e/android/smoke.ts`: Web
Inspector, or (what this run used) a local dev-only plugin that polls a small server on the Mac for
a script to run and posts the result back. Map a page point to the screen with one calibration tap
(the page reads the touch's `clientX/Y`); in a Safari tab the page's (0, 0) is at (0, 62) pt.

## What Safari reports (iOS 27, iPhone 18 Pro simulator, 402 × 874 pt)

Safari tab, light. CSS px.

| | inset top / bottom | `innerHeight` / `clientHeight` | visual viewport | |
| --- | --- | --- | --- | --- |
| No keyboard | 0 / 0 | 714 / 714 (`lvh` 754) | 714, offset 0 | tab bar 12 off the page's bottom, which ends above Safari's toolbar |
| Keyboard, field high on the page (sign-in) | 0 / 0 | 714 / 714 | 384, offset 0 | |
| Keyboard, search palette | 0 / 0 | 411 / 714 | 411, offset 303 | palette 12 above the keyboard |
| Keyboard, Finish sheet's review field | 0 / 0 | 633 / 714 | 384, offset 330 | inset reads 0: Safari panned to the field |

The simulator's Safari kept its bottom toolbar expanded after a swipe (`innerHeight` stayed 714).
`innerHeight` follows the visual viewport only part of the way once the keyboard is up, so
`layoutHeightOf` takes `clientHeight` there. With a field low on the page Safari pans the visual
viewport down to it, the keyboard inset reads 0 and the layout viewport's height no longer says how
much room a sheet has: before the fix in #58 the Finish sheet stood on the keyboard but ran 190 px off
the top of the screen, its header and Cancel out of reach. `keyboardRoomOf` (the visual viewport's
height while the keyboard is up) now caps the sheet's height.

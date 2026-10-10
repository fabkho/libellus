# Testing on real devices

The everyday suites (docs/DEVELOPMENT.md, Running it locally) run in desktop browsers: pgTAP, Vitest against the local stack,
and Playwright on an iPhone-sized viewport in WebKit. A desktop browser has no system bars, no
browser toolbar, no on-screen keyboard and reports every safe-area inset as 0, so whatever depends on
those is checked on a real device instead: Chrome on an Android emulator, driven by
`web/e2e/android/smoke.ts`. It is not part of CI and is not a Playwright test — it takes screenshots of
the whole screen (status bar, Chrome's toolbar, the keyboard, the navigation bar) and writes down what
the browser reports about its viewports and insets next to each one.

The same emulator is where TalkBack is checked (docs/ACCESSIBILITY.md, "Checking a change").

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

**The system Back** (#62) has its own script, run after `smoke.ts` with the same `--out` (it signs
nobody up and reuses `member.json`): one book page to another, Edit read and the back gesture, Cancel,
the Delete question over the sheet, the search, the avatar's Profile — each step printing where the page
is and what is open. `--real` taps with a finger (adb), `--gesture` swipes in from the left edge
(without it, the Back key, as with three-button navigation):

```sh
pnpm tsx e2e/android/back.ts --base http://localhost:3063 --out /tmp/libellus-android --real --gesture
```

A Back gesture starts with a touch the page sees (`pointerdown`, then `pointercancel` once the
system takes it over), so nothing that Back closes may also close on that touch (the avatar menu, before #78 replaced it
with the Profile, closed on a tap elsewhere when the finger lifted, not as it landed).

**The cover's flight** has its own script: a fresh member with four Books on Want to read, a
real finger (adb) on a Library row, and every frame recorded through the DevTools screencast. Covers are
a test card answered by the script at the size each request asks for (a row's 120 × 180, the book
page's 600 × 900), the book page's after a delay standing for the network: `--network warm` (0 ms),
`normal` (150 ms) or `slow` (1.5 s). It clears the origin's data and bypasses the service worker first,
so builds can be swapped on one port. Run it against a static build: the dev server serves the motion
tokens unminified, the build as `.25s` (docs/MOTION.md, Tokens), and only the build shows what a phone
gets.

```sh
pnpm tsx e2e/android/flight.ts --base http://localhost:3063 --out /tmp/libellus-flight --name after --network normal
```

It writes `<name>-<network>-strip.jpg` (up to ten frames from the tap, the part of the screen the cover
flies through), `-hero.jpg` (the hero up close, from 250 ms after the tap on) and `-frames.json`.

**The cover's flight back** (closing a Book page) has a script for Chromium on a phone-sized screen (412 × 915, 2.625×
density, the CPU slowed 4×), no emulator needed: `--network warm` has the row's small image in, `cold` holds it back
(`--delay`) so the row still shows its thumbhash at the close; `--close back|gesture` taps the page's Back or goes back
in history; `--theme light|dark`. It writes a strip of the screencast, the flight held still at seven moments
(`-stills.jpg`), the row 700 ms after the tap (`-landed.png`) and every frame's numbers (`-frames.json`):

```sh
pnpm tsx e2e/android/flight-return.ts --base http://localhost:3126 --out /tmp/libellus-cover-return --name after --theme dark --network cold
```

**The flight after many round-trips** (does it wear?) is a Playwright measurement, `e2e/perf/flight-soak.spec.ts`
(tagged `@perf`): the config leaves `e2e/perf` out unless `LIBELLUS_E2E_PERF=1`, so no run, local or CI,
picks it up by accident. Thirty round-trips Home → Book → Back in Chromium (CPU ÷4) or WebKit, per round
the flight's timings, its dropped and long frames, what it left behind, the document's and the heap's size
and the stack's requests; `e2e/perf/summarize.ts` makes the tables of docs/MOTION.md ("After many
flights"). Run on a quiet machine, at least five runs:

```sh
LIBELLUS_E2E_PERF=1 FLIGHT_OUT=/tmp/flight-soak pnpm exec playwright test e2e/perf --repeat-each 5 --workers 1
pnpm tsx e2e/perf/summarize.ts /tmp/flight-soak
```

**Share target and app shortcuts (#91).** Both need a **WebAPK**: Chrome on Android registers a web app
as a share target and shows its manifest `shortcuts` on a long-press only once Google's server has minted
an APK for it. On the emulator without a Google account Chrome's Install (⋮ → Add to home screen →
Install) pins a Chrome "webapp" launcher shortcut instead: it opens standalone, but Chrome's share sheet
does not list Libellus and the icon's long-press menu has no shortcuts (App info, Pause app, Widgets,
Remove). So on the emulator the flows are driven the way Android would start them: through the DevTools
socket, navigate the installed (standalone) page to `/share?title=&text=&url=` and to the shortcuts'
addresses (`/?search=1`, `/?progress=1`), and read what Chrome made of the manifest with
`Page.getAppManifest` (the `share_target`, the three `shortcuts`, no errors) and `Page.getInstallabilityErrors`
(none). A phone with a Google account shows the real share sheet entry and the long-press shortcuts.

**Ebook files (#131)** have their own script, `e2e/android/ebooks.ts`, one step per run so the system's
dialogs can be answered in between. Serve a static build (the share target needs the service worker)
with a few public-domain EPUBs from Project Gutenberg copied into its output under `__fixtures/` (they
are only served, never committed), install it (⋮ → Add to Home screen → Install → Add to home screen)
and open it from its icon; for the folder, push some EPUBs into `Download/Books` (one in a subfolder):

```sh
pnpm generate && mkdir -p .output/public/__fixtures && cp ~/ebooks/pg*.epub .output/public/__fixtures/
pnpm dlx serve -s .output/public -l 3126 &
adb shell mkdir -p /sdcard/Download/Books/Classics && adb push pg2701.epub pg345.epub /sdcard/Download/Books/ && adb push pg1399.epub /sdcard/Download/Books/Classics/
pnpm tsx e2e/android/ebooks.ts --base http://localhost:3126 --out /tmp/libellus-ebook-link --step setup   # a member with four Books
… --step share1 · --step share3 · --step book · --step pick · --step scan · --step report
```

`share1`/`share3` POST one and three EPUBs to `/share` from the installed page itself (`multipart/form-data`,
real `File`s, through the app's service worker, `public/sw-share.js`) and then tap *Add* on the confirmation
the app asks for (security round F4; `e2e/share.spec.ts` covers that flow and a POST from another site): the share sheet entry needs a
WebAPK, as for #91 above, so a phone with a Google account is where the real share sheet is checked.
`pick` taps *Choose* in the Ebooks page's Ebook folder row; Android's folder picker opens (the storage
root and `Download` itself say "Can't use this folder"; open `Download` → `Books` → *Use this folder* →
*Allow* "Allow Chrome to access folder?" → Chrome's *Allow* "Allow this site to view and copy files? … until
you close all tabs for this site"). `scan` reloads (the installed app loses the folder's permission with
every reload and restart, phase 0) and taps *Scan*: Chrome's *Allow* dialog comes on that tap, and after
*Allow* `report` reads the result. Measured (Chrome 145, the emulator, Pixel 9 AVD, Android 17): one
24.8 MB EPUB shared and linked in 0.7 s, three EPUBs (0.5–0.8 MB) in 0.5 s, "3 ebooks · 2 linked · 1 needs
you"; the folder handle read back from IndexedDB after a reload, `queryPermission` `prompt`, one *Allow*
tap, the scan of `Books` (a file in `Classics/` among them) "3 ebooks · 3 linked".

**The reader (#131 phase 2)** is checked by hand on a phone, as nothing automated holds a finger
on a page: Read now on a Book with its ebook here (iOS Safari and Chrome on Android); a tap at
either edge turns, a swipe turns (Classic), a tap in the middle brings the capsule; a long press
selects a word (no system selection bar: the reader selects itself), the handles stretch it, the
bubble's Translate, Define, Copy, Search and the four highlights; Aa (sizes, margins, spacing,
Scroll, Classic mode, Light/Dark/Sepia); Contents and the slider; search in the book; Android's
Back (chrome first, then the book); the screen staying on (needs HTTPS); the end of the book with
Finish; the place kept: close, open on another device, the same page; a highlight made on one device
shows on another with the same file (also one made offline, once back online), and with another copy of
the book it is listed under *Highlights from another copy* in Contents. A book with footnotes,
pictures and its own fonts reads as before (the sanitizer keeps what a book needs; on iOS the
frames keep `allow-scripts`, so a tap, a selection and a link in the page are the check that
WebKit's events still arrive). The design round's
measurements (first page in 172–256 ms at 4× CPU throttling, the engine 40 KB gzipped, loaded on
the first Read now) are in issue #131.

**Your shelf (#23)** has its own script: Regal's 3D Stack under real fingers. The app must know the
owner (`NUXT_PUBLIC_SHELF_OWNER_ID` = her auth user id, at build time for a static build) and her
address must reach Mailpit; the run signs her in through the screens unless the tab has her session.
On the Profile's row and then the year in review's, it swipes the row sideways, swipes up over it
(the page must scroll), takes a Book out (it breaks out over the whole screen, above the tab bar),
turns it, puts it back with the system Back (the page stays) and again with the sheet's Done (Regal's round Back is off).
Screenshots `shelf-<step>.jpg` and `shelf.json` (books in the row, the Book that is out, whether it
broke out, whether the tab bar is on top, the scroll position, the history's length) go to `--out`:

```sh
pnpm tsx e2e/android/shelf.ts --base http://localhost:3121 --email dev@libellus.local --year 2025
```

The R2 bucket's CORS allows only listed origins: serve the app on an allowed port (3121 is one) and
let the script reverse it, so the phone's origin is `http://localhost:<port>`.

**The page never moves sideways** (`e2e/android/scroll-x.ts`, not part of CI). On Home, Library, Search,
the Profile (with the shelf row; the owner as for the shelf above), a Book out and put back by the system Back and by Done, a year in review and the
whole shelf it writes down whether the document is wider than the viewport (`scrollWidth` against `clientWidth`,
the scroll position and the visual viewport's offset) and which elements stick out. On the Profile it puts a
real finger on the page (the heading above the cards) and swipes it left and right: the page must not move.
Then it swipes the year cards and Regal's row: they must scroll. It exits 1 if the page was wider or moved, or if
an inner row did not scroll. The published library file is fetched by the script and handed to the page (the
bucket's CORS allows only listed origins, and a built app's service worker is bypassed so the page's own
request is the one that is answered). Screenshots `scroll-x-<step>.jpg` and `scroll-x.json` go to `--out`:

```sh
pnpm tsx e2e/android/scroll-x.ts --base http://localhost:3128 --email dev@libellus.local
```

Measured (Chrome 145, the emulator, the dev server and a `nuxt generate` build, tab): no screen was wider than
the viewport, 411.43 CSS px at 2.625 dpr. To see the net work, put a `150vw` element into the Profile and swipe:
without `overflow-x: clip` on `html` and `body` the document is 617 px wide and the swipe moves the page by
205 px (`visualViewport.pageLeft`); with it the document stays 411 px and the page does not move.

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

## The scrim and the status bar (A6, Android)

On Android the dimming scrim of a sheet stopped at the status bar while the app's own background did not. What
the code shows: the app is installed as a PWA (`display: standalone`), where the system draws the status bar
outside the web viewport and colours it from `<meta name="theme-color">`; the background looks full-bleed
because the tags carry the page's `surface`, while a scrim, a translucent layer inside the viewport, cannot
paint into the system bar. `position: fixed` going container-relative under a transformed ancestor is not it:
the scrim is teleported to `<body>`, nothing above it is transformed, filtered or contained, and
`e2e/sheet-backdrop.spec.ts` (Chromium, Pixel 7) pins its box to the whole visual viewport. The fix is in
the tags (`utils/statusBarDim.ts`): while a layer is open they take the scrim-blended colour. Whether the
system's bar really follows the tag in the installed app is what the phone has to say:

1. On the phone: Settings → Developer options → USB debugging on; plug in. On the Mac open
   `chrome://inspect/#devices`, tick *Discover USB devices*.
2. Open Libellus **from its home-screen icon** (installed, standalone) and *inspect* it from the list (the
   installed app is listed as its own page; a Chrome tab is the other target to try after).
3. Open a sheet (Profile → Name). In the Elements panel select the scrim (`[data-testid="accountName.scrim"]`).
   In the Console: `const s = document.querySelector('[data-testid$=".scrim"]'); [s.parentElement.tagName, getComputedStyle(s).position, JSON.stringify(s.getBoundingClientRect()), JSON.stringify(document.documentElement.getBoundingClientRect()), visualViewport.height, innerHeight ]`.
   Expect `BODY`, `fixed`, a box at `top: 0` the height of `<html>`, and the heights equal. For the containing
   block, walk up: `for (let n = s.parentElement; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.transform !== 'none' || c.filter !== 'none' || c.contain !== 'none') console.log(n.tagName, c.transform, c.filter, c.contain) }` prints nothing.
4. Read the tags: `[...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content)` with the sheet
   open (dimmed colours, e.g. `#a19c96` over the light page) and after closing it (`#f4f0e9` / `#0e0c0a`
   again). Then change one by hand while the sheet is open: `document.querySelector('meta[name=theme-color]').content = '#ff0000'`
   (a tag whose `media` matches the phone's appearance) and watch the status bar.
5. Read the result:

| Observed | Meaning | Next |
| --- | --- | --- |
| Scrim box = `<html>` box, no transformed ancestor; the status bar tint follows the tag (red test, and the dim on a real sheet) | Cause confirmed: the bar is the tag's, and the dimmed tag fixes it | Nothing: ship `statusBarDim`. |
| Scrim box = `<html>` box, no ancestor; the bar follows the red tag, but a real sheet leaves it undimmed | The tag is rewritten after we set it (the head manager or another writer), or the scrim token is unreadable (`--color-scrim` empty) | Check `meta.content` during the sheet; fix the writer. |
| Scrim box = `<html>` box, no ancestor; the bar does **not** follow the tag at all | System restriction (an edge-to-edge window the system draws the bar over, or the TWA's own `statusBarColor`): no web code can change it | Remove `statusBarDim`; the TWA's native `statusBarColor` is the lever (PR #102's wrapper), not the page. |
| Scrim box starts below `0` or is shorter than `<html>`, or an ancestor is listed | Hypothesis holds: a containing block for `fixed` | Find the ancestor from the list; move the scrim out of it or remove the transform/filter/contain. |
| Scrim box is full but the area under the status bar is *app* background that stays bright | The page is not drawn under the bar (no `viewport-fit=cover` effect): the bar is a system strip | As the third row. |

## The barcode scanner (#92)

The scanner needs a camera, which neither Playwright flow nor the Simulator has, so the real devices check
what they can and a stand-in camera shows the rest. Neither script is part of CI.

**Android** (`e2e/android/scan.ts`, Chrome on the emulator; another worker may be using the emulator, so look
at what is in front first — the script taps the screen):

```sh
pnpm tsx e2e/android/scan.ts --base http://localhost:3102 --out /tmp/libellus-92 --serial emulator-5554 --allow
```

It prints what this Chrome supports (`BarcodeDetector` with `ean_13`: the native reader is the one used here, and
the script counts the requests for the WebAssembly decoder, which must be none), has Chrome's real detector read a barcode drawn on a
canvas, then taps through the real thing: the search, the camera button, Chrome's real permission prompt
(with `--allow` the site's permission is granted over the DevTools protocol afterwards: a prompt answered
with Back three times is blocked by Chrome for the site, and then only a new origin or cleared site data
brings it back), the emulator's own camera (`hw.camera.back=emulated`: a moving test scene, no barcode),
Back closing the scanner; and finally the scanner's whole pipeline on a `getUserMedia` stood in for by a canvas
stream showing the barcode: the real `<video>`, Chrome's real detector, the vibration tick and the lookup, ending
on the book page. The emulator's camera cannot be pointed at a book (a `virtualscene` back camera could show a
poster with a barcode; that needs the AVD changed and restarted).

**iOS** (`e2e/ios/scan-harness.ts`, the Simulator's Safari): the Simulator has no camera. The harness serves
the static build (`pnpm generate`) on a port, plants a fresh test member's session in localStorage (no code to type)
and, in the page, stands in for `getUserMedia` with a canvas stream showing a picture of a barcode; the WebAssembly
decoder, the loop, the lookup and the navigation are the app's own. `?auto=scan` opens the search and taps the
camera button. Modes in the address: `still` (default), `real` (the Simulator's own `getUserMedia`), `none`, `denied`.

```sh
pnpm generate
pnpm tsx e2e/ios/scan-harness.ts --port 3102 &
xcrun simctl boot 0CB470F8-6238-46B6-89F5-E74065305B2E
xcrun simctl spawn 0CB470F8-6238-46B6-89F5-E74065305B2E launchctl disable system/com.apple.intelligencetasksd
xcrun simctl openurl 0CB470F8-6238-46B6-89F5-E74065305B2E 'http://127.0.0.1:3102/?auto=scan'   # the page's log is printed by the harness
xcrun simctl io 0CB470F8-6238-46B6-89F5-E74065305B2E screenshot /tmp/ios-scan.png
xcrun simctl shutdown 0CB470F8-6238-46B6-89F5-E74065305B2E
```

The built app is served by its service worker after the first load, so the harness's script is the one of the
first load of that origin: use another origin (`localhost` or `127.0.0.1`) after changing the harness.

## Layout shift (CLS)

Only Chromium counts layout shifts (the Layout Instability API; WebKit has none). The flows that watched
them (`layout-shift.spec.ts`: a Library of 60 Books on a phone, 412 × 915, the CPU slowed 4×, the shifts nobody's
input explains summed the way web-vitals does, each scenario under 0.05) were removed with the other layout flows
("Which flows"): a change that moves the Library, the search palette or a Book page is looked at by hand with
the recipe below.

The field has the final word. Cloudflare Web Analytics lists the element behind a page's CLS
(`cumulativeLayoutShiftElement` in the GraphQL dataset `rumWebVitalsEventsAdaptiveGroups`, or Web
Analytics → Core Web Vitals → the debug view); the app's own `vitals` rows name the culprit of every
poor value (docs/OPERATIONS.md, Web Vitals). The Library's 1.0 there was the search palette's shadow
(`div.shadow-palette`): the palette grew upwards with each answer. To look at a scenario by hand,
record `layout-shift` entries with their `sources` (the nodes and their boxes before and after) from
an init script, `new PerformanceObserver(…).observe({ type: 'layout-shift', buffered: true })`, and
remember that a shift within 500 ms of a tap or a key does not count (`hadRecentInput`), while a
scroll, a source answering or the system Back excuse nothing.

## Reproducing a CI flake (Linux WebKit, few cores)

macOS WebKit does not starve the way the CI runner's Linux WebKit does: frames
there can come seconds apart, so a router scroll, a rising sheet or a history
step lands long after the page looks ready. To see a flow fail as it does in
CI, run the browsers in Playwright's Linux image limited to the runner's four
cores and let the flows connect to it (the app's server and the stack stay on
the Mac; the container reaches them through the client, `<loopback>`):

```sh
docker run -d --name pw --cpus=4 -p 3999:3000 --init --ipc=host \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  /bin/sh -c "npx -y playwright@1.63.0 run-server --port 3000 --host 0.0.0.0"
cd web
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3999/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
  CI=1 LIBELLUS_E2E_PORT=4366 pnpm exec playwright test --workers=3 --retries=0
```

The image's version must match `pnpm exec playwright --version`. A flow waits
for the app instead of for time: `untilStill` (nothing carries `data-moving`:
no sheet or list moving, no page on its way to its scroll place), `goto` (an
address opened once the page is at rest), boxes compared in one `evaluate`
(e2e/support.ts, e2e/fixtures.ts).

Every flow also fails at its end on an uncaught error of any page of any context it opened (`pageerror`, in `noPageErrors` of e2e/fixtures.ts; Anna's own browser in friends.spec.ts included), listing each with its stack; `EXPECTED_PAGE_ERRORS` there is the allowlist for an error that is the point of a flow, each with its reason, and is empty. A spec imports `test` from `./fixtures`, never from `@playwright/test`, or it has no guard.

Two things a laptop hides and a runner shows (issue #146): the dev server bundles a
package the first time a page imports it, and the pages open then can be reloaded under
their flows (`vite.optimizeDeps.include` in `nuxt.config.ts` lists what a later screen reaches first, so
none is met late; a package that is only imported from a lazy page or a dynamic import
belongs there), and a page moves under the tap that aims at it. A flow opens the Profile
with `openProfile` (the record in, nothing moving). The Profile's account rows used to slide ~150 px down once
the record said there was nothing finished; it now stands in its final shape from the first frame (the flow that
looked at the rows' place on every frame was removed with the layout flows).

## CI: what runs when

`.github/workflows/ci.yml`. The repository is public, so standard runners cost no Actions minutes and have four cores (the
numbers in "Measured" below were taken on that runner). The workflow still weighs the minutes as much as the
wait for a pull request's result, so a change that can fail cheaply does so before the expensive flows, and
the runs a fork starts need the owner's approval first.

The flows are the expensive part (about 20 billed minutes for the whole suite in one job, when it was 243
measured flows and 2,126 s; since 8 October 2026 it is the 29 flows of the critical paths, about 308 s of
measured flow time, below), so they run **once per release** and nowhere else by default.

### Which flows

End-to-end tests are worth their cost only for **critical paths**, and a flow exists only for one:

1. getting in: sign up with an invite code, the six-digit code, sign in, sign out;
2. the core loop: search → add → start → update progress → finish;
3. offline: the app opens offline on its kept Library, and changes made offline sync later;
4. what leaves the app: the public reading page, a Book card and the waitlist form;
5. deleting the account;
6. (when it lands) the social loop.

Everything else is tested where it is cheapest: rules in pgTAP (`supabase/tests/`), logic in Vitest
(`web/tests/`: pure functions, and repositories against the local stack). Motion and visual polish are not tested
end to end. A new screen therefore does not get a flow of its own; it gets one only if it is on a path above.
Accessibility scans (`expectAccessible`) run in **one theme, dark**, for the screens on the critical paths;
colours come from tokens that docs/ACCESSIBILITY.md already checks in both themes.

| Event | What runs |
| --- | --- |
| Pull request | What the changed paths call for (below). **No Playwright flows**: the flows are where the minutes go. A new push, a force-pushed rebase or a re-run cancels the run still going for that pull request. |
| Pull request with the label **`full-e2e`** | Those checks, and **every flow**, `@full` included. Adding the label starts that run; every later push keeps it while the label is on. Any other label starts nothing and cancels nothing. |
| Push to `main` (a merge) | The checks the changed paths call for, **no flows**. A regression the checks do not see is found by the flows of the next release (below), or sooner with the label or a manual run. |
| `workflow_dispatch` | Everything, every flow (`gh workflow run CI --ref <branch>`). |
| Release (`release.yml`: the push of the release pull request's merge, or a manual run with `migrations` on) | **Every flow**, `@full` included, against the tagged commit, in the `flows` job, before `deploy`. About 20 billed minutes when it was 243 flows, fewer now (29 flows, 308 s; not measured in CI yet), once per release. |
| Docs only (`*.md`, `docs/**`, `android/**`, `LICENSE`) | No run at all. |
| The release pull request and its merge (`CHANGELOG.md`, `version.txt`, `.release-please-manifest.json` only) | No CI run. `release.yml` runs instead, and **its deploy waits for its own flows** (below). |

There is no nightly run: a full run a day would be some 600 of the account's included minutes a month, and a
run on every push to `main` about as many again (what the flows cost per merge is what this table was
changed for). The flows' result is read where it matters, in the release run.

A `what changed` job (about 5 seconds) turns the changed files into the jobs to run (`dorny/paths-filter`).
Any change under `.github/` runs everything, so CI changes are tested by CI.

| Changed path | Runs |
| --- | --- |
| `web/**`, `supabase/migrations/**`, `supabase/seed.sql`, `supabase/config.toml` | pgTAP, Vitest and the backup round trip (`backend`), plus the web build for `web/**` |
| `supabase/tests/**`, `supabase/templates/**`, `scripts/*backup*` | pgTAP, Vitest and the backup round trip |
| `design/**`, `web/app/assets/css/tokens.generated.css`, `supabase/templates/**` | Tokens check and emails check (the generated mail is current) |
| `supabase/functions/<name>/**` (goodreads-rating, regal-export, reading-page-og, enrich, waitlist-invite) | Deno lint, check, test of that function |

A pull request or a push to `main` that touches several of these runs the union. A skipped job is a pass
for everything downstream, and no branch is protected by required checks, so a skip never blocks a merge.

**Releases run the full suite themselves.** `release.yml` has a `flows` job between `release-please` and
`deploy`: it checks out the **tag** (`refs/tags/vX.Y.Z`, for a manual run the `tag` input) and runs the
same workflow the label and a manual run use (`.github/workflows/e2e.yml`, one shard). `deploy` needs it
and starts only when it passed: red, and nothing is deployed (docs/OPERATIONS.md, "Releases"). They are
left out, on purpose, in two cases only: a manual run with `migrations` off (a rollback: the older release
shipped with them, and a flow failing on an old tag must not hold a rollback back) and a manual run with
`skip_flows` on (`gh workflow run release.yml -f tag=vX.Y.Z -f migrations=true -f skip_flows=true`, to deploy
without waiting for them).

The flows are a **reusable workflow** (`e2e.yml`, `workflow_call`) rather than a composite action: what both
callers share is whole jobs (the shard matrix, the runner, the timeout, the report that merges the shards),
and an action holds steps only, so each caller would keep those twice. The callers pass `ref` (what to
test; empty is the calling run's own commit) and `shards` (a JSON list); the called workflow has no
`concurrency` of its own and reads the caller's secret `GIGET_AUTH` (`secrets: inherit`).

Jobs, and why they are shaped so:

- **`backend`**: pgTAP, Vitest against the stack, and the backup round trip
  (`scripts/test-backup-roundtrip.sh`, docs/OPERATIONS.md "Backups"), on a stack of its own, beside the
  flows rather than in front of them.
- **`e2e`** (`e2e.yml`, called by `ci.yml` for the label and a manual run, by `release.yml` as `flows`; four
  shards, one in a release): the flows (`web/e2e`) on the static build, each shard with its own stack.
- **`statics`**: the checks that take seconds (tokens, emails, `nuxt generate` with and without Regal, the Deno
  suites) in one job.
- **`e2e-report`**: when a shard failed, one HTML report merged from the shards' blob reports, with the
  traces (artifact `playwright-report`).

Every job that needs the local stack starts it **in the background** (`scripts/ci-supabase.sh start`,
without Studio, imgproxy, the edge runtime, logs, vector, postgres-meta, realtime and the pooler: nothing
uses them) and joins it (`… wait`) once pnpm has installed, the browsers' system libraries are in and the
app is built: by then it is up. The pnpm store and the Playwright browsers are cached. **Supabase images
are not cached**: restoring a `docker save` tarball and `docker load` took longer than the pull (about
125 s against 85 to 90 s), so that was dropped.
The images are pulled from `ghcr.io` (`SUPABASE_INTERNAL_IMAGE_REGISTRY` in the `backend` and `e2e` jobs) because the
CLI's default, `public.ecr.aws`, throttled the parallel pulls of the shards (`toomanyrequests: Rate exceeded`);
`supabase start took N s` in each job's log shows what the start costs.

### What makes the flows fast

- **They run on the static build**, as members get it: `web/e2e/build.ts` (`nuxt generate` with the flows'
  configuration, into `.output-e2e`), served by `web/e2e/serve.mjs` the way Cloudflare Pages serves it
  (`_headers`, `_redirects`, a folder's page with the trailing slash, the nearest `404.html`, else the SPA
  fallback, and the Pages Functions in `web/functions`). The build needs nothing of the stack, so CI makes
  it while Supabase starts. `LIBELLUS_E2E_DEV=1` runs the flows on `nuxt dev` instead.
- **A flow is handed its session.** `signedIn()` signs the member up through the API and puts the session
  into the page's storage before the app boots; the sign-in screens are tested where they are the subject
  (`auth.spec.ts`, a11y's way in, `core-loop`).
- **Reduce Motion is on** (`reducedMotion: 'reduce'` in `playwright.config.ts`), so no flow waits for a
  sheet or a morph. What is about motion opts back in with `test.use({ reducedMotion: 'no-preference' })`.
- **Workers follow the cores**: three on the runner's four (two on two cores, where three starved WebKit,
  #151). `E2E_WORKERS` overrides it.

### The `@full` flows

Tagged `@full` (`{ tag: '@full' }` on the test or its `describe`), about 30 % of the flows' time (7 of the 29
flows, about 91 s of 308): the axe scans (`a11y`). The motion and visual specs and the long
permutation lists whose rules Vitest holds are gone (see "Which flows"). A new flow is core unless it is a scan.
Nothing in CI runs the core suite alone any more (the flows left pull requests, above): the tag is what to
exclude for a quick local pass.

```sh
cd web
pnpm e2e                          # every flow, what a release runs before it deploys
pnpm e2e --grep-invert @full      # without the @full flows, for a quick local pass
pnpm e2e --grep @full             # only the @full flows
gh pr edit <n> --add-label full-e2e   # every flow on that pull request's CI
```

### Disk

A standard runner has little disk (the standard `ubuntu-latest` runner), and the flows put a lot
on it: the stack's Docker images, WebKit and Chromium, `node_modules` and the pnpm store, the two builds, and
what Playwright writes while it runs. One job running every flow (`E2E_SHARDS=1`) died of it on 8 October
2026 (run 37842426225): after about 20 minutes of flows, `WebKit encountered an internal error`, then
`ENOSPC: no space left on device` when the retries wrote their traces. Four shards spread the same flows over
four disks and never hit it.

The run printed no `df`, so the share of each part was not measured then. What is known: Playwright's output
was already small (`trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, no video; 17 retried tests in
that run, and the blob report is only uploaded when a shard fails), so the room went to the runner's own
image, which carries several GB of tools the job never uses. The flows job (`e2e.yml`) therefore:

- **frees them first** (`scripts/ci-disk.sh free`: the Android SDK, .NET, Haskell, Swift, boost, CodeQL,
  PowerShell and Docker's cached images; the first step after checkout, about a minute at most);
- **measures** with `scripts/ci-disk.sh`: `df` before and after the clean-up, a report once the stack, the
  browsers and the build are in place, one after the flows, and a sample of the used disk every two minutes
  in between (`used / avail / use%` of `/`), with what each part holds (`docker system df`, the Playwright
  browsers, the pnpm store, `node_modules`, `test-results`, `/tmp`). Read them in the log of the next full run
  (steps *Free disk the job does not need*, *Disk with the stack…*, *Disk after the flows*) before changing
  anything else; if the line still climbs by the minute, something the flows write is the culprit and the
  `/tmp` and `test-results` lines say which.

### How many shards

Four, each about as long as the others: `web/e2e/shard.ts` weighs every flow by what it took in CI
(`web/e2e/durations.json`) and hands the heaviest first to the lightest shard (a file in serial mode stays
whole; a flow not measured yet weighs the median).
Playwright's own `--shard` splits by test count in file order, which once gave one shard 12.9 minutes of
flows and the other 9.1. Refresh the weights now and then from a full run on `main`:

```sh
cd web && pnpm exec tsx e2e/shard.ts record <run id> && git add e2e/durations.json
```

Each shard costs its setup (about a minute and a half, most of it the browsers' system libraries and the
build, with the stack starting behind them) on top of its share of the flows; past four, setup is most of
a shard. The repository variable `E2E_SHARDS` changes the number without a commit. With 308 s of flows (29
flows, 24 of them weighed in `durations.json`) four shards are mostly setup; one or two are probably enough,
which no run has measured yet.

### Measured

(Taken when every push to `main` ran the flows; they run once per release now, and an estimate of what
that costs a month is in the pull request that moved them.)

Wall time of the run and its slowest jobs, from the jobs API (October 2026; runs 37606141210, 37601341246,
37607066496 before, 37623156029, 37625498536, 37624494494, 37625511464 after):

| Run | Before (2 shards, `nuxt dev`, UI sign-in, motion on) | After |
| --- | --- | --- |
| Pull request, app changed: run | 14.6–16.2 min | **4.3–4.6 min** (core suite) |
| … the slowest flows job | 15.3 min (shard 2, 684–779 s of flows) | 4.1–4.4 min (100–137 s of flows a shard) |
| … backend (pgTAP, Vitest, backup) | inside shard 1 | 3.9–4.2 min, beside the flows |
| … billed minutes (jobs rounded up) | about 32 | about 27 |
| Push to `main`: run | 4.0 min (no flows) | **about 6.5 min** (every flow, 4 shards of 157–252 s) |
| … billed minutes | about 6 | about 32 |

The flows' own time fell from about 2,650 test-seconds (CI, two workers) to about 2,130 for the whole
suite on three workers, of which the core suite was about 1,200. Cutting the suite to the critical paths
(8 October 2026) took it from 292 flows in 64 files (243 weighed, 2,126 s) to 29 flows in 13 files (24 weighed,
308 s; the weights of the flows trimmed since are unmeasured until the next `shard.ts record`). Locally (6 workers) the whole suite went
from 4.3 minutes on `nuxt dev` to 1.7 on the build.

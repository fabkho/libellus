# Client performance harness

Measures the production build of the web app the way a phone meets it: Playwright and CDP against
`nuxt generate`'s static files, served like Cloudflare Pages, on a local stack seeded with a
library of the owner's size. It changes no app code. `docs/perf/` holds what it found; this file
is how to run it again (a second run after a fix is how a fix is proven).

What it measures per journey: navigation timing, LCP, CLS (worst session window), an INP-like
number (the slowest interaction of Event Timing), TBT, long tasks and Long Animation Frames with
their script attribution, rAF frame gaps, JS heap, DOM nodes, style/layout/script time (CDP
`Performance.getMetrics`), and every request (count and bytes by type and host, cache, service
worker, duplicates). A saved result is plain JSON: `pnpm perf:report` prints it again as tables.

## Run it

Needs Docker, the Supabase CLI, Node 24, pnpm, `pnpm exec playwright install chromium webkit`, and
`pnpm install` in `web/`. Nothing here touches the shared stack (ports 553xx) or any other
worker's: it starts its own on ports 55671–55679 (`PERF_STACK_PORT` moves them) and one listener
on 3101 (`PERF_APP_PORT`).

```sh
# 1. A throwaway stack: a copy of the repo's supabase/ with its own project id and ports.
mkdir -p /tmp/libellus-perf-stack && cp -R ../supabase /tmp/libellus-perf-stack/supabase
cd /tmp/libellus-perf-stack
perl -pi -e 's/5532(\d)/5567$1/; s/^project_id = "libellus"/project_id = "libellus-perf-client"/' supabase/config.toml
supabase start -x studio,edge-runtime,realtime,logflare,vector,imgproxy
cd -                                              # back to web/

# 2. The library: 150 entries (102 read, 3 reading, 45 to read), 2,300 Catalogue Books and Works,
#    ~119 reading sessions with 2,000 progress days; its device copy is 334 KB, like production's.
pnpm perf:seed

# 3. The build (nuxt generate, with the cache headers Pages adds) and the server.
pnpm perf:build
pnpm perf:serve &                                 # https+http on :3101; stop it with `kill %1`

# 4. Measure. 5 runs of every journey on every profile takes about 20 minutes.
pnpm perf                                         # prints the tables; raw JSON in ../.data/perf/<label>/
pnpm perf --profile slow4g-4x --journey start,tabs --runs 7 --label after-fix
pnpm perf:report ../.data/perf/after-fix          # the tables again, from the saved JSON

# 5. Stop only what you started.
kill %1
(cd /tmp/libellus-perf-stack && supabase stop)    # never `supabase stop --all`
```

The stack's keys are asked of `supabase status` in `PERF_STACK_DIR` (default `/tmp/libellus-perf-stack`, as above); nothing secret is in the repo.

Run it with a quiet machine (`uptime`: the harness prints the load average at the start of every
series): the numbers move with it. A cell marked `~` has a spread ((max − min) / median) above
15 %: repeat that series when the load is lower. Compare a change against a series of the same
build made the same hour, not against a number in a document.

## Profiles (`perf/browser.ts`)

| Profile | What | Why |
| --- | --- | --- |
| `slow4g-4x` | Chromium, CPU 4x slower, 1.6 Mbit/s down, 150 ms RTT | Lighthouse's mobile setting: a mid-range Android on a mobile network |
| `slow4g-6x` | the same with CPU 6x | a lower-middle Android: stutters show earlier |
| `chromium` | Chromium unthrottled | the app's own cost on this Mac |
| `webkit` | Playwright's WebKit, iPhone 15 viewport | no throttling exists for it: reported as it is, so read it as the engine's floor, not as an iPhone |

## Journeys (`perf/run.ts`)

Every run makes a fresh browser context with a session for the seeded member, nothing else.

| Step id | Journey |
| --- | --- |
| `a-start-cold` | First launch: no service worker, empty HTTP cache, no device copy. Navigation → Home shown → quiet |
| `a-start-warm` | The app launched again in the same context: service worker, precache, device copy of the Library |
| `b1`…`b4` | Home → Library (tab) → scroll to the bottom → Profile → Home |
| `c1`, `c2` | A Book from the Library, and back |
| `d1`…`d3` | Search palette: open, type "piranesi" (recorded answers), close |
| `e1`, `e2` | Home → the Profile's figures, and back |

Each step lists the request and the window it covers; the `ready` column is tap → the screen's
element visible (for `b2` it is the scroll's duration). Steps after the start run on the warm page,
in that order, so DOM size and heap grow along the run, as in a session.

`--cpuprofile` saves a V8 profile per step and `--trace` a Chrome trace; read them with
`python3 perf/cpuprofile.py <dir>/<profile>/run-1 [step …]` and `python3 perf/analyse.py <dir>`.

## What is faked, and what is not

- **Production build, Pages semantics**: `e2e/serve.mjs` (`_headers`, `_redirects`, SPA fallback,
  Functions) behind `perf/serve.mjs`, which adds HTTP/2 over TLS (Chromium; WebKit gets plain
  HTTP/1.1, see below), brotli, ETag/304. Not emulated: Early Hints, HTTP/3, the edge's latency.
- **The API** is a hosted-Supabase look-alike host (`perf.supabase.co`, mapped to the server)
  that proxies to the local stack with brotli, which the local gateway does not do and
  Cloudflare in front of supabase.co does, so payload sizes are the ones a phone would download.
  Still cross-origin: the preflights stay. (Assumption: the preflight answer may be kept for an hour.)
- **Third parties**: Apple and OpenLibrary search answer from `tests/fixtures` after 120 ms, the
  Goodreads function after 450 ms, covers are synthetic JPEGs of the weight real ones have
  (11 KB at 120x180, 37 KB at 240x360), analytics answer empty. In Chromium these are answered
  by the server through host mapping, not by Playwright routes (a route switches the HTTP cache
  off); in WebKit routes are the only way, so its HTTP cache is off.
- **Throttling** is CDP's: it applies to the page's requests (the API and the covers too) and adds
  latency per request, not per connection (DNS, TCP and TLS setup are not paid), and not to the
  service worker's own fetches: the precache download in a cold start is unthrottled.
- WebKit on desktop, headless: no real compositor, no memory numbers, no LoAF, and its search
  journey did not run (it answers "offline" there).

## The other tools

| Command | What |
| --- | --- |
| `pnpm perf:bundle` | the build's entry, prefetched chunks, largest chunks, service worker precache by kind, fonts (no browser) |
| `pnpm perf:probe` | the Library device copy's read / parse / stringify / write cost at 1x, 4x, 6x |
| `pnpm perf:flows` | the motion flows of the earlier assessment (Home → Book cover flight, tab switches, Profile transition, search morph) with traces, rAF gaps, LoAF, `--profile` CPU profiles, `--layers` the layer tree; for the runtime and rendering work |
| `pnpm perf:layers` | composited layers mid-transition |
| `pnpm exec nuxt analyze --no-serve` | the bundle visualizer (`node_modules/.cache/nuxt/.nuxt/analyze/client.html`), unminified sizes; the plugin config is not committed |

## Android real-device session (about 10 minutes)

The harness cannot know what the owner's phone does. This is the session that tells.

1. **Phone**: Settings → About → tap *Build number* seven times → Developer options → USB debugging
   on. Plug it into the Mac. Accept the RSA prompt. `adb devices` lists it.
2. **Mac**: Chrome → `chrome://inspect/#devices` → tick *Discover USB devices*. The installed
   Libellus PWA appears as its own entry under the phone ("Libellus", type *web app*); a tab
   in Chrome appears too. Click *inspect* on the PWA.
3. In its DevTools: **Performance** tab → the gear: CPU *No throttling* (it is the real CPU), Network
   *No throttling*, tick *Screenshots* and *Web Vitals*. Close other apps on the phone, put it on
   battery saver *off*, brightness fixed.
4. Record the three worst journeys, each as its own recording (record → do it on the phone → stop,
   the timeline is 5–10 s):
   - **Cold start**: force-stop the PWA (Settings → Apps → Libellus → Force stop), start recording
     from DevTools' *Reload page* (⌘⇧E) or relaunch from the icon with *Record* armed.
   - **Library**: Home → Library tab → scroll slowly to the bottom and back up.
   - **Profile**: Home → avatar → the figures → back. (Or search: tap Search, type a title, results.)
5. Per recording look at: *Web Vitals* lane (LCP, CLS, INP markers), *Long animation frames*
   (Performance → *Timings* / the red-cornered tasks in *Main*), and the *Frames* lane for red
   (dropped) frames. In *Main* click the longest task: *Bottom-up* → group by *Activity*.
6. Export: ⌘S in the Performance panel (saves `.json`), once per recording, plus a screenshot of
   the Web Vitals lane. Name them `android-cold.json`, `android-library.json`,
   `android-profile.json`. Also *Application → Storage* → the size of Cache storage and
   `libellus.library` in Local storage (the device copy). Put the files in
   `.data/perf/android/` (gitignored) and hand them over.
7. Note the phone model, Android and Chrome versions (`chrome://version`), and the Chrome flag
   state of *Settings → Site settings → JavaScript JIT* (should be allowed).

## iOS (about 10 minutes)

Needs a Mac, the iPhone, a cable, Safari with the Develop menu.

1. **iPhone**: Settings → Apps → Safari → Advanced → *Web Inspector* on. **Mac**: Safari → Settings →
   Advanced → *Show features for web developers*.
2. Install the app from Safari (Share → Add to Home Screen), open it **from the Home Screen icon**
   (standalone, not in a Safari tab: the service worker, the safe areas and the process model differ).
3. Cable in, unlock the phone, *Trust this computer*. Mac Safari → **Develop** → *\<the iPhone\>* →
   *Libellus* (it lists the open web apps under the phone's name).
4. Web Inspector → **Timelines**: tick *JavaScript & Events*, *Layout & Rendering*, *CPU*, *Memory*
   and *Screenshots*; untick Network & Storage unless a request is in question.
5. Press record (●), do one journey on the phone, stop. The three to record: cold start (swipe the app
   away in the App Switcher first, then reopen it with the recording armed from *Develop → Libellus*
   once it is up, or note its start in the Network timeline), Library scroll, Profile open and back.
6. Look at: *Layout & Rendering* (red frames and the long *Layout*/*Style* bars), *JavaScript & Events*
   (the longest tasks), *CPU* (thermal state shown), *Memory* (peak). Export each timeline:
   *File → Export Timeline Recording…*, and screenshot the CPU view.
7. Note the model, iOS version, and whether Low Power Mode was on (it halves the frame rate: record
   with it off).

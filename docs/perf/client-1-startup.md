# Client performance, part 1: baseline, startup, bundle, network

Read-only assessment of the web app's client side, 9–10 October 2026, `origin/main` at `a9a91c89`.
Nothing in the app was changed; the measuring harness is new (`web/perf/`, how to run it:
[`web/perf/README.md`](../../web/perf/README.md)) and part 2 (runtime and rendering) reuses it.

**Reading guide.** *Proven by measurement* means a number from the harness below, repeatable with
`pnpm perf`. *Suspected from reading* means the code or the build says so but this harness cannot
show it; each of those names what would. No fix is implemented. Model tiers: **DeepSeek**
mechanical, **Sonnet** logic, **Opus** design-heavy.

## 1. Method

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, 48 GB, macOS; other workers ran on it (load average 2.1–4.6 at the start of a series, recorded in every result file) |
| Browsers | Chromium 153.0.8010.12 and WebKit 26.6 (Playwright 1.63), headless |
| App | the production build (`nuxt generate`, `web/.output/public`) of `a9a91c89`, built with the Pages `_headers` cache rules; served by `perf/serve.mjs` (HTTP/2 + brotli + ETag, `e2e/serve.mjs`'s `_headers`/SPA semantics); not Cloudflare itself |
| Backend | a throwaway local Supabase stack (own project, ports 55671–55679), proxied through a hosted-Supabase look-alike host **with brotli** (the local gateway sends JSON uncompressed; Cloudflare in front of supabase.co compresses it), so payload sizes are what a phone downloads |
| Data | synthetic library of production size: 150 entries (102 read, 3 reading, 45 to read; some read twice), 119 reading sessions, 2,084 progress days, 2,300 Catalogue Books and Works, 640 authors, 12 series, 4 collections; descriptions 0.5–1.7 KB, 40 % of reads with a review. Device copy 334 KB, the three `library_entries` answers 350 KB (110 KB brotli): the owner's ~290 KB |
| Profiles | **slow4g-4x**: Chromium, CPU 4x, 1.6 Mbit/s, 150 ms RTT (Lighthouse mobile). **slow4g-6x**: the same at CPU 6x. **chromium**: unthrottled. **webkit**: no throttling exists, reported as it is (desktop engine, not an iPhone) |
| Runs | 5 per profile, median reported; a `~` marks a cell with spread (max−min)/median above 15 %. The slow4g-4x series was run twice (`baseline-2`, `baseline-2b`, 40 min apart, load 3.5 and 4.6): stable cells agree within 3 %, the `~` cells within the flagged spread |

Fixed by the harness, and so also to be read as limits (§7): cover images are synthetic JPEGs of
real weight, Apple/OpenLibrary answer from recordings after 120 ms, Goodreads after 450 ms; CDP
throttling adds latency per request, not per connection; the service worker's own downloads are
not throttled.

Raw results: `.data/perf/baseline-2/{slow4g-4x,chromium,webkit}.json`, `baseline-2b/`,
`baseline-2-6x/` (gitignored), reproducible with `pnpm perf --label …`.

## 2. Baseline

Journeys: **a** start (cold: first launch, no service worker, empty cache, no device copy; warm:
launched again with all of that), **b** Home → Library → scroll to the bottom → Profile → Home,
**c** a Book from the Library and back, **d** the search palette (open, type "piranesi", close),
**e** Profile figures. `ready` is tap → the screen's element visible; for `b2` it is the scroll's
duration. TBT/LoAF are in ms in the step's window, `frames>50` counts rAF gaps above 50 ms.

### Baseline in five lines (slow4g-4x, medians)

1. **Cold start**: first paint (FCP, and Home shown) **2.85 s**, LCP **3.75 s**; 179 requests, 466 KB seen by the page (910 KB on the server's wire including the service worker's precache).
2. **Warm start** (the usual PWA launch): Home shown **0.36–0.39 s**, 1–2 long animation frames of 170–240 ms (CPU 6x: 0.62 s, 310–460 ms).
3. **Tab switches** (Home→Library, Library→Profile, Home→Profile): ready 140–240 ms, but each carries a **120–220 ms long animation frame** and 60–100 ms TBT; worst frame 117 ms (6x: 183–233 ms).
4. **Book / search / profile figures**: book open 150 ms, search typing 1.6 s (including 8 × 90 ms of typing), results shifted **CLS 0.42**; interactions answer in 24–64 ms (INP-like).
5. **Unthrottled** (this Mac): cold 89 ms to Home, warm 89 ms, no long frame above 33 ms; **WebKit** (desktop): cold 132 ms, warm 123 ms, worst frame 53–95 ms.

### slow4g-4x

chromium 153.0.8010.12, 5 runs, commit a9a91c89, load average at start 3.45 3.29 2.86. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |   CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | ----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |     2835 |   3752 |     0 |      — |    ~22 |     ~3 |    1210 |           — |         — | 179 | 466 |       7 |
| a-start-warm          |      361 |    376 |     0 |      — |      0 |     ~2 |    ~219 |           — |         — | 171 |  93 |     6.9 |
| b1-home-to-library    |      217 |      — |     0 |     32 |    ~57 |      1 |     118 |        ~100 |         1 |  40 | 111 |    11.2 |
| b2-library-scroll     |     3053 |      — |     0 |      — |      0 |      0 |       0 |        ~100 |         1 |  44 |   8 |     9.3 |
| b3-library-to-profile |      200 |      — | 0.006 |     32 |    ~66 |      2 |     208 |         117 |         3 |  26 |  65 |    11.8 |
| b4-profile-to-home    |      139 |      — |     0 |     32 |      0 |      0 |       0 |         117 |        ~3 |   5 |  93 |    11.6 |
| c1-library-to-book    |      155 |      — | 0.009 |     40 |      0 |      1 |     ~56 |         117 |        ~3 |  23 |   5 |      13 |
| c2-book-back          |      117 |      — |     0 |    ~40 |      0 |      0 |       0 |         117 |        ~3 |   5 | 108 |    13.9 |
| d1-search-open        |      ~83 |      — |     0 |    ~40 |      0 |      0 |       0 |         117 |        ~3 |   2 |  90 |      13 |
| d2-search-type        |     1569 |      — |  0.42 |     24 |    ~13 |     ~2 |    ~121 |         117 |        ~3 |  34 | 114 |    16.8 |
| d3-search-close       |      ~64 |      — |     0 |     40 |      0 |      0 |       0 |         117 |        ~3 |   0 |   0 |    14.8 |
| e1-profile-open       |      243 |      — |     0 |     32 |    ~60 |      1 |    ~127 |        ~133 |         1 |  19 |  65 |    11.4 |
| e2-profile-back       |      ~91 |      — |     0 |      — |      0 |      0 |       0 |        ~133 |        ~2 |   5 |  93 |    10.1 |

### slow4g-6x

chromium 153.0.8010.12, 5 runs, commit a9a91c89, load average at start 4.52 3.55 3.08. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |   CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | ----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |     2994 |   3872 |     0 |      — |     72 |     ~5 |    1456 |           — |         — | 179 | 451 |       7 |
| a-start-warm          |     ~618 |   ~636 |     0 |      — |      0 |     ~4 |    ~461 |           — |         — | 171 |  93 |     6.9 |
| b1-home-to-library    |      317 |      — |     0 |    ~24 |    136 |      1 |     201 |        ~183 |         1 |  40 | 111 |    11.2 |
| b2-library-scroll     |     3055 |      — |     0 |      — |      0 |      0 |       0 |        ~183 |         1 |  44 |   8 |     9.5 |
| b3-library-to-profile |      284 |      — | 0.006 |    ~32 |   ~185 |      2 |    ~328 |         183 |         3 |  26 |  65 |      12 |
| b4-profile-to-home    |     ~174 |      — |     0 |    ~24 |      0 |     ~1 |     ~64 |         183 |         4 |   5 |  93 |    11.9 |
| c1-library-to-book    |     ~215 |      — | 0.009 |    ~56 |    ~32 |      1 |    ~104 |         183 |         5 |  23 |   5 |      13 |
| c2-book-back          |      147 |      — |     0 |    ~48 |      0 |      1 |      52 |         183 |        ~5 |   5 | 109 |    14.1 |
| d1-search-open        |      105 |      — |     0 |     64 |      0 |      0 |       0 |         183 |        ~5 |   2 |  90 |    13.5 |
| d2-search-type        |     1615 |      — |  0.42 |    ~32 |    ~58 |      2 |     195 |         183 |        ~7 |  34 | 114 |    17.1 |
| d3-search-close       |       81 |      — |     0 |    ~48 |      0 |      0 |       0 |         183 |        ~7 |   0 |   0 |    14.9 |
| e1-profile-open       |     ~338 |      — |     0 |    ~24 |   ~139 |      1 |    ~220 |        ~233 |         1 |  19 |  65 |    11.4 |
| e2-profile-back       |      118 |      — |     0 |      — |      0 |      1 |     ~60 |        ~233 |         2 |   5 |  93 |    10.2 |

### chromium (unthrottled)

chromium 153.0.8010.12, 5 runs, commit a9a91c89, load average at start 2.76 3.02 2.83. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |    CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | -----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |       89 |   ~148 |      0 |      — |      0 |      0 |       0 |           — |         — | 179 | 835 |       7 |
| a-start-warm          |       89 |    100 |      0 |      — |      0 |      0 |       0 |           — |         — | 172 |  93 |     6.9 |
| b1-home-to-library    |      127 |      — |      0 |     32 |      0 |      0 |       0 |         ~17 |         0 |  62 | 111 |    11.4 |
| b2-library-scroll     |     3020 |      — |      0 |      — |      0 |      0 |       0 |         ~17 |         0 |  22 |   8 |       9 |
| b3-library-to-profile |      122 |      — |      0 |     32 |      0 |      0 |       0 |         ~33 |         0 |  26 |  65 |    12.8 |
| b4-profile-to-home    |      123 |      — |      0 |     32 |      0 |      0 |       0 |         ~33 |         0 |   5 |  93 |    11.9 |
| c1-library-to-book    |      130 |      — | ~0.002 |    ~40 |      0 |      0 |       0 |         ~33 |         0 |  23 |   5 |    13.1 |
| c2-book-back          |      ~74 |      — |      0 |    ~40 |      0 |      0 |       0 |         ~33 |         0 |   5 | 108 |    13.6 |
| d1-search-open        |      ~57 |      — |      0 |    ~40 |      0 |      0 |       0 |         ~33 |         0 |   2 |  90 |    14.1 |
| d2-search-type        |     1039 |      — |      0 |    ~24 |      0 |      0 |       0 |         ~33 |         0 |  34 | 114 |      16 |
| d3-search-close       |      ~51 |      — |      0 |     40 |      0 |      0 |       0 |         ~33 |         0 |   0 |   0 |    14.7 |
| e1-profile-open       |     ~126 |      — |      0 |     32 |      0 |      0 |       0 |         ~33 |         0 |  19 |  65 |    10.8 |
| e2-profile-back       |      ~76 |      — |      0 |      — |      0 |      0 |       0 |         ~33 |         0 |   5 |  93 |      10 |

### webkit

webkit 26.6, 5 runs, commit a9a91c89, load average at start 2.6 2.94 2.83. Median per cell, ~ = spread above 15 %. The search step (`d2`) did not run: the palette answered "You're offline" there, so only Library search was available; WebKit's numbers have no heap, no LoAF, no throttling.

| step                    | ready ms | LCP ms | CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |   KB | heap MB |
| ----------------------- | -------: | -----: | --: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | ---: | ------: |
| a-start-cold            |     ~132 |   ~252 |   0 |      — |      0 |      0 |       0 |           — |         — | 132 | 1381 |       — |
| a-start-warm            |      123 |    144 |   0 |      — |      0 |      0 |       0 |           — |         — | 123 |  623 |       — |
| b1-home-to-library      |     ~104 |      — |   0 |     16 |      0 |      0 |       0 |         ~53 |        ~1 |  51 |   47 |       — |
| b2-library-scroll       |      864 |      — |   0 |      — |      0 |      0 |       0 |         ~53 |        ~1 |   0 |    0 |       — |
| b3-library-to-profile   |     ~114 |      — |   0 |     16 |      0 |      0 |       0 |         ~53 |        ~1 |   4 |   11 |       — |
| b4-profile-to-home      |      105 |      — |   0 |     16 |      0 |      0 |       0 |         ~53 |        ~1 |   0 |    0 |       — |
| c1-library-to-book      |     ~101 |      — |   0 |    ~40 |      0 |      0 |       0 |         ~55 |         1 |   6 |   56 |       — |
| c2-book-back            |      ~71 |      — |   0 |     16 |      0 |      0 |       0 |         ~55 |         1 |   0 |    0 |       — |
| d1-search-open          |      ~47 |      — |   0 |     16 |      0 |      0 |       0 |         ~55 |         1 |   0 |    0 |       — |
| d2-search-type (0/5 ok) |        — |      — |   — |      — |      — |      — |       — |           — |         — |   — |    — |       — |
| d3-search-close         |      ~31 |      — |   0 |     16 |      0 |      0 |       0 |         ~55 |         1 |   0 |    0 |       — |
| e1-profile-open         |     ~124 |      — |   0 |     16 |      0 |      0 |       0 |         ~38 |         0 |   4 |   11 |       — |
| e2-profile-back         |      ~76 |      — |   0 |      — |      0 |      0 |       0 |         ~46 |         0 |   0 |    0 |       — |

### Cross-check with the field rows

| Field (12 rows, poor values only, mixed builds) | This harness |
| --- | --- |
| LCP 6.4 s on `/`, 4.7 s on `/book/:key` | Cold start LCP 3.75 s at 4x/Slow 4G, 3.87 s at 6x: the right order of magnitude for a first launch, a faster phone or network than the bad rows. The LCP *element* is the decorative film grain (see F-12), not content |
| INP 320 ms on `/profile`, 340 ms on `/library` | INP-like 24–64 ms at 6x: the harness does **not** reproduce it. The long frames at the same two interactions (Library 201 ms, Profile 328 ms LoAF at 6x) are the nearest thing; a real phone is slower than 6x of this Mac and has a real GPU. Needs the Android session (README) |
| CLS 0.35–1.15 on `/book/:key` (8 rows) | Book open: CLS 0.009 (the late Goodreads row, 450 ms). **Not reproduced.** The **search palette** reproduces CLS **0.42** when typing under throttle (F-4); with the palette present on every page this is the likeliest source of the CLS on `/` (0.74) and possibly of the Book rows |
| CLS 0.74 on `/` | F-4 (palette), see above |

## 3. What was measured about startup

### 3.1 Cold start, slow4g-4x: where the 2.85 s go (proven)

| t (ms) | what |
| ---: | --- |
| 0–170 | document (2.6 KB brotli) |
| 180–1,190 | **one long animation frame of 1,009 ms with no script attribution**: parse, compile and evaluate of the entry (10 files, 675 KB raw / 186 KB brotli) at 4x; `domInteractive` 1,186 |
| 250–2,000 | the entry's 9 modulepreloads (186 KB) **and 45 `<link rel=prefetch>` chunks** (294 KB in this wave) share the 1.6 Mbit/s pipe |
| 2,000–3,400 | three more dependent waves of chunks and component CSS: layout, route and components, **65 JS + 29 CSS files** the first screen needs; `DOMContentLoaded` 2,019, `load` 2,341 |
| 2,831 | Home shown = FCP 2,852. The API requests (Library ×3, accounts, six preflights) start **now**, after the whole JS graph |
| 3,000–3,700 | the three `library_entries` answers (3 KB, 26 KB, 64 KB brotli) arrive; LCP at 3,750 |
| 5,940 | service worker ready (precache 196 files) |

Two experiments on the served HTML (no app change, `PERF_EXPERIMENT` in `perf/serve.mjs`, 5 runs each):

| | Home shown | LCP | requests | cold LoAF total |
| --- | ---: | ---: | ---: | ---: |
| as built | 2,835–2,852 | 3,752–3,792 | 179 | 1,210–1,261 ms |
| no `<link rel=prefetch>` | 2,890 | 3,612 | 134 | 650 ms |
| + preload of the 65 JS / 29 CSS files of waves 2–4 | 2,782 | 3,516 | 134 | 1,738 ms |

The waterfall is not the bottleneck: removing the prefetches and pre-announcing the second wave
moves the first paint by **≤ 60 ms** and LCP by 150–280 ms. What the first paint costs is **bytes
on a 200 KB/s pipe and main-thread work at 4x**: about 400 KB brotli before the first screen
(≈ 2 s of pure transfer) and ≈ 1 s of parse/compile/evaluate. So every 20 KB brotli removed from
what the first screen needs is ≈ 100 ms, every 100 KB raw JS ≈ 150 ms.

### 3.2 Warm start (proven)

Home shown 361–392 ms at 4x (618 ms at 6x); LCP 376–408 ms. One long animation frame of 170–240 ms:
`DZPE9BzL.js import.then` (the entry module: app creation, plugins, first render) of which 30–40 ms
is forced style and layout (`window.scrollY` read at mount: `useHideOnScroll`'s first call, a 40 ms
self-time function in the CPU profile; `app/layouts/tabs.vue`'s `measureScroll` reads it too).
Over the wire: 171 requests, **0 KB** except the API (93 KB brotli): the precache serves 156 app
requests (cache lookups; 45 of them are the prefetch links again).

**The Library device copy is not a startup cost** (proven, `pnpm perf:probe`): reading the 334 KB
`libellus.library` key, `JSON.parse`, `JSON.stringify` and the write back cost **0.5 / 0.4 / 0.4 ms
at 4x** (0.8 ms at 6x). Lists are `shallowReactive` already (`stores/library.ts:76`).

### 3.3 Bundle (proven, `pnpm perf:bundle`, `nuxt analyze`)

| | raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| Entry (index.html: 1 script, 1 stylesheet, 9 modulepreload) | 675.5 KB | 213.5 KB | **186.5 KB** |
| Prefetched on every start (45 files) | 244 KB | | 81 KB |
| All JS+CSS in `_nuxt/` (165 files) | 1,823 KB | | 544 KB |
| Service worker precache (196 entries) | 1,999 KB | | **739 KB** download (505 KB JS, 28 KB CSS, 163 KB fonts, 42 KB icons) |

Entry composition, from the visualizer (unminified rendered sizes; the shares are what matters):

- `@supabase/supabase-js` and its parts are **57 % of the biggest chunk** (643 KB unminified): auth-js 171 KB, **realtime-js 55 KB + phoenix 40 KB (the app never opens a channel)**, storage-js 41 KB (avatars only), postgrest-js 30 KB, supabase-js 20 KB, iceberg-js 8 KB, functions-js 6 KB.
- `@intlify/message-compiler` 36 KB, core-base 34 KB, vue-i18n 32 KB, `@nuxtjs/i18n` 48 KB: **the message compiler ships although the messages are precompiled** (`en.json` is already AST in `B2u3xcCm.js`).
- Vue 198 KB (runtime-core 150), vue-router 52 KB, nuxt 95 KB, unhead 33 KB, pinia 12 KB.
- `en.json` (61.6 KB source, ~1,600 strings) is **not in the entry**: it is a lazy chunk (86 KB raw / 14.5 KB brotli as precompiled AST), fetched in the second wave, on the critical path of the first screen.
- Lazy and rightly so: zxing (`zxing.*.js` + wasm, not precached), Regal (not in this build), the reader/foliate chunks, dompurify (reader).
- Duplicated packages: `cookie-es` (1.2.3, 3.1.1), `hookable` (5.5.3, 6.1.2), `@vue/devtools-api` (6.6.4, 8.2.1): small (~10–20 KB unminified together).
- No polyfills beyond Vite's 1.2 KB modulepreload polyfill.

### 3.4 Fonts, icons, service worker

- Eight woff2 files (Geist 300/400/500/600, Geist Mono 400/500, Newsreader 500, 400 italic; ≈ 100 KB), `font-display: swap` (fontsource default), latin subset. **No `<link rel=preload>`**: the first three are requested at 2,832 ms, the rest at 3,746 ms (after the Library renders), so the text is first painted in the fallback face and swapped. CLS 0 everywhere; the cost is a late swap, not a shift.
- Icons in the entry: only the favicon/manifest links. Images: none in the entry.
- Service worker (`sw.js`, workbox `generateSW`, `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches`, no navigation preload): precaches 196 files including the 15 identical 6.5 KB HTML shells, the reader's chunks and all route chunks. `sw.js`, `sw-sync.js`, `sw-share.js` and the manifest are `no-cache`; `/_nuxt/*` immutable for a year, HTML `max-age=0, must-revalidate` (the production `_headers`, read from the build and served as is).

## 4. Network (proven unless marked)

- **Requests**: cold start 179 (156 app files + 15 API incl. 8 preflights + 8 covers), warm 171 (156 answered by the service worker), Library tab 40, Profile open 19–26, Book 23, search typing 34, every step 0–5 `preflight` rows (one per distinct API URL: the browser keeps a preflight per URL).
- **The Library is fetched in full on every tab switch** (F-1): 3 `library_entries` requests = 350 KB JSON, 111 KB brotli, each time.
- **Payloads** (brotli / decoded): finished list 64 KB / 255 KB, to-read 26 KB / 95 KB, reading 3 KB / 7 KB; Profile: `reading_sessions` 55 KB / 237 KB, `reading_progress_days` 3 KB / 55 KB, `library_genres` 7 KB / 22 KB; `collections` 9 KB / 29 KB. Compression ratio 3.9x: local gateway does none, Supabase's CDN does (**assumed**: not verified against production, which the brief excludes).
- **Covers**: sizes match the display (Library rows 28 × 120x180 = 11 KB each; Home/Reading card 8 × 240x360 = 37 KB; Book page 600x900 only for the hero), `loading=lazy`, `decoding=async`, `fetchpriority=high` on the first ones, thumbhash under every cover. Format is the source's JPEG, no `srcset`, no WebP/AVIF (Apple's CDN offers none). Nothing to fix here beyond F-5.
- **Cold-start wire** (server log): 229 requests, 910 KB brotli for a first launch, of which **132 KB are files sent twice** (page prefetch + service worker precache, 5 files; the harness cannot throttle the service worker, on a phone these compete for the same radio). 304s: none seen (every cached file is served from the service worker or immutable).
- **Order**: the API starts after the whole JS graph (2,831 ms at 4x); the three list queries, accounts and the preflights go out together (parallel, good). A Book page asks 10 requests in parallel, Goodreads/enrich last (450 ms server time in the harness) without shifting layout (CLS 0.009).
- **Supabase round trips that block first paint**: none: the first paint (Home shown) happens at 2.83 s from the device copy/skeleton before the Library answers. With no device copy (cold) Home shows its title and waits (LCP is the grain at 3.75 s, see F-12).
- Not proven here: DNS/TCP/TLS setup to the API origin (F-8), HTTP/3, Early Hints (Pages enables them; `_headers` has no `Link: rel=preload` entries for them to send).

## 5. Findings, ranked by impact × effort

Gains are for the slow4g-4x profile unless stated; "expected" is an estimate to be confirmed by
re-running `pnpm perf` on the fix.

### Proven by measurement

**F-1. The whole Library is reloaded on every tab activation** — impact high, effort S–M
- Evidence: `app/pages/index.vue:45` (`onActivated(load)`), `app/pages/library.vue:101` (`onActivated(() => library.load() …)`), `stores/library.ts:96` `load()` has no freshness window: `loadedAt` only discards *older answers*. Home→Library: 40 requests, **3 × `library_entries` = 350 KB JSON / 111 KB brotli** 2 s after the previous load; Profile→Home: the same again (93 KB brotli); Profile open: `reading_sessions` 237 KB + `progress_days` 55 KB + genres 22 KB, every time. The parse/mapping lands in the tab-switch animation: LoAF `lRaWNZUA.js Response.text.then` **76–175 ms**, `setTimeout` frame 107–186 ms on Library mount, TBT 57–102 ms (4x), worst frame 117 ms (6x: 183–233 ms, 201 / 328 ms LoAF). This is the likeliest source of the owner's occasional stutters: they come with the tab switch, not with scrolling.
- Fix: a freshness window (skip the refresh when the lists are younger than e.g. 60 s and nothing changed on the device (`lastChange`)); refresh on `visibilitychange` and pull-to-refresh instead; one RPC for the three lists; later a delta (`updated_at`/ETag) so a refresh answers in bytes, not hundreds of KB. Same treatment for the Profile's sessions.
- Risk: medium (stale Library after an add on another device: the outbox/`lastChange` rules exist; needs tests in `tests/`); offline paths unchanged. Expected: −100–200 ms main thread per tab switch, −100–450 KB per switch; removes the long frame at b1/b3/b4. Tier: **Sonnet** (logic + data-layer tests).

**F-2. Cold start is bytes and main-thread bound; the entry is 186 KB brotli and 57 % of its main chunk is the Supabase client** — impact high (first launch, every update), effort M
- Evidence: §3.1 (1,009 ms unattributed LoAF = entry parse/compile; ~400 KB brotli before first paint on a 200 KB/s link), §3.3 (supabase-js parts 57 %, **realtime + phoenix 95 KB unminified for a feature the app never uses**, message compiler 36 KB shipped for precompiled messages), the two experiments (waterfall fixes alone give ≤ 60 ms).
- Fix: build the Supabase client from `auth-js`, `postgrest-js`, `functions-js` (and `storage-js` lazily, only the avatar code uses it) instead of `createClient`; `i18n` runtime-only bundle (`bundle.runtimeOnly`) to drop the compiler; look at what else the first screen's 65 chunks pull in. Expected: −60–100 KB raw gzip-equivalent of ≈ 25–35 KB brotli ⇒ −150–250 ms on Slow 4G cold, −100–200 ms of compile at 4x. Risk: medium (a hand-assembled client must keep `createSupabaseClient`'s contract: `app/data/createSupabaseClient.ts` is the one place; a native port is unaffected). Tier: **Sonnet** (build config + client assembly), measured with `pnpm perf:bundle`.
- **Status: Fixed (the Realtime half; the message compiler is not done).** `@supabase/realtime-js` (and the Phoenix socket under it) is aliased to a 30-line stub (`app/data/realtimeStub.ts`; `nuxt.config.ts` `vite.resolve.alias`, the same alias and `server.deps.inline` in `vitest.config.ts` so the data-layer suite runs on the client the app ships) instead of assembling the client by hand: `createSupabaseClient` and its contract are untouched, auth, PostgREST, Storage and Functions are the library's own code. The app opens no channel, so nothing is lost; `channel()` throws. Measured (`pnpm perf:bundle`; `pnpm perf --profile slow4g-4x --journey start,tabs --runs 7`, load 7.5 before, 4.6 after): the supabase chunk 216.9 → 161.9 KB raw (47.9 → 34.8 KB brotli), the entry 685.0 → 630.0 KB raw / 190.5 → 177.4 KB brotli (−13 KB), cold start (Home shown) 3,142 → 3,063 ms (−79 ms, runs within 3,123–3,149 and 3,058–3,094), cold LCP 4,100 → 4,016 ms, cold wire 507 → 497 KB. Warm start and the tab journeys do not move. `tests/realtime-stub.test.ts` pins what supabase-js asks of the stub; a supabase-js upgrade that asks more fails there.

**F-3. DOM and style cost grow along a session; the Library renders all 150 rows** — impact medium, effort S (CSS) to L (virtualization)
- Evidence: DOM nodes 514 (warm start) → 1,542 (Library) → 2,855 (Profile) → 3,312 (Book) → **4,631 (search)**; style recalculation 29 ms (Library mount) → 127 ms (Profile) → **172 ms while typing in search** (4x), heap 7 → 17 MB. Home and Library are `keepalive` (`pages/index.vue:12`, `pages/library.vue:22`), no `content-visibility` anywhere in `app/`.
- Fix: `content-visibility: auto` + `contain-intrinsic-size` on Library rows (S); the Library list as a windowed list if that is not enough (L). Expected: Library mount and every later style recalc scale with the visible rows, not 150: the biggest lever against "gets laggy after a while". Risk: medium (scroll anchoring, the book flight reading row positions: `useBookFlight`, `data-cover`). Tier: **Sonnet** for the CSS attempt, **Opus** if virtualization.
- The step order matters: search ran last, after the other pages were alive; part 2 should measure it in isolation.

**F-4. Search typing shifts the results: CLS 0.42 under throttle** — impact high for the Vitals score, effort M
- Evidence: `d2-search-type`, CLS **0.4203** in every slow4g run (4x and 6x, two series), 0 unthrottled; shifted nodes: three `li` results (`0,0,0,0 → 12,561 / 12,493 / 12,357, 388 × 68`), LoAF `Response.json.then` 98–108 ms at the same moment. The palette is on every page, so its CLS counts for `/` and the Book (field: 0.74 on `/`). `components/shell/SearchOverlay.vue:25–32` already records a CLS 1.0 history here (the "room" in `usePaletteRoom.ts`).
- Fix: diagnose with a trace (`pnpm perf:flows --only search-open`, part 2), likely rows entering with transforms (`ListMotion`) counted as shifts when answers arrive in batches; reserve or animate with `transform` only. Risk: low–medium (motion design: docs/MOTION.md). Expected: CLS 0.42 → < 0.05. Tier: **Opus** (motion, design-heavy), or Sonnet with the trace in hand.

**F-5. Thumbhash decoded again for every cover that mounts** — impact low–medium, effort S
- Evidence: CPU profile of `b1` at 4x: `thumbhash` decode (`BTSrIoed.js`: 16.7 + 12.4 ms self) = **29 ms of the 120 ms Library mount**; `app/utils/cover.ts:27` `thumbhashDataUrl` base64-decodes and builds a PNG each call, from the `underlay` computed of every `UiCover` (`components/ui/Cover.vue`), no cache; the same book decodes again on Home, Library and Book.
- Fix: a module-level `Map<hash, dataUrl>` (bounded). Risk: very low. Expected: −25–30 ms per Library mount at 4x, less on Home. Tier: **DeepSeek**.
- **Status: Fixed.** `thumbhashDataUrl` moved to `app/utils/thumbhash.ts` (a 512-entry least-recently-used `Map`, bad hashes remembered too); `utils/cover.ts` re-exports it, so `components/ui/Cover.vue` needs no edit. Measured (`slow4g-4x`, 7 runs, load 4.8, against the build before it): Library mount (`b1`) ready 233 → 211 ms, its long animation frame 125 → 112 ms, TBT 66 → 51 ms; the cold start does not move (3,063 → 3,076 ms, noise: the covers there are not yet on screen). `tests/thumbhash-cache.test.ts` pins one decode per hash, the bound and the eviction order.

**F-6. Forced layout at boot and a startup frame of 170–240 ms** — impact low–medium, effort S–M
- Evidence: §3.2. `useHideOnScroll` (`composables/useHideOnScroll.ts`, in the tab bar) and `layouts/tabs.vue`'s `measureScroll` read `window.scrollY` during mount: 40 ms self time at 4x, 30–40 ms forced style/layout in the boot LoAF (`forced` attribution on `DZPE9BzL.js:124405`).
- Fix: read in a `requestAnimationFrame` after mount, or from the scroll event only. Risk: low. Expected: −30–40 ms at 4x on every launch. Tier: **DeepSeek**.
- **Status: tried, no gain, not shipped.** `scrollY` (tab bar, `layouts/tabs.vue`), `innerHeight` and `matchMedia().matches` were read after the first painted frame instead of at mount (7 runs, `slow4g-4x`, load 7.8): warm start's boot frame stays 267–273 ms (before 273), its forced style/layout stays 46–58 ms in every run, cold LoAF 1,528 ms unchanged. The CPU profile says why: the layout is still forced at boot, now by Vue's `TransitionGroup` (`getBoundingClientRect` of every child on an update render, `Dr` in the entry chunk, 52 ms self) — the first reader pays for a dirty first render, whoever it is; it is work the frame would do before painting anyway. Removing `scrollY` moves the bill, not the work. What would move it is a smaller first render (F-13), not the reads.

**F-7. Prefetching every route chunk on every start** — impact low–medium, effort S–M
- Evidence: 45 `<link rel=prefetch>` (244 KB raw, 81 KB brotli) in `index.html`; cold: 55 requests share the pipe with the entry, 132 KB of the cold wire go out twice (with the precache); warm: 45 cache lookups. Experiment: without them **−45 requests, LCP −150 ms, LoAF 1,210 → 650 ms** on a cold start; first paint unchanged.
- Fix: drop the prefetch hints (the service worker has them after the first launch anyway): Nuxt's `render:html`/`build:manifest` hooks, or an `app.head` filter. Risk: low (a first launch that never gets the SW installed loses prefetch). Expected: as measured. Tier: **DeepSeek** (find the hook).

**F-8. Profile open: View Transition callback and forced layouts** — impact medium, effort M (part 2)
- Evidence: `ViewTransitionCallback` LoAF **75–189 ms** at Profile open, `getBoundingClientRect` 47 ms + `getPropertyValue` 20 ms self (b3 CPU profile): `plugins/profile-transition.client.ts` measures before the first frame; plus the parse of F-1.
- To part 2 with the flows harness (`pnpm perf:flows --only profile-open --profile`).

### Suspected from reading (the harness cannot show it; what would)

**F-9. No `preconnect` to the API origin, and the API starts last** — effort S, tier DeepSeek. `index.html` has none; the first API request pays DNS + TCP + TLS (≈ 3 RTT, 450 ms at 150 ms) *after* 2.8 s. Expected: −300–450 ms on the data path of a cold start on cellular. Needs: a real network (CDP charges latency per request, not per connection). Also start the session read and the Library request in an early plugin instead of from mount (M, Sonnet): the data would arrive during the JS waves instead of after.

**F-10. One CORS preflight per distinct API URL** — 8 on a cold start, every Book/Profile query adds its own (the preflight cache is per URL; the assumed `max-age` of an hour does not help new URLs). On Slow 4G each is a round trip (150 ms) before its request. Fix: fewer distinct URLs (F-1's single RPC), or a same-origin API path (Pages Function or `_redirects` proxy: L, risk medium, also removes the second connection). Needs: real device or `tc`-level shaping to price it.

**F-11. Service worker precache is 739 KB download and includes the reader** — the first launch downloads the app twice over (page + SW, §4) and, after each deploy, every changed chunk once more. The reader/foliate/dompurify chunks (~100–150 KB brotli of the 505 KB JS) are for a feature opened rarely; exclude them like zxing (`workbox.globIgnores` in `nuxt.config.ts:278`) and cache on first use. Cost: opening the reader offline the first time. S, Sonnet (product choice). Needs: the SW install timing under throttle (not possible with the page's CDP session).

**F-12. The LCP element is the film grain, not content** — `components/ui/Ambient.vue:64` paints a 160 × 160 `feTurbulence` SVG data URI as a `background-image`; Chrome reports it as the LCP candidate (3.75 s cold, 0.38 s warm), and so does the field reporter. Real content paints earlier or later than the number says; the field LCP 6.4 s on `/` cannot be read as the content's. Fix: make the grain a non-candidate (a pseudo-element, a `mask`/canvas, or a raster PNG) and watch the real hero; S, DeepSeek; first confirm in the field that LCP drops to the Home content.

**F-13. The layout mounts seven sheets and the search overlay on every page** — `layouts/tabs.vue:76–83` (`BookAddSheet`, `BookManualSheet`, `BookStartSheet`, `BookFinishSheet`, `BookProgressSheet`, `BookAbandonSheet`, `ShellWhatsNewSheet`, `SearchOverlay`) are part of the first render's 65 chunks and ~500-node DOM. Lazy-mount each on first open (`Lazy` prefix + `v-if` once opened). Expected: fewer chunks and nodes at first paint; effort M (sheet open animations must still run from a mounted closed state), Sonnet. Needs: a before/after of `a-start-cold` bytes and `nodes`.

**F-14. Fonts are discovered late** — preload the two critical faces (Geist 400/500, ≈ 26 KB) so the swap happens with the first text, not at 3.7 s; S, DeepSeek. Expected: text in the right face from the first paint; no measured loss today beyond the late swap.

**F-15. `en.json` is on the critical path as a separate round trip** — 14.5 KB brotli fetched in wave 2; inlining the messages the first screen needs, or loading per screen, saves a round trip (≈ 150 ms) and, with F-2, the compiler. M–L, Sonnet; the harness shows the chunk in the waterfall but the gain is small (≤ 100 ms by the experiments' scale).

### Checked and fine

`shallowReactive` library lists (`stores/library.ts:76`); the device copy's parse/write (0.4–0.5 ms at 4x); cover sizing, lazy/async/priority hints and thumbhash underlays; `/_nuxt/*` immutable, HTML revalidated, `sw.js` never cached; zxing and Regal kept out of the entry and the precache; no hydration work (static SPA); Intl formatters cached (#182); the three list queries and the Book page's queries go out in parallel.

## 6. Order of work

1. F-1 (Sonnet) — the stutter on tab switches, the largest user-visible gain.
2. F-4 (Opus/Sonnet) — the Vitals score, reproducible now.
3. F-5, F-6, F-7, F-9 (preconnect only), F-14 (DeepSeek, an afternoon, each proven with `pnpm perf`).
4. F-2, F-3, F-13 (Sonnet) — bytes and DOM; re-measure `a-start-cold` and `d2`.
5. F-8, F-10, F-11, F-12 after part 2 and the Android session.

## 7. What could not be measured

- **A real phone**: the 4x/6x CPU is this Mac's M5 slowed down, not an Android's memory system, GPU or thermals; the field INP of 320–340 ms is not reproduced (README: the 10-minute Android and iOS sessions).
- **iOS**: WebKit here is desktop Playwright WebKit without throttling, compositor details or standalone-mode process behaviour; its search journey did not run ("offline" answer from the palette).
- **Connection setup and HTTP/3**: DNS, TCP and TLS are not charged by CDP throttling; Early Hints and h3 are not emulated.
- **The service worker's own downloads and install cost** under throttle (CDP's session does not reach the worker); precache size and double download are known, their time is not.
- **Production headers on a Function response and Cloudflare's compression of the API**: assumed (docs/HOSTING.md), not touched.
- **The real library's content** (covers from Apple's CDN, real descriptions): synthetic but sized to the owner's 290 KB; the field CLS on `/book/:key` (0.35–1.15) did not reproduce with it.

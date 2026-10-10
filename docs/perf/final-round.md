# Performance, final round: smoke test, benchmark and what is left

10 October 2026, `origin/main` at `5efb42a2` (**v1.9.1**). Docs and data only: no app code, no migration, no
production write. This round re-runs the earlier rounds' measurements on the release that carries all of them
(`client-1-startup.md`, `backend.md`, `bundle.md`; PRs #238, #243–#246, #249, #251–#255, #258–#267), smokes
production logged out, and ranks what is still open. Raw files: [`data/final/`](data/final/).

**Evidence classes.** **P** measured in production (logged out, https://libellus.fabkho.dev), **L** measured
locally (the harness of `web/perf/`, `scripts/perf/`), **C** read from code or a build. A number without a class
is L. Model tiers: **DeepSeek** mechanical, **Sonnet** logic, **Opus** design or diagnosis.

## 0. The short version

**Verdict: the performance round is done for what the harness can see, and not proven where it matters.**
Every item that cost a member something on a tab switch, a request or the backend is fixed and holds:
no refetch on a tab switch (40 requests/111 KB → 37/19 KB on the first Library visit, 0 on every revisit), the
entry 186 → 173 KB brotli, `search_books` 52–114 ms → 4–17 ms at 15,000 Books, a 2,000-book import
12.6 s → 0.76 s. What is left is small (S–M) and measurable, and three of its items are new findings of this
round: **the sign-in wall's covers are the LCP in production (5.6 s on a Pixel 7 profile, 2.2 s without them)**,
**the first screen now pulls 93 files / 330 KB before Home shows (was 76 / 247 KB), which makes a cold start
150 ms slower than the baseline in a same-hour A/B**, and the search CLS 0.42 is still there, now narrowed.
What no number here can say is how a real phone feels: the Android/iOS session (section 7) has never been run.

**The one next thing:** one small PR for the sign-in wall (no covers before the form is painted, fewer of
them) plus `preconnect` to the cover and API origins. Measured upper bound in production: LCP 5,568 → 2,196 ms,
1,061 → 342 KB before the form (section 5, #1). Then run the device session of section 7 to decide whether
anything below #6 is worth building.

### Headline numbers (before → now)

| | before | now |
| --- | ---: | ---: |
| Tab switch Home → Library, requests / KB (first visit) | 40 / 111 | 37 / 19 |
| Profile ⇄ Library revisit, API requests | 2–4 | **0** |
| Entry bundle, brotli | 186.5 KB | 173.4 KB |
| Service worker precache download | 739 KB | 684 KB |
| Cold start, long-frame time (4x, Slow 4G) | 1,210 ms | 737 ms |
| Cold start, Home shown (4x, Slow 4G) | 2,835 ms | **2,978–2,993 ms (+5 %)** |
| Warm start, Home shown | 361 ms | 344 ms |
| `search_books` at 15,000 Books (EXPLAIN as a member) | 52–114 ms | 3.8–16.8 ms |
| Goodreads import, 600 / 2,000 books | 1.3 s / 12.6 s | 0.24 s / 0.76 s |
| 20 members open Home at once (2 CPUs, p50) | 771 ms | 488–580 ms |
| Search typing CLS (4x, Slow 4G) | 0.42 | **0.42** |
| Sign-in LCP in production (Pixel 7, 4x, Slow 4G) | not measured | **5,568 ms** (P) |

## 1. Method and conditions

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, shared with a security worker, a picker prototype and the social worker. `uptime` before every series; load average at the start of each is in the result files and below. A series that would have started above 6 waited |
| Browsers | Chromium 153.0.8010.12, WebKit 26.6 (Playwright 1.63), headless; Lighthouse 13.5.0 on the same Chromium |
| App | the production build of v1.9.1 (`nuxt generate`, Pages `_headers`), `perf/serve.mjs` on port 3102 (HTTP/2, brotli); the baseline for the same-hour A/B is `git archive a9a91c89` built the same way |
| Backend | a throwaway Supabase stack of my own (`libellus-perf-final`, ports 55770–55779, Social V1.1's migrations included: they are in `supabase/migrations`), stopped with `supabase stop --no-backup` at the end; no other stack was touched. `docker update --cpus=2` on the database and PostgREST for the 2-CPU runs |
| Data | client: the production-size member of `client-1-startup.md` §1 (150 entries, 2,300 Books; 1,000 entries for the long-list rows). Backend: S0 118 entries / 400 Books, S1 30 members / 2,500 Books, S2 300 members / 15,000 Books and a 1,000-entry member |
| Runs | ≥ 5 per series, medians; `~` marks a spread above 15 %. The slow4g-4x series ran twice (load 3.3 and 3.6 at the start) |
| Load at the start of the series | client suite 3.3 / 2.4 / 2.1 / 2.1 (slow4g-4x, 6x, chromium, webkit), 3.6 (4x again); A/B 1.4–2.2; `perf:list` 5.5 and 6.0 (see the caveat there); backend 4.2–6.0; load test 4.2 and 5.5 (the 2-CPU Home runs 7.5–9.3: the first Home x20 number is flagged); production smoke 1.0–4.5 |
| Not done | no GitHub Actions run, no production write, no sign-in, no credential; the production smoke is one logged-out page |

Same-hour check of the harness itself: the build of the first baseline (a9a91c89) measured today gives
cold 2,842 / 2,835 ms, warm 341 / 342 ms, 179 requests, 449 KB, long frames 1,203 ms: the numbers
`client-1-startup.md` printed (2,835 / 361 / 179 / 466 / 1,210). The harness reproduces itself across days, so
the before column below may be read as is.

## 2. Client benchmark

`pnpm perf` (journeys start, tabs, book, search, profile, revisit), slow4g-4x twice, slow4g-6x, chromium and
webkit, 5 runs each: `data/final/client/report-final-*.md`, medians per step in `data/final/client/final-*.json`.

### 2.1 Before → now

Before = `client-1-startup.md` (a9a91c89) and its later sections; now = v1.9.1. slow4g-4x unless stated.
"A/B" = the same-hour comparison of a9a91c89 and v1.9.1 over 10 runs each (`data/final/client/ab-summary.md`).

| Measure | before | now | A/B (a9a91c89 → v1.9.1) |
| --- | --- | --- | --- |
| **Cold start**: Home shown | 2,835 ms | 2,978 / 2,993 ms | 2,838 → 2,986 |
| Cold LCP (the element is the first cover since #254's F-12; before it was the film grain) | 3,752 ms | 3,708 / 3,716 ms | 3,664 → 3,724 |
| Cold long animation frames (n, total, worst) | 3, 1,210 ms, 1,009 ms | 3, 737 / 723 ms, 529 ms | 1,199 → 718 ms |
| Cold requests / KB seen by the page | 179 / 466 | 170 / 434 | 179 → 170, 449 → 434 |
| JS+CSS files requested before Home shows (files / KB br) | — | 93 / 330 | **76 / 247 → 93 / 330** |
| `domInteractive` / `DOMContentLoaded` | — | 714 / 1,343 ms | 1,190 → 712, 2,015 → 1,343 |
| **Warm start**: Home shown | 361 ms | 344 / 343 ms | 342 → 334 |
| Warm LCP (the cover now) | 376 ms | 648 / 636 ms | 356 → 644 |
| Warm long frames | 2, 219 ms | 2, 216 ms | 163 → 213 |
| Warm requests / KB | 171 / 93 | 152 / 34 | 171 / 93 → 152 / 34 |
| **Tab switches**, ready / long frame / TBT | | | |
| Home → Library (b1) | 217 / 118 / 57 ms | 192 / 91 / 32 ms | 207 / 110 / 50 → 190 / 90 / 31 |
| Library → Profile (b3) | 200 / 208 / 66 ms | 216 / 217 / 83 ms | 195 / 192 / 58 → 194 / 196 / 66 |
| Profile → Home (b4) | 139 / 0 / 0 ms | 135 / 0 / 0 ms | 132 → 135 |
| Library → Book → back (c1, c2) | 155 / 117 ms | 142 / 106 ms | |
| the same at CPU 6x: b1, b3, b4 | 317 / 201, 284 / 328, ~174 / 64 | 262 / 139, 270 / 309, 159 / 0 | |
| **Search typing "piranesi"**: ready / CLS / TBT | 1,569 ms / 0.42 / 13 | 1,570 / **0.42** / 13 | |
| Style recalculation while typing (CDP) / long frame | 172 ms (F-3) / ~121 ms | 162 / 151 ms / 75 ms | |
| **Library mount, 150 entries** (`perf:list`): longest frame / nodes | 97 ms / 705 | 104 ms / 708 | |
| Library → Finished segment (99 rows): longest frame / nodes | 141 ms / 3,959 | 146 ms / 3,962 | |
| **Library mount, 1,000 entries**: longest frame | 285 ms | 283 ms | |
| Finished segment, 677 rows: longest frame / nodes | 748 ms / 26,609 | 748 ms / 26,612 | |
| Search "the", 1,000 entries (own Books unbounded): frame / nodes | 999 ms / 40,850 | 949 ms / 40,854 | |
| **First-install download** (service worker precache) | 739 KB, 196 files | **684 KB**, 225 files (JS 450, CSS 28, fonts 163, icons 42) | |
| **Entry bundle** (`index.html` closure) raw / gzip / brotli | 675.5 / 213.5 / 186.5 KB | 613.3 / 197.4 / **173.4 KB** | |
| Prefetch links on every start | 45 files, 81 KB | 0 | |
| **Sign-in transfer** until the form shows (`perf:signin`) | 79 files, 298.8 KB, 2,989 ms (bundle.md, before F1) | 22 files, 217.7 KB, 1,995 ms | |
| **Image requests per screen** (`perf:images`, covers / KB) | Home 8 / 296, Library 28 / 301, sign-in wall 20 / 2,319 | Home 8 / 296, Library 28 / 301, wall 20 / 737, Book 1 / 117, search "piranesi" 25 / 411 | unchanged since #263 |
| **Requests per tab switch**, all / API KB | b1 40 / 111, b3 26 / 65, b4 5 / 93 | b1 37 / 19, b3 25 / 16, b4 2 / 0.2 | |
| Revisits inside the 60 s window (f3, f4, f5) | 2–4 API requests, 16–22 KB | **0** | |
| **DOM nodes over a session**: warm, Library, Profile, Book, search | 514 / 1,542 / 2,855 / 3,312 / 4,631 | 538 / 1,573 / 3,042 / 3,501 / 4,759 | |
| Heap, search step | 16.8 MB | 17.3 MB | |
| Unthrottled Chromium: cold / warm | 89 / 89 ms | 93 / 85 ms | |
| WebKit (desktop, no throttling): cold / warm | ~132 / 123 ms | ~136 / 127 ms | |

Reading it:

- **The tab switches did what #255 and #260 promised**: the three Library lists (350 KB JSON, 111 KB brotli) are
  not asked on a switch, nothing is asked on a revisit (f3–f5: 0 requests, 0 long frames at 4x), b1's long frame
  fell 118 → 91 ms. The first visit of a Profile is unchanged (b3 217 ms of long frame: `Response.text.then`
  112 ms, the parse of the sessions JSON, and `ViewTransitionCallback` 73 ms; e1 127 ms, the same callback
  108 ms): client-1's F-8 was never worked on.
- **The cold start did not get faster, it got 5 % slower.** The entry shrank by 13 KB brotli and the
  boot's long frames fell by 40 % (`domInteractive` 1,190 → 712 ms), but the files the first screen needs before
  Home is drawn grew from 76 files / 247 KB to 93 files / 330 KB brotli: Home gained its social sections (the
  Circle, the feed and the follows' chunks, three more requests), the Book page its author section, and the
  seven sheets and the search overlay are still mounted by `layouts/tabs.vue` on every page (client-1's F-13,
  never done). At the harness's own rule (20 KB brotli ≈ 100 ms) the 83 KB are the 150 ms. The A/B is the
  evidence (10 runs each, load 1.4–2.3, spread 1 %): the cold start is a **feature cost**, not a regression
  of a fix, but nothing shipped since the baseline has bought it back.
- **Warm LCP 356 → 644 ms is the F-12 measurement change** (the LCP element is a cover now), not a slowdown:
  Home shown is 342 → 334 ms.
- **Search CLS is 0.42 in every slow run, and unchanged** (section 5, #4 has what was learned this round).
- **The long lists are as measured in client-1 §11** (nothing in the Library's rendering changed): 99 rows = a
  146 ms frame, 677 rows 748 ms. `perf:list` ran at a load of 5.5 and 6.0; every cell agrees with the earlier
  series within 5–10 %, which says the load did not move them.
- **WebKit**: the harness reaches the API only partly (the routed hosts do not resolve in Playwright's WebKit):
  the search step (d2) and the Library → Profile steps after it (f2, f4) did not complete (0/5), as before. A
  clean sequence (Home → Profile → Home → Library → Profile, no search before) renders the Profile figures;
  after the search step's failed answer the app counts itself offline and the Profile shows none. A harness
  limit, not a finding; WebKit's numbers are the engine's floor.

Slow4g-6x, chromium and webkit tables: `data/final/client/report-final-6x.md`, `-chromium.md`, `-webkit.md`.

### 2.2 The cover flight, 30 round-trips

`LIBELLUS_E2E_PERF=1 playwright test e2e/perf --repeat-each N --workers 1` (Chromium, 412 × 915, CPU 4x, 30
rounds per run; `data/final/client/soak-summary.txt` and `soak-slow-summary.txt`).
Local stack answers (5 runs), then the slow connection with 400 finished Books (`FLIGHT_NET=slow
FLIGHT_FINISHED=400`, 3 runs: the case that piled up reads before #252). Rounds 2–11 against the last ten:

| | before (MOTION.md, 5 runs) | now, local | now, slow network, 400 Books |
| --- | --- | --- | --- |
| push: tap → first frame / flight | 48 [48–64] / 300 ms | 47 [47–47.5] → 47 [47–49] / 300 | 48 → 47 / 300 → 291 |
| Back: flight | 250 → 250 ms | 233 → 233 | 250 → 233 |
| frames dropped (10 flights, push + pop) | 0–4 | 2 [2–4] → 2 [0–3] + 0 | 2 → 1 (60 flights: 4–9) |
| long-frame ms in all rounds | — (none after round 1) | 0 after round 1 (68–75 in round 1) | 67–69 |
| left behind (elements, animations) | 0 | **0**, 0 | **0**, 0 |
| elements / all DOM nodes / listeners | 347 / 886 / 215 | 379 / 919 / 212, flat | 739 / 1,279 / 212, flat |
| JS heap | 10 → 11 MB | 10.2 → 11.1 MB (0.06 MB a round) | 11 → 11.8 MB |
| stack requests on their way at a tap, most | 55–56 (before #252), 3–4 after | **0** | **1** |
| requests failed / rounds that asked nothing | 22–25 / 7–8 before, 0 / 0 after | 0 / 0 | **0 / 0** |

**The flight does not wear and the reads no longer pile up.** The numbers that moved are the larger Home (more
elements and nodes: the social sections), not the flight. Frames dropped in the slow run (4–9 over 60
flights, 2–4 in client-1's table) are inside what a load of 4–6 does to a Chromium on this Mac; the push's
tap-to-first-frame is the same 47–48 ms.

## 3. Backend benchmark

`scripts/perf` unchanged, driven by `data/final/backend.sh` (the same steps as `measure.sh`, with this stack's
container and an `ANALYZE` after the seed, which the first run of today needed: right after the seed some
plans are not the ones a real database picks, and `book_genres` and `my_works` read 2–3x slower; after
`ANALYZE` they are the numbers of 9 October to within noise). The before column is the raw files of 9 October
(`/tmp/perf-results/`, same Mac, same scripts), which agree with the numbers `backend.md` prints.
Every file: `data/final/backend/`.

### 3.1 SQL as a member (EXPLAIN ANALYZE, best of 5 warm, ms)

| | S0 before → now | S1 before → now | **S2 (15,000 Books)** before → now | S2 heavy (1,000 entries) before → now |
| --- | ---: | ---: | ---: | ---: |
| `search_books('book title 1')` | 3.95 → 2.07 | 14.8 → 3.1 | **79.4 → 10.0** | 83.0 → 9.8 |
| `search_books('author 7 lastname')` | 3.23 → 2.04 | 10.9 → 2.8 | **52.0 → 3.8** | 54.9 → 3.8 |
| `search_books('bo')` | 4.85 → 2.20 | 21.0 → 3.7 | **114.1 → 16.8** | 119.6 → 16.6 |
| Library list, finished / want to read | 4.4 / 1.5 → 4.2 / 1.4 | 3.4 / 1.3 → 3.4 / 1.3 | 3.6 / 1.9 → 3.6 / 1.8 | 19.9 / 7.2 → 19.6 / 6.8 |
| `started_series` + `muted_series_list` | 6.2 + 4.8 → 5.9 + 4.8 | 6.6 + 5.6 → 7.2 + 5.7 | 7.9 + 5.7 → 7.9 + 5.9 | 24.6 + 20.5 → 22.7 + 19.1 |
| `readInYear` count (F3, not touched) | 0.09 → 0.08 | 0.63 → 0.62 | **6.0 → 7.4**, 30,549 buffers | 6.9 → 6.5, 30,560 buffers |
| Profile sessions / progress days / "since" | 2.3 / 0.2 / 0.1 → 2.1 / 0.2 / 0.1 | | 2.1 / 2.4 / 1.9 → 2.0 / 1.8 / 1.9 | 10.2 / 3.1 / 2.9 → 9.9 / 3.0 / 2.8 |
| `library_genres`, `book_authors_of`, `book_genres` | 1.3 / 0.8 / 1.0 → 1.3 / 0.8 / 0.9 | | 1.9 / 0.8 / 1.0 → 1.8 / 0.8 / 1.0 | 4.8 / 0.8 / 1.0 → 4.6 / 0.8 / 0.9 |
| `author_page`, `series_works`, `next_in_series` | 5.4 / 2.6 / 3.6 → 5.2 / 2.6 / 3.6 | | 5.7 / 2.9 / 8.6 → 5.7 / 2.7 / 8.5 | 5.6 / 2.9 / 14.0 → 5.5 / 2.7 / 13.6 |

PRs #249 and #238 are where the table moves (search 52–114 ms → 3.8–16.8 ms, the GIN index is used and the
definer function reads `private.book_search`; at S0 the search is also ~2x faster). Everything else is the same
to within the noise of a machine at load 4–6, which is the right answer: nothing else was meant to change.
`readInYear` is the one that stays linear in the table (F3: 30.5k buffers at 36,685 sessions).

### 3.2 Screens through PostgREST (30 rounds, p50 / p95 ms; 1 member, S2; requests as v1.9.1 asks them)

| Screen | before | now | payload before → now (raw / gzip KB, synthetic seed) |
| --- | ---: | ---: | --- |
| Home (5 parallel requests, was 6) | 7.9 / 9.9 | 6.8 / 9.1 | 304 / 24.3 → **192 / 22.7** (lists without `description`) |
| Library | 6.2 / 7.7 | 5.3 / 6.7 | same lists + genres |
| Profile | 13.3 / 16.3 | 11.9 / 17.2 | sessions 186 / 14.8 → **107 / 13.5**, days 89 / 2.6 → 53 / 2.2 |
| Book / Author / Series | 3.1 / 4.0 / 1.7 | 2.8 / 3.9 / 1.6 | |
| **Search**, 3 queries in parallel (slowest) | **121.2 / 127.4** | **16.5 / 19.5** | |
| Home, 1,000-entry member | 30.0 / 35.7 | 24.8 / 27.7 | 1,954 / 141 → **1,238 / 132** |

The raw JSON of Home fell 37 % (the descriptions), the gzipped body only 6 %: the synthetic descriptions are
repetitive text, which compresses far better than production's (`backend.md`: 65 % of a Book's JSON, 1,226
characters on average), so the real saving on the wire is larger than this seed shows and the saving in
PostgREST's serialising and the phone's parsing is the raw one.

### 3.3 Import, writes, social

| | before | now |
| --- | ---: | ---: |
| `import_books` 600 books (6 calls), S2 | 1,280–1,341 ms (225–232 after #238) | **228–247 ms** (3 runs) |
| `import_books` 2,000 books (20 calls) | 12.4–12.7 s (728–754 ms after #238) | **755–760 ms**, every call 36–38 ms flat |
| `sync_write`: `update_progress` / `add_to_library` / start + finish | 0.17 / 0.22 / 0.31 ms (social: 0.29 / 0.50) | 0.17 / 0.31 / 0.65 ms |
| `feed(30)` p50 / p95 at 200 follows | 18.0 / 19.5 ms | 17.0 / 18.3 ms |
| `my_people()` p50 / p95 at 200 + 200 | **37.5 / 38.6 ms** | **6.1 / 6.6 ms** (N2: V1.1) |
| `member_profile`, `member_reading_record`, `member_want` | 2.1, 2.2, 1.7 | 2.5, 3.2, 2.0 |

The import's write cost (+8 % at 2,000 books claimed in #249) reads +4 % here (728 → 756 ms): the trigger that
keeps `private.book_search` costs ~25 µs a new Book and is invisible next to the flat 37 ms a call. The write
numbers drift up by 0.1–0.3 ms between the socials' triggers and this run's load; none matters.

### 3.4 The production factor

The method of `backend.md` ("Production readings"): ×2.5 an idle instance, ×4–9 the typical mean, ×15–30 a slow
run. Applied to this run:

| | local now | ×2.5 | ×9 | ×29 (a slow run) | limit |
| --- | ---: | ---: | ---: | ---: | --- |
| `search_books('bo')`, 15,000 Books | 16.8 ms | 42 ms | 151 ms | 0.49 s | (was 0.29 s / 1.0 s / 3.3 s) |
| `search_books('author 7 lastname')` | 3.8 ms | 10 ms | 34 ms | 0.11 s | |
| worst call of a 600-book import | ~40 ms | 0.10 s | 0.36 s | 1.2 s | **8 s** `authenticated` timeout (was 1.2–1.7 s / 4.4–6.1 s / x15 times out) |
| 2,000-book import, worst call | 38 ms | 0.1 s | 0.34 s | 1.1 s | 8 s: no longer reachable at any factor below ×200 |
| Home, 1 member (5 requests, parallel) | 6.8 ms | 17 ms | 61 ms | | |
| 20 members open Home at once, 2 CPUs, p50 / p95 | 488–580 / 775–785 ms | 1.2–1.5 / 1.9–2.0 s | 4.4–5.2 / 7.0 s | | before: 771 / 998 ms local = 1.9 / 2.5 s and 6.9 / 9.0 s |
| the same with Social's `feed` + `my_people` on Home | 1,094–1,181 / 1,390–1,444 ms | 2.7–3.0 / 3.5–3.6 s | 9.8–10.6 / 12.5–13.0 s | | unconstrained: 360 / 423 → 233 / 268 ms |

An instant burst of 20 members is beyond a realistic peak (5–10 at once); the 5-member closed loop below is
16 ms p50 / 85 ms p95 local. The only row that gets worse than the first assessment is the 2-CPU Home with
Social (not measured then): the feed's 17 ms of database time × 20 on two CPUs.

### 3.5 Load test: five hottest endpoints, 20 concurrent members, 2 CPUs

`data/final/loadtest.mjs`: closed loop (no think time), each member its own JWT, 8 s per level, S2 data,
database and PostgREST limited to 2 CPUs each (`docker update --cpus=2`, as in `backend.md`), load average 4.2
at the start, rising to 8.5 at the end (the 40-member rows ran last and are the least reliable).
The five: the **finished list** (1,000-row page with embeds), **`readInYear`** (the most called statement in
production: 533 calls in 4.5 days), **`started_and_muted_series`**, **`search_books`**, the **Profile's sessions**;
`feed` as a sixth because Home now asks for it. Requests per second (member count in the header), then p50 / p95 ms at 20 members:

| endpoint | 1 | 5 | 10 | **20** | 40 | p50 / p95 at 20 | CPU at 20 (db / PostgREST) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| finished list | 199 | **575** | 534 | 481 | 175 | 19 / 90 | 206 % / 117 % |
| `readInYear` | 314 | **923** | 861 | 753 | 169 | 11 / 80 | 196 % / 200 % |
| `started_and_muted_series` | 178 | **390** | 336 | 322 | 131 | 82 / 103 | 206 % / 118 % |
| `search_books` (6 queries) | 191 | **376** | 220 | 215 | 151 | 92 / 207 | 201 % / 80 % |
| Profile sessions | 83 | **151** | 130 | 139 | 127 | 110 / 286 | 196 % / 66 % |
| `feed(30)` | 55 | 89 | 70 | 69 | 73 | 283 / 512 | 198 % / 30 % |
| **Home as the app asks it** (5 requests) | 154 | 135 | 51 | **29–36 Homes/s** | | 495–598 / 1,209–1,401 | 42–98 % / 195–211 % |

**Where it saturates.** (1) The database's two CPUs are full from **5 concurrent members** on every endpoint
(200 % in `docker stats`); past that, throughput only falls and latency is queueing: at 20 members the p50 is
4x (finished list, `readInYear`) to 46x (search) what one member sees. (2) **PostgREST itself is the next wall**:
from 10 members on the Home mix, from 40 on the single endpoints, its container sits at 195–210 % while Postgres
drops to 40–77 %, so the JSON it builds, not the queries, is what is busy; the 40-member rows fall to 73–175
req/s (a pool of 10 connections plus the load generator on the same Mac: the cliff is real, its exact place is not).
(3) The cheap endpoints (`readInYear`, the finished list at 481/s) are fine to ~20 members; the dear ones
(`feed` 69/s, Profile 139/s, search 215/s at 20) saturate first. In production terms: a Home costs 60–225 ms of
database time on a Micro (`backend.md`), so 10–30 Homes a second would fill its two vCPUs, against ~0.002 per member
per second in production (720 Home activations in 4.5 days, before the 60 s gating): 300 members are comfortable,
a retreat-wide moment of 20 simultaneous Homes is a 1–5 s wait that the 8 s limit absorbs. Nothing here needs
doing now (section 5 has the order if it ever does).

## 4. Production smoke, logged out

`data/final/prod-smoke.mjs`, https://libellus.fabkho.dev, **no sign-in, nothing written**. Production moved from
v1.9.1 to **v1.9.2** (security fixes, no performance change; entry chunk `RpCK9Yrt` → `CyfolQEy`) during the
session: the Chromium table, the blocked-covers experiment, WebKit and Lighthouse below are all on v1.9.2;
an earlier set on v1.9.1 agrees within 1–2 % (cold 2,527 ms, LCP 5,584 ms, Lighthouse 71–75).
Chromium: Playwright's **Pixel 7** (412 × 915), CPU 4x, Slow 4G (1.6 Mbit/s, 150 ms, CDP), 5 runs, a fresh
context each, load 1.0–2.2 at the start. WebKit: **iPhone 14**, no throttling (none exists), load 2.6.
The page is `/` → `/sign-in`; "shown" is `signIn.title` visible.

| | Chromium Pixel 7, 4x, Slow 4G | WebKit iPhone 14 |
| --- | --- | --- |
| **Cold**: form shown | 2,525 ms (2,511–2,601) | 273 ms |
| FCP / **LCP** | 2,196 / **5,568 ms** | 258 / 368 ms |
| CLS | 0.0007 | 0 |
| requests / transfer | 64 / **1,061 KB** (own host 35 requests, 331 KB; covers + Cloudflare analytics the rest) | 63 / 1,084 KB |
| long animation frames | 2: **672 ms** (no script attribution: the entry's parse and compile, as client-1 §3.1 reads it) + 91 ms (`CyfolQEy.js` resolve-promise 56 ms) | none (WebKit reports none) |
| **Second visit**, service worker in control: shown / LCP | 143–146 / 136 ms (3 runs); 463–473 ms in the 2 runs where the worker was not yet in control 9 s after the first load (HTTP cache only) | 54–69 ms in 2 runs, **1,086–1,101 ms in 3 of 5** |
| requests / answered by the worker / on the wire | 62 / 55 / 6 (0.8 KB) | 64 / 56 / 8 (10 KB) |
| long frames, second visit | none with the worker (58–60 ms without) | none |
| **Offline reload of the shell** (`setOffline`, service worker active) | **ok**, 116–120 ms (268 ms without the worker: the HTTP cache) | not testable: Playwright's WebKit refuses every navigation while offline ("WebKit encountered an internal error"), as `e2e/offline.spec.ts` notes |

**Headers** (`curl` with `accept-encoding: br`, `data/final/prod-headers.txt`): HTML `cache-control: public,
max-age=0, must-revalidate`, brotli (1.6 KB on the wire, 90 ms); hashed `/_nuxt/*.js|css` `public,
max-age=31536000, immutable`, brotli, `cf-cache-status: HIT` (entry 54 KB, CSS 11 KB); fonts the same;
`sw.js` and `manifest.webmanifest` `no-cache`; `alt-svc: h3` advertised, so HTTP/3 is on; the covers come from
`is1-ssl.mzstatic.com` with `max-age` ~6 months. The Cloudflare analytics beacon adds two requests and ~10 KB
on every first visit. `robots.txt` answered the app shell as `text/html` on v1.9.1 (Lighthouse "robots.txt is
not valid"); v1.9.2 serves a `text/plain` file.

**What the covers cost: the experiment.** Same page, same profile, with `is1-ssl.mzstatic.com` blocked (the 20
covers of the sign-in wall, `route.abort`, 5 runs): **LCP 5,568 → 2,196 ms, transfer 1,061 → 342 KB, requests
64 → 46; the form is shown at the same 2,528 ms.** The LCP element is `img[src*=240x360bb.jpg]` in the wall
(`main > div.wall > span.spine > img.cover`); with the covers gone it is the brand text. The wall is
decoration; the form does not wait for it, but the LCP and the Vitals do.

### Lighthouse (mobile, 3 runs, median; `npx lighthouse`, 13.5.0, load 2.0–2.6)

| Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Speed Index | TTI |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **72** (70, 72, 75) | 100 | 100 | **91** | 3.3 s | **5.7 s** (5.1–5.9) | 15 ms | 0.001 | 3.3 s | 5.9 s |

The first set (v1.9.1) read 73 / 100 / 100 / **82**: the 9-point SEO difference is the `robots.txt` that v1.9.2
fixed. What Lighthouse says is left, all on the sign-in wall and the entry: the **LCP is a wall cover that is not
discoverable in the initial HTML** and has no `fetchpriority`; **image delivery: 670 KiB** estimated saving (the
20 covers are 240 × 360 JPEGs in boxes of 100 × 134 CSS px); **render-blocking `entry.css` (12 KB): 340 ms**;
unused JS 84 KiB; **no meta description** (SEO 91); a preconnect candidate: `is1-ssl.mzstatic.com`, **175 ms** of LCP.
Performance 72 is the wall's LCP; the experiment above is the measured version of what removing it does.

Screenshots (`.shots/`, `/tmp/perf-final/`): `prod-chromium-signin-cold.png`, `prod-webkit-signin-cold.png`,
`prod-chromium-offline.png`, `search-results-4x.png`.

## 5. What could still be improved

Everything open, ranked by impact × effort. Impact is for a member (or for the Vitals score), not for the
benchmark. **Conflicts** name in-flight work: *social V2a* edits Home, Profile, the Book page and the feeds;
*the picker prototype* touches the Library header and the Book page behind a flag.

| # | Item | Evidence | Proposed change | Expected saving | Effort · model | Conflicts |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **The sign-in wall's covers are the sign-in LCP** (new finding) | **P**: Pixel 7 profile LCP 5,568 ms vs 2,196 with the covers blocked; 1,061 → 342 KB; Lighthouse performance 72, LCP not discoverable, image delivery 670 KiB. Plausibly also the field's `LCP 6.4 s on /` (the sign-in is where a signed-out `/` lands; to be read in the Errors rows) | Start the wall's covers after the form has painted (a `requestIdleCallback` / `load`-gated `v-if`, or `loading=lazy` + `fetchpriority=low` on all 20) and only the first two rows on a phone; optionally `md` 160 × 240 for DPR ≤ 2 | LCP **−3.4 s (−61 %)**, −720 KB before the form; Lighthouse performance ~72 → ~90 (an estimate). Signed-in members: none (first launch and sign-out only) | S · Sonnet (DeepSeek can do it) | none: `AuthFrame`/the wall is in neither in-flight change |
| **2** | `preconnect` to the cover and the API origins | **P**: Lighthouse "preconnect candidate" `is1-ssl.mzstatic.com` 175 ms of LCP, nothing preconnected. **C**: the API origin has none either (client-1 F-9; CDP cannot charge connection setup, so it was never priced) | `app.head` `<link rel=preconnect>` for `is1-ssl.mzstatic.com` and `*.supabase.co` (+ `crossorigin` for the API) | ~175 ms of cover LCP; the API's DNS+TCP+TLS (≈ 3 RTT, 300–450 ms on cellular) off the first data request. Needs a real network to price | S · DeepSeek | none; ship with #1 |
| **3** | **Her own Books in search are unbounded** | **L**: "the" at 1,000 entries: 677 rows, 40,854 DOM nodes, a **949 ms** frame, 7 long frames; at 150 entries 99 rows, 150 ms | Bound the "In your Library" group (the 20 best, then a "Show all n" row): a product call (SPEC/owner), then Results.vue | the 1,000-entry frame ~950 ms → ~100 ms, nodes 40k → ~4k; at 150 entries 150 → ~60 ms | S–M · Sonnet; the owner decides the UX | none (search overlay and its results are in neither in-flight change) |
| **4** | **Search CLS 0.42** (still undiagnosed, now narrowed) | **L**, new this round: `data/final/search-cls.ts`. The shift is **one** layout shift of 5 result `li`s (previous rect `0,0,0,0`, i.e. rows that were not laid out before) that lands **≈ 470 ms after the rows were inserted** and 1 s after the last key; **0 unthrottled**, 0.35–0.42 at 4x (0.35 in this script, 0.42 in the harness), 0.42 at 6x, **0.49 with Reduce Motion** — so it is not the motion; it needs CPU and network slowness; the palette's `--palette-gap` is already 0 px then. Field Vitals rows (`CLS … on /`, largest shift `search.overlay`) would confirm | Take the trace of that frame (`pnpm perf --journey search --trace`, the `LayoutShift` event's impacted nodes and the style/layout invalidation just before it); candidates: rows revealed by a late state change (`useNearView`, the `arriving` flag, a second batch of rows), then reserve their box | CLS 0.42 → < 0.05; removes a Vitals "poor" on every page that has the palette | M · Opus to diagnose (a trace), Sonnet to fix | none |
| **5** | **First screen's JS: 93 files / 330 KB before Home shows** (the cold start is +150 ms vs baseline) | **L** (A/B, 10 runs each) + **C**: `layouts/tabs.vue:76–83` mounts `BookAddSheet`, `BookManualSheet`, `BookStartSheet`, `BookFinishSheet`, `BookProgressSheet`, `BookAbandonSheet`, `ShellWhatsNewSheet` and the search overlay on every page; client-1 F-13 | `Lazy` + mount-on-first-open for the seven sheets (and the overlay's results), keeping the open animation from a mounted closed state | by the harness's rule (20 KB br ≈ 100 ms) **−30–60 KB, −150–300 ms** cold, fewer nodes at first paint; to be measured with the A/B scripts | M · Sonnet | the layout is neither in V2a nor the picker's named files; the **Add sheet** may be the picker's (ask) |
| **6** | `readInYear` / `reading_progress_days` scan the whole table through the policy (F3) | **L** + P shape: 6.0–7.4 ms and **30,549 buffers** at 36,685 sessions, growing with the table; production: the most-called statement (533 calls in 4.5 days, 1.5 ms mean at 80 rows); 753 req/s peak, PostgREST and Postgres both at 200 % at 20 members | `read_in_year(p_year)` (invoker, starts from her entries) as in `proposals.sql`: 6.7 ms / 30,581 buffers → 0.57 ms / 585; the same for the Profile's days | 10x on the statement that runs on every Home; stays flat as the table grows (300k sessions: ~50 ms locally, 0.12–0.45 s there) | S–M · Sonnet (+ pgTAP "A's count excludes B's reads") | one line in Home's year-count call (data layer, not the page): low |
| **7** | **Profile's first open: the long frame** (client-1 F-8, never worked on) | **L**: b3 213–217 ms of long frame (`Response.text.then` 112 ms = the sessions JSON, 107 KB raw; `ViewTransitionCallback` 73 ms), e1 127 ms, TBT 57–83 ms; 6x: 309 / 190 ms | measure before the first frame in `plugins/profile-transition.client.ts` less eagerly; page the sessions (or a `profile_record` RPC returning figures, not 119 sessions with a Book each) | −100–200 ms of long frame on the first Profile visit | M · Opus (transition + data shape) | **high with V2a** (Profile): do it after V2a lands |
| **8** | Fonts in the precache: 163 KB of 684 KB (24 %) | **L** + `perf:bundle`: 10 woff2 files precached on install; Home requests 6 of them (Geist 300/400/500, Mono 400/500, Newsreader 500: 81 KB); Geist 600 and Newsreader italic/400/600 (82 KB) are for other screens | precache the 6, runtime-cache the other 4 | first install −82 KB (−12 %); no first-paint effect | S · DeepSeek | none; offline first launch shows a fallback face for the uncached faces: owner's call |
| **9** | **Library: the Finished segment frame and windowing** (the 141 ms frame; 267–748 ms at 1,000 entries) | **L**: 99 rows = 146 ms frame, 3,962 nodes; 677 rows = 748 ms, 26,612 nodes; scroll janky at 1,000 (183 frames > 50 ms). `content-visibility` helps style/layout but breaks the cover flight and scroll restoration (tried, not shipped) | a windowed list (`useWindowVirtualList`, 77 px rows, year headers as items) with `flight-check.ts` as the gate; or mount the Finished rows in two steps (first screenful, the rest idle) as the cheap try | Library mount/segment switch constant at the ~100 ms floor; nodes ~1,000. At 150 entries the gain is 40 ms once per segment switch | L · Opus (M for the two-step try, Sonnet) | **moderate with the picker** (the Library page/header): sequence after it; build when field LoAF rows on `/library` appear or a member passes ~500 entries |
| **10** | The messages file waterfall (bundle F7) | **C** + bundle.md: `BJDnPcHj` (15.9 KB br) is a dynamic import from the entry, no preload; it is one of the 93 files; Lighthouse's dependency tree stops at CSS and fonts (the JS is below its radar) | the module's preload option, or a `modulepreload` link built at generate time | one RTT (≈ 150 ms) on the first paint, cold and sign-in | S–M · Sonnet | none |
| **11** | SEO meta | **P**: Lighthouse SEO 91, "no meta description" | `useSeoMeta` description (the robots.txt part is done in v1.9.2) | SEO 91 → 100; nothing for a member | S · DeepSeek | none |
| **12** | PostgREST is the second wall at ≥ 10 concurrent members | **L**: load test: PostgREST 195–210 % while Postgres 40–77 % on the Home mix and the finished list | slimmer lists (the Library's three reads carry `latest_session(*)` and a Goodreads embed per row; select the columns the rows show), measured with `loadtest.mjs --mix` | the Home mix's ceiling ~29–36 → higher; today irrelevant below ~20 simultaneous members | M · Sonnet | V2a (Home reads) in the stores |
| **13** | `started_and_muted_series` is 6–8 ms (23 ms heavy) on every Home | **L**; **P** 55 ms mean for `started_series` (21 calls, `backend.md`) at 185 Books | re-extract production's statistics first (read-only) and look at the chain (`started_series_core`, 6,300 buffers at S2) | unknown until measured in production | M · Sonnet | none (SQL only) |
| **14** | `home()` RPC | **C** + **L**: a warm start asks the API **9 times** (3 lists, the reading days, the series, the feed, `my_people`, `my_social`, accounts); 14 preflights on a cold start | one RPC returning the lists, the series, the count and the feed | 9 requests → 1, ~8 fewer preflights (WebKit repeats them per URL every 10 min), ~100–200 ms on the cold data path at Slow 4G; no server saving | L · Opus | **high with V2a** (Home, feeds): not now |
| **15** | Route chunks in the precache (450 KB of JS) | **C** + `perf:bundle`: all 137 JS files precached | runtime-cache the rarely used routes (Collections, Friends' blocked page, import) like the reader | first install −100–200 KB | S–M · Sonnet | none; **owner**: it trades the offline guarantee for first-use-online |
| **16** | Server change stamp | decided in client-1 §9.3: saves bytes, not time, and needs six triggers | revisit at ~1,000 entries (330 KB per post-window visit) or for a native client | ~70 KB per pair of visits at 150 entries | M–L · Opus | none |

### Not worth doing (and why)

- **`<i18n-t>` / `fullInstall: false`**: 1.2 KB brotli (≈ 6 ms), needs two components imported by hand, one of them
  (`home/CircleFriend.vue`) in V2a's files. **Supabase umbrella client** (6.1 KB br, the upper bound of bundle F3): the
  owner decided against it; auth wiring risk is higher than 30 ms. **Thumbhash**: decoded once per hash since #254; nothing left.
- **`shelf-publish` every 5 minutes**: 1,223 runs / 6 days at 8.6 ms (most of it a fresh worker's cost); `*/10`
  would save ~5 s of CPU a day. **Import write cost**: +4 % at 2,000 books, one call is 37 ms flat; the 8 s timeout needs ×200.
  **The prefetch hints, `content-visibility`, the stamp, the umbrella client** are decided and stay decided.
- **Render-blocking `entry.css` (12 KB br, Lighthouse 340 ms)**: the first paint needs it; inlining critical CSS
  in a static SPA is a build of its own for ~100 ms. **Cloudflare's beacon** (10 KB, "legacy JS"): the owner's analytics choice.
- **Early Hints (R7)**, **the CPU graph (R9)**, **the connection mix (R8)** of `backend.md` are still the owner's
  dashboard reads: a plan-level fact, not a code change.

## 6. Is the round done?

**For the backlog the harness can price: yes.** Requests, bytes, the backend and the lists' cost behave as the
earlier rounds said they would, and none of it has regressed: the entry is 7 % smaller, tab switches are
quiet, a revisit is free, the database holds a 15,000-Book catalogue at 17 ms, an import of 2,000 books at 0.76 s.

**Not done, honestly:**

1. **The cold start did not improve** (+150 ms against the baseline in a same-hour A/B): the features that landed
   in between (social Home, author section) cost 83 KB on the first-screen path, which the bundle trims have
   not bought back. #5 is the lever, and the lazy sheets are the cheap part.
2. **Two Vitals problems remain and one is new:** the search CLS 0.42 and the sign-in LCP of 5.6 s (P). The first
   needs a trace; the second needs thirty lines.
3. **A real phone has never been measured**: the field INP of 320–340 ms did not reproduce in any harness run
   (INP-like 24–64 ms), so what is left may be nothing, or may be what only a Mali GPU can show.
   With the field LoAF logger (#236) live, the device session and the field rows are now the instrument.

**The one next thing:** the sign-in wall PR with the two `preconnect` links (#1 and #2): one afternoon,
no conflicts, a 3.4 s LCP win measured in production, Lighthouse ~72 → ~90. After it, run section 7; if the
Errors rows are empty or only the Profile/Library frames, stop here.

## 7. Real-device session, refreshed (10 minutes)

Based on `web/perf/README.md`, with the field logger (#236) in the loop. Everything the harness cannot know is
what a phone's memory system and GPU do; record exactly this, once per phone.

**Before (1 minute, on the phone).** Open the installed app online once so the latest build installs. Open **Profile → Account → Errors** and note: the number of groups, and write down
(or screenshot) every row of kind `vitals` of the last 7 days (`LoAF … on /…`, `CLS … on /…`, `INP … on /…`,
`LCP … on /…`) with its **route** and **×count**. Do not clear anything.

**Android (about 6 minutes).** Settings → About → tap *Build number* ×7 → Developer options → USB debugging;
cable to the Mac; `adb devices`; Chrome → `chrome://inspect/#devices` → *Discover USB devices* → inspect the
installed Libellus PWA ("web app"). In DevTools → Performance: CPU and Network *No throttling* (it is the real
CPU), tick *Screenshots* and *Web Vitals*; the phone on battery saver off, brightness fixed, other apps closed.
Record **four** short recordings (record → do it → stop, 5–10 s each), in this order, and export each (⌘S):

1. **Cold start**: force-stop (Settings → Apps → Libellus → Force stop), arm *Record*, open from the icon.
   `android-cold.json`. Look at: LCP marker, the long frame at the start (the 672 ms entry parse measured
   at 4x), when Home's first cover is there.
2. **Library**: Home → Library tab → open *Finished* (the 99-row segment) → scroll to the bottom and back.
   `android-library.json`. Look at: the long frame at the tab tap and at the segment tap (146 ms at 4x),
   dropped frames in the *Frames* lane while scrolling.
3. **Profile**: Home → avatar → the figures → back. `android-profile.json`. The 213 ms first-open frame
   (`ViewTransitionCallback`, the sessions parse).
4. **Search**: tap Search → type a common word of your own titles (the one that matches the most Books) → wait
   for the results → close. `android-search.json`. Look at: the *Layout Shift* marker ≈ 0.5 s after the rows
   (CLS 0.42 at 4x), the style/layout bar while typing.

For each: the *Web Vitals* lane (LCP, CLS, INP markers), *Long animation frames* (Timings; click the longest,
*Bottom-up* by *Activity*), the *Frames* lane (red = dropped). Then *Application → Storage*: Cache storage size and
the `libellus.library` key's length. Put the files and screenshots in `.data/perf/android/` (gitignored).
Note: phone model, Android and Chrome versions (`chrome://version`), *JavaScript JIT* allowed.

**Back in the app (1 minute).** Profile → Account → Errors → *Refresh*. **Write down every new `vitals` row**
since the "before" note: `LoAF … on /library` or `/profile` or `/book/:key`, its `scripts:` line (the chunk and
function), `during:` (`interaction (click)` or `navigation`), and `CLS`/`INP`/`LCP` rows with their culprit
(`largest shift: search.overlay…`, `element: img…`). Rows come only from Chromium; the 200 ms threshold is
the logger's (`POOR_LOAF`), so a quiet phone sends none: **no rows is also a result**. Copy the stack of the
two longest (*Copy* in the group's detail).

**iPhone (about 3 minutes, same hand).** Settings → Apps → Safari → Advanced → *Web Inspector* on; Mac Safari →
Settings → Advanced → *Show features for web developers*. Open the app **from the Home Screen icon**
(standalone), cable, Trust; Safari → Develop → *the iPhone* → *Libellus*. Timelines: tick *JavaScript & Events*,
*Layout & Rendering*, *CPU*, *Memory*, *Screenshots*. Record **cold start** (swipe away in the App Switcher, reopen)
and **Library → Finished → scroll**, **Profile open**; export each (*File → Export Timeline Recording…*).
Look at *Layout & Rendering* (red frames, long Layout/Style bars), the longest *JavaScript & Events* task,
the *CPU* thermal state and the *Memory* peak. Low Power Mode **off**. iOS sends **no LoAF rows** (WebKit has no
such entry) and no CLS rows (no layout-shift entry): the Web Inspector is the only source there.
**Also on the iPhone, two things the harness cannot see:** (a) the second launch with the service worker
installed, from tap to Home (in Playwright's WebKit 3 of 5 second visits took ~1.1 s instead of ~60 ms: a real iPhone
will say whether that is the harness); (b) airplane mode, then launch: does the shell open (Playwright cannot test it).

**Hand over:** the `.json`/Safari exports, the screenshots of Errors before and after, the models and versions,
and the answers to three questions: *does the Library feel slower than Home? does the Profile stutter on the
first open only? did typing in search make the results jump?*

## 8. Reproducing

```sh
# stack (own ports 55770-55779, own project id), seed, build, serve on 3102
mkdir -p /tmp/libellus-perf-final && cp -R supabase /tmp/libellus-perf-final/
cd /tmp/libellus-perf-final && perl -pi -e 's/5532(\d)/5577$1/; s/^project_id = "libellus"/project_id = "libellus-perf-final"/' supabase/config.toml
supabase start -x studio,edge-runtime,realtime,logflare,vector,imgproxy
cd web && export PERF_STACK_PORT=55771 PERF_STACK_DIR=/tmp/libellus-perf-final PERF_UPSTREAM=http://127.0.0.1:55771 PERF_APP_PORT=3102
pnpm perf:seed && pnpm perf:build && (pnpm perf:serve &)
pnpm perf --profile slow4g-4x --runs 5 --label final-4x-a        # then slow4g-6x, chromium, webkit
python3 ../docs/perf/data/final/summarise.py ../.data/perf/final-4x-a/slow4g-4x.json
pnpm perf:bundle; pnpm perf:signin --runs 5; pnpm perf:images; pnpm perf:list --runs 5; PERF_ENTRIES=1000 pnpm perf:seed && pnpm perf:list --label entries-1000
LIBELLUS_E2E_PERF=1 LIBELLUS_E2E_PORT=3102 FLIGHT_OUT=/tmp/soak pnpm exec playwright test e2e/perf --repeat-each 5 --workers 1   # SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY, _DB_URL, MAILPIT_URL point at the stack
# backend
export ANON_KEY=...; docs/perf/data/final/backend.sh s2 --members 300 --entries 150 --pool 15000 --heavy-entries 1000
node docs/perf/data/final/loadtest.mjs --levels 1,5,10,20,40 --seconds 8; node docs/perf/data/final/loadtest.mjs --mix --levels 5,20
docker update --cpus=2 supabase_db_libellus-perf-final supabase_rest_libellus-perf-final
# production, logged out
node docs/perf/data/final/prod-smoke.mjs chromium --runs 5; node docs/perf/data/final/prod-smoke.mjs webkit --runs 5
node docs/perf/data/final/prod-smoke.mjs chromium --runs 5 --block mzstatic           # the wall's covers blocked
supabase stop --no-backup   # in /tmp/libellus-perf-final; only your own
```

| File in `data/final/` | What |
| --- | --- |
| `client/report-final-*.md`, `final-*.json`, `ab-summary.md` | the suite's tables, medians per step, the same-hour A/B |
| `client/bundle.txt`, `signin.txt`, `images.txt`, `list-150.txt`, `list-1000.txt`, `soak-*.txt` | `perf:bundle`, `perf:signin`, `perf:images`, `perf:list` (150 / 1,000 entries), the cover flight |
| `backend/s{0,1,2}-*.txt`, `s2-loadtest-*.txt`, `s2-import*.txt`, `s2-social-bench.txt` | EXPLAIN as a member, screens, Home x20, load test, import, social |
| `prod-smoke-*.json`, `prod-headers.txt`, `lighthouse/lighthouse-summary.json` | the production smoke, headers, Lighthouse |
| `prod-smoke.mjs`, `loadtest.mjs`, `screens-now.mjs`, `backend.sh`, `summarise.py`, `search-cls.ts` | the scripts this round added (`search-cls.ts` runs from `web/perf/`) |

## 9. Limits

- **Time and load**: a shared Mac; the 2-CPU Home x20 numbers were taken at load 5.4–9.3 (two series: 580 / 784 ms
  and 488 / 775 ms; both printed); the load test's 40-member rows ran at load up to 8.5. Counts and bytes do not move with load.
- **The load generator is on the same machine** as the database; closed-loop with no think time is a stress, not a
  traffic model.
- **Production is one logged-out page.** No signed-in screen was measured; the field LoAF rows and the device
  session are the answer there. The production factors are `backend.md`'s, not re-derived.
- **WebKit** has no throttling, no LoAF, no offline emulation that survives a navigation, and reaches the API only partly in the harness.
- **CDP does not charge DNS, TCP or TLS** and does not throttle the service worker: preconnect and the install
  cost are priced only by Lighthouse's simulation (175 ms) and the device session.
- The A/B's "before" is a build of `a9a91c89` against today's database (the schema is a superset): the app of that
  commit asks the lists with descriptions, as it did.

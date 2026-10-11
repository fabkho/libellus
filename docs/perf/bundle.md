# Bundle size assessment

Read-only research, `origin/main` at `46dfb6a0` (the worktree this was measured in). No app code,
config or dependency changed; the experiments below were built in the worktree and reverted.
Raw measurements: [`data/bundle/`](data/bundle/). Measured with `pnpm perf:bundle` (`web/perf/bundle.ts`),
a Playwright capture of an unauthenticated first load, and throwaway builds. Brotli is quality 11.

**Top line: there is still something to gain, but it is small.** The first screen costs about 305 KB
brotli of JS/CSS (fonts extra), against about 55 KB for a bare Nuxt 4 SPA. About 130 KB of that
gap is not the app's own code. It is lazy chunks the sign-in screen fetches (a Home chunk and the
vitals chain) and a service-worker precache that is four times the entry. Every compile-time
experiment saves 1–6 KB brotli each. Together they reach roughly 10 KB on the entry, and the
sign-in fix is worth more than all of them.

## 1. Payload table

Brotli q11. "Sign-in" is a fresh, unauthenticated load of `/`. "Home after sign-in" was not measured:
it needs the seeded Supabase stack from `web/perf/README.md`, which was not started here.

| Payload | raw KB | gzip KB | brotli KB | note |
| --- | ---: | ---: | ---: | --- |
| Entry (`index.html`: 1 script, 1 CSS, 11 modulepreload) | 628.9 | 201.2 | **176.7** | harness; the sum of its 12 files |
| Sign-in: all JS + CSS requested (86 files) | 1,047.1 | 345.3 | **305.3** | the entry plus lazy chunks (below) |
| Sign-in: fonts (3 woff2 requested, Geist/Newsreader latin) | — | — | ~47 | not measured by script; estimated from the sign-in trace |
| Sign-in: messages (`BJDnPcHj.js`, en.json compiled) | 94.4 | — | 15.9 | in the 86 above; fetched by a waterfall, not preloaded |
| Service worker precache (230 entries) | 2,077.4 | — | **770.5** download | JS 535.6 · CSS 29.4 · fonts 163.2 (woff2 only) · icons 41.7 · other 0.5 |
| Bare Nuxt 4 SPA entry (`npx nuxi@latest init`, minimal, ssr:false) | 170.8 | — | **55.0** | the baseline; 6 JS/CSS files, all in the entry |

Against the baseline: the app's entry is 3.2× a bare Nuxt SPA (177 vs 55 KB brotli). The bare build
is Nuxt runtime + Vue + vue-router only. The app's extra ~122 KB brotli on the entry is roughly
Supabase (~35 KB brotli, `LJ-jPCQl`), i18n + intlify (~40 KB, `AvAfgI_h` and the runtime part of
`BE7Zge0u`), Pinia and the app's eager stores, and web-vitals/unhead glue. Per-chunk attribution
below is by sourcemap bytes, so it is approximate.

The harness's "Messages chunk" line points at `AvAfgI_h.js`. That is wrong: `AvAfgI_h.js` is
mostly eager app store code (library, collections, search, outbox, queued writes). The messages are
`BJDnPcHj.js` (loaded by dynamic import, see F7). The harness's signature table mislabels it as
"foliate / reader" for the same reason.

### Entry and sign-in chunks, by content (sourcemap attribution)

Built with `sourcemap: { client: true }` for attribution only, then reverted.

| Chunk | brotli KB | What it is |
| --- | ---: | --- |
| `BE7Zge0u` | 52.4 | Nuxt runtime, vue-router 23 KB raw, runtime-dom 16 KB raw, unhead, ofetch, i18n runtime glue |
| `AvAfgI_h` | 40.3 | app stores and data (library, collections, search, outbox, merge, covers, avatar), vue-i18n + message-compiler (~17 KB raw), pinia |
| `LJ-jPCQl` | 34.8 | supabase-js: auth-js 99 KB raw, **storage-js 22.5 KB, postgrest-js 16.4 KB, umbrella 10.6 KB, iceberg-js 5.4 KB, functions-js 2.8 KB** |
| `mCIrZfd0` | 27.2 | Vue runtime-core 59 KB raw, reactivity 17 KB raw |
| `entry` CSS | 9.4 | Tailwind output, 52.7 KB raw |
| `BJDnPcHj` | 15.9 | en.json messages, 94 KB raw (AST form, about 2× the source text) |
| `D0FuntN8` | 9.1 | Home components (ReadingCard, Circle, CircleFeature) — loaded at `/` before the sign-in redirect (§3, F1) |
| `C8TB2poD` | 20.7 | papaparse + `stores/import.ts` + `OwnEditionSheet` + the `__exportAll` helper the vitals module needs (§3, F2) |
| `SZ_wTi5w` | 4.8 | web-vitals, idle import |

Heaviest app modules by source (sourcemap): `vue-router`, `runtime-core`, `runtime-dom`, `nuxt/app`
composables, and `app/data/library.ts` (13 KB raw in `AvAfgI`), `app/stores/library.ts` (6.7 KB).
Lazy and correctly split: `dompurify` + foliate reader (`m3-Iqux7`, 92 KB raw, 29 KB br), foliate's
`zip.js` (35 KB raw), `zxing` (36 KB raw wasm glue, 0.95 MB wasm, out of the precache), the reader
engine, `papaparse`, Regal (out of the precache).

Duplicated packages: the harness does not check for them, and I did not add a check. The one visible
sign is a build warning, `Duplicated imports "thumbhashDataUrl"` from `app/utils/cover.ts` and
`app/utils/thumbhash.ts` (~1 KB; not worth fixing for size alone).

## 2. Classification of the large items

| Item | Needed on | Already lazy? | Should it be? |
| --- | --- | --- | --- |
| Nuxt runtime, vue, vue-router, unhead | first paint | eager | no (required) |
| vue-i18n + message compiler + messages | first paint | compiler and messages eager (waterfall for messages) | compiler: no (see F5). messages: needed, but preload them |
| supabase-js umbrella (storage, functions, iceberg) | first paint (the client is built at boot) | no; storage used by `avatar.ts`, ebooks files, session | storage/functions could be built lazily (F3) |
| Realtime | not used | stubbed by PR #254 | done |
| Home components on `/` | Home only | lazy, but fetched at `/` before the sign-in redirect | no: F1 |
| vitals (web-vitals, `data/vitals.ts`) | after load | idle `import()` | yes, but its helper chunk drags in papaparse (F2) |
| papaparse, import store, OwnEditionSheet | Profile → Import, a book's edition sheet | lazy by route, but pulled by the vitals helper | yes once F2 is fixed |
| foliate reader, dompurify, zip.js | opening an ebook | lazy | yes (correct). Precached, see F6 |
| zxing (barcode) | opening the scanner | lazy, out of the precache | yes (correct) |
| Regal (three.js) | the shelf, only with `LIBELLUS_REGAL=1` | lazy, out of the precache | yes; not in this build |
| web-vitals, workbox-window | after load | idle | leave (~7 KB, deferred) |
| Options API code in Vue | none known | everything on | `__VUE_OPTIONS_API__: false` is safe only if no dependency uses the Options API. Not checked (F4) |

## 3. Findings, ranked by impact × effort

Savings: **measured** = a throwaway build, brotli of the entry, compared with the same build at
origin/main. **Estimate** = bytes from the sign-in trace, not a build.

| # | Finding | Evidence | Saving | Proposed change | Risk | Effort | Model | Conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Sign-in fetches the Home page chunk. Nuxt awaits `router.isReady()` (`nuxt/dist/pages/runtime/plugins/router.js:108`) before the `router.beforeEach` that runs middleware (`:121`). So `app/middleware/auth.global.ts` redirects only at `app:created`, after `/` (`app/pages/index.vue`) has loaded Home's chunk (`D0FuntN8`, 9 KB br). | Sign-in trace (`data/bundle/signin-requests.txt`; sub-agent trace of the router order, §4). | **Estimate ~20 KB br** off the sign-in path (Home-only deps not preloaded by sign-in). | Redirect unauthenticated `/` to `/sign-in` before the router reads the location (e.g. in `app/router.options.ts` or a `history` wrapper), only when no Supabase session key is stored. | Medium: share and deep-link flows, and the token-key check, need e2e. | M | Sonnet | `app/router.options.ts`, auth middleware. Not in any in-flight file listed. |
| F2 | The vitals plugin's idle `import('~/data/vitals')` pulls `C8TB2poD` (papaparse, import store, `OwnEditionSheet`, a runtime helper) and the barcode scanner's chunk onto the sign-in path. The helper is rolldown's `__exportAll` namespace object, which `vitals.ts` needs. | Sign-in trace; `BKDt57C4.js` opens with `import{c as e}from"./C8TB2poD.js"`. | **Estimate ~25 KB br** off sign-in (`C8TB2poD` 20.7, scanner ~4). | Make `app/data/vitals.ts` not depend on the shared namespace helper (import named exports), or move the helper into a tiny module. Alternatively a `codeSplitting` group for the helper. | Low. Vitals is a diagnostic path; verify the vitals reporter still sends. | S | Sonnet (rolldown group syntax untested: check first) | `app/plugins/vitals.client.ts`, `app/data/vitals.ts`. |
| F3 | `@supabase/supabase-js` umbrella always constructs StorageClient, FunctionsClient and Realtime in `SupabaseClient`'s constructor (`SupabaseClient.ts:410-430`, verified by reading the 2.117.2 source), so tree-shaking cannot drop them. No official slim entry point exists (only `.`, `./cors`, `./tracing` in `exports`). | Measured: stubbing storage-js, functions-js and iceberg-js (aliases in `nuxt.config.ts`) gives 171.0 vs 177.1. | **Measured 6.1 KB br** upper bound on the entry; a real fix keeps `storage` usable (`avatar.ts`, ebooks) and so saves less. | Build the client from `@supabase/auth-js` + `@supabase/postgrest-js` directly (a small `createSupabaseClient` replacement) and build `StorageClient` lazily in `avatar.ts` / ebooks. Keep the write-timeout fetch and the session storage wiring. | Medium-high: auth/session wiring is not in the public API of the sub-packages; the sign-in and sync flows need e2e. Unverified as supported by Supabase. | M–L | Sonnet, with the data-layer tests | `app/data/createSupabaseClient.ts`, `app/data/avatar.ts`, `app/stores/session.ts`. |
| F4 | `__VUE_OPTIONS_API__: false` (plus `__VUE_PROD_DEVTOOLS__`, `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`, which are already false in `@vitejs/plugin-vue` 6.0.9, `dist/index.mjs:1693-1695`). | **Measured 1.6 KB br** (175.5). | 1.6 KB | `vite.define` for the one flag. | Low–medium: any dependency with `data()`/`methods:` breaks at runtime. None found in `app/*.vue`; not verified against dependencies. | S | DeepSeek (config), then e2e | none |
| F5 | i18n: `bundle.runtimeOnly: true` + `dropMessageCompiler: true` (messages must be precompiled; no runtime-built strings). | **Measured 5.3 KB br** (171.8). | **5.3 KB br**, entry only. | Two config keys. | Medium: any `t()` with a string built at runtime, or `te`/`tm` on dynamic keys, throws. Needs an audit for dynamic keys and a full e2e pass. The source confirms the JIT branch is skipped (`@intlify/core-base` `core-base.mjs:201-245`). | S (config) + audit | Sonnet (audit), DeepSeek (keys) | **perf/lazy-images-i18n** is measuring the same flags. Coordinate; its result was not available. |
| F5b | `bundle.fullInstall: false`. | **Measured 1.2 KB br.** | 1.2 KB | config key | Low: removes the global install of the i18n components/directives. Check the app does not use `<i18n-t>`. | S | DeepSeek | as F5 |
| F6 | Service worker precache is 770 KB download (535 KB JS) on first install, including the ebook reader, dompurify, zip.js and the Home/route chunks. It is not on the first-paint path but it competes for the same connection on the first launch. | `sw.js` precache: 230 entries, 2,077 KB raw. | Not a first-paint saving. Could drop ~200–300 KB brotli from the first install. | Owner decision: exclude the reader chunks from the precache (`globIgnores`) and keep them in a runtime cache on first open. Reader offline use would then need a first open while online. | Medium: offline reading of an already-imported book would break until the reader is opened once online. | S (config) | Owner question first, then DeepSeek | `nuxt.config.ts` `pwa.workbox.globIgnores` only. |
| F7 | The messages file (`BJDnPcHj`, 15.9 KB br) is loaded by a dynamic `import()` from the entry, with no modulepreload, so it is a request waterfall after the entry. | Trace: `Z(()=>import('./BJDnPcHj.js'),[])` in `BE7Zge0u.js`. | Latency, not bytes: one RTT on the first paint (not measured). | Preload it (Vite's `modulePreload` option or the i18n module's preload config; the option was not verified). | Low. | S | DeepSeek | none |

Not worth doing (each is under ~3 KB br or already done, so we do not revisit them):

- **Nuxt `experimental.treeshakeClientOnly`**: does not exist in `@nuxt/schema` 4.5.2 (verified).
- **`payloadExtraction`**: forced to `false` by Nuxt when `ssr: false` (verified, `schema index.mjs:676-678`).
- **`componentIslands`**: `auto` and inactive without island components (verified in source). Nothing to remove.
- **`viewTransition`**: default off (verified). Keep it off.
- **`build.analyze`**: diagnostic only.
- **`cssCodeSplit`**: already on by default in Vite; Nuxt reads it.
- **Vue devtools and hydration-mismatch flags**: already false (see F4).
- **Prefetch hints**: already disabled in `nuxt.config.ts:61`.
- **Polyfills**: none shipped. Vite 8.3.2's default `build.target` is `baseline-widely-available`, which means Chrome 111, Safari/iOS 16.4, Firefox 114 for syntax only; no legacy polyfills (verified in the Vite source). `vite/modulepreload-polyfill` is added by Nuxt (~0.5 KB, not worth removing).
- **web-vitals and workbox-window** on idle: ~7 KB brotli, but deferred and not on first paint.
- **Thumbhash duplicate import**: ~1 KB.
- **`dompurify`**: lazy already; the only eager use would be the reader.
- **Icon strategy and font subsetting**: fonts are woff2 only and latin subsets already (`woff` fallbacks are excluded from the precache on purpose, `nuxt.config.ts` workbox comment). Icon approach was not measured; no finding.

Not checked (no claim made): CSS unused utilities beyond what Tailwind v4 already emits; `font-display`
and font preloading; inline SVG/data URIs in JS; source-map leakage in the default build (none
emitted: no `.map` files in the default `nuxt generate` output, checked); duplicate package versions
(checked only top-level: one `vue`, one `vue-i18n`, one `@intlify` set); HTTP headers on Pages
(the harness serves its own).

## 4. Research notes (with sources)

Sub-agents, Sonnet, read the installed packages for each claim.

- **supabase-js 2.117.2.** VERIFIED in source: the constructor builds `SupabaseStorageClient` and
  realtime unconditionally (`dist/SupabaseClient.ts` ~l.388–430 of the package source). Package
  `exports` has only `.`, `./cors`, `./tracing`. Issue #151 (https://github.com/supabase/supabase-js/issues/151, 2021,
  old) reports the same. No official slim entry was found; direct `@supabase/auth-js` + `postgrest-js` use is unverified as supported.
- **@nuxtjs/i18n 10.6.0.** CLAIM: https://i18n.nuxtjs.org/docs/api/options: `runtimeOnly` requires messages
  resolvable at build time. VERIFIED in `module.mjs:52-55, 1716, 1781-1784, 2451-2452`. The
  `dropMessageCompiler` behaviour is in `@intlify/core-base`. Docs were read through a summariser:
  quotes approximate.
- **Vue compile-time flags.** CLAIM: https://vuejs.org/api/compile-time-flags.html (Vue 3.5 docs).
  VERIFIED: Nuxt does not set them itself; `@vitejs/plugin-vue` 6.0.9 sets the defaults.
- **Nuxt 4 experimental flags.** CLAIM and VERIFIED in `@nuxt/schema` 4.5.2 as above; docs at
  https://nuxt.com/docs/4.x/guide/going-further/experimental-features.
- **Vite 8.3.2 target.** VERIFIED in `vite/dist/node/chunks/node.js:720-726`; the target applies to syntax, not polyfills.

Not researched further in the time box: Cloudflare Pages Early Hints, `Cache-Control` for hashed
assets (Pages sets `_headers`, already in the repo; not changed here), and the nuxt-i18n-micro
comparison for issue #257 (out of scope for this report; no verdict given).

## 5. Open questions for the owner

1. **Ebook reader offline.** Should the reader chunks (~200 KB br, about 40% of the precache) stay
   precached (offline reading of an already-imported book with no connection), or be fetched on
   first open (F6)? This is the biggest single byte decision, and it is yours.
2. **Browser floor.** Vite's default target is Chrome 111, iOS 16.4. Is that the floor you want? A
   lower floor needs `@vitejs/plugin-legacy`, which costs more bytes than anything here.
3. **German (issue #257).** F5 (runtimeOnly) makes every message precompiled. It is fine for a
   second locale, but the German strings must then be compiled at build time (they will be).

## 6. Experiment log

Brotli of the entry (`pnpm build` of the worktree with each change, reverted after):

| Experiment | Entry brotli KB | Delta |
| --- | ---: | ---: |
| origin/main | 177.1 | — |
| `bundle.fullInstall: false` | 175.9 | −1.2 |
| `vite.define __VUE_OPTIONS_API__: false` (+ 2 flags, already false) | 175.5 | −1.6 |
| `bundle.runtimeOnly` + `dropMessageCompiler` | 171.8 | −5.3 |
| supabase storage-js, functions-js, iceberg-js stubbed (upper bound for F3) | 171.0 | −6.1 |

The experiments are in the raw data (`data/bundle/experiments.tsv`). No experiment is committed.
The build used `nuxt generate` on Node 24.21 and pnpm 12.6 with the frozen lockfile.

The bare-Nuxt baseline: `/tmp` throwaway project (`npx nuxi@latest init`, minimal template, ssr:false), 55.0 KB brotli entry.

## 7. Status of the findings

Measured on this branch with `pnpm perf:bundle` and `pnpm perf:signin` (`web/perf/signin.ts`: a first launch of
the sign-in screen, no session, empty cache, Chromium at `slow4g-4x`, brotli over the wire, median of 3), against
`origin/main` at `3d8e9440`. Owner's decision: F3 and F7 are not done, on purpose.

| # | Status | Result |
| --- | --- | --- |
| F1 | **done in this PR** | Sign-in screen visible: 79 → 20 files, 298.8 → 219.3 KB, 2,989 → 1,993 ms (localhost, throttled). The estimate was ~20 KB; Home's page pulls most of the app's lazy components. Entry +0.6 KB (the guard). |
| F2 | **done in this PR** | After the idle work (9 s): 86 → 81 files, 334.4 → 304.0 KB (−30.4 KB). |
| F4 | **done in this PR** | Entry 176.7 → 175.5 KB (−1.2 KB; the report measured −1.6 on a slightly different base). |
| F6 | **done in this PR** (reader out of the precache, fetched ahead) | Precache 766.9 → 683.5 KB download (−83.4 KB, −9 entries); the reader is ~83 KB brotli, not the ~200 the report guessed. Read now with the chunks fetched ahead: room on screen 80 ms after the tap, as before. |
| F3, F7 | not done (owner). | |
| F5 | **done** in #263 (`dropMessageCompiler`; `runtimeOnly` alone changed nothing): entry 176.7 → 172.7 KB br. | |
| F5b | **skipped, on purpose** (`bundle.fullInstall: false`): the app uses `<i18n-t>` (`home/CircleFriend.vue`, `book/Goodreads.vue`), which `fullInstall: false` stops registering globally; 1.2 KB br would need those components imported by hand. Left as it is. | |

### F4: Options API

No `.vue` file in `app/`, and none in Nuxt's runtime components, vue-router, `@nuxtjs/i18n` (composition mode),
Pinia, the vendored foliate-js (no Vue), the Regal layer or TresJS 5 (`@tresjs/core`, `@tresjs/cientos`),
uses `data()`, `methods`, `computed` objects, `mixins` or lifecycle options (grepped; Regal's and TresJS's sources
read from a local checkout, not built). `__VUE_OPTIONS_API__: false` is in `vite.define`. A dependency that needs
it would fail at run time: check before adding a package that ships Options API components. Checked with the auth,
friends and offline e2e flows on the new build.

### F1: how

`app/router.options.ts` adds a `beforeEnter` to every route (first navigation only) that sends a visitor to
`/sign-in` before the page's chunk is fetched, only when `knownSignedOut` (`utils/signedOutRoute.ts`): no
`sb-*-auth-token` key, no offline Library copy, no code in the air. Everything else (a stored session, an expired
one, the offline start) takes the old path through the middleware. The middleware and the guard share
`signedOutDestination`, so the share and follow-link keeping (`/share`, `/f/<token>`), `/verify` and the public
`/r/` pages behave as before. Tests: `tests/signed-out-route.test.ts`, and `e2e/auth.spec.ts` (a signed-out visitor
opening `/`, a Book and `/friends` never receives Home's or the Book page's chunk; fails without the guard).

### F2: how

`data/loaf.ts` imported `data/vitals.ts` statically while the vitals plugin imports it with `import()`. The bundler
then builds a namespace object for the dynamic import with its `__exportAll` helper, which sat in the shared chunk
with papaparse, the import store and the scanner. The two parts `loaf.ts` uses moved to `data/vitalsBasics.ts`
(re-exported from `vitals.ts`, so its tests and reports are unchanged); a test keeps `vitals.ts` dynamic-only.
General rule found: a module imported both statically and dynamically gets a namespace object; keep a dynamically
imported leaf free of static importers.

### F6: how, and what it costs

The reader (`ebook-reader*` chunks: Reader.vue, its sheets, foliate-js, DOMPurify, the engine's font files; one group in `codeSplitting`, and `ebook-reader-entry` names for the two dynamically imported files) is out of the precache (`globIgnores`). A CacheFirst rule (`libellus-reader`) keeps it once fetched. `data/reader/prefetch.ts` decides who fetches it, and when: `hasOpenableEbook` (a linked record whose copy is on this device, from the ebooks snapshot or store; never the Library, never the server), online and not Save-Data; at idle 1.5 s after mount, at idle on a Book page with its ebook, and at once when the first ebook is linked. Tests: `tests/reader-prefetch.test.ts`; e2e `reader.spec.ts`, `ebooks.spec.ts`, `a11y.spec.ts`, `offline.spec.ts` pass.

`pnpm perf:reader` (Slow 4G, 4x CPU, median of 3, ms from the tap; the member has a Book with an ebook linked):

| Case | Main (reader precached) room / ready | This PR room / ready | Loading UI |
| --- | ---: | ---: | --- |
| chunks fetched ahead (prefetched) | 362 / 1,901 (precache, but not yet loaded in memory) | **82 / 788** | none |
| tap the moment the Book page shows (mid-prefetch) | 867 / 2,520 | 1,505 / 2,185 | none |
| no prefetch (cold tap, Save-Data) | 613 / 2,250 | 1,230 / 2,080 | none |
| returning member, service worker | 83 / 784 | 78 / 766 | none |

"Room" is the first frame of the reader layer (the cover starts to fly), "ready" is `data-ready`: the flight and the engine done. A tap with nothing fetched ahead shows **nothing** until the chunks arrive (1.2 s at Slow 4G, 85 KB): `Reader.vue` has no loader and none was added, so it is a dead tap, then the normal opening. The prefetched path shows no spinner or skeleton and is as fast as the precached one. Smallest mitigation if the cold tap matters, not built: keep the button's pressed state until the room is ready (invisible otherwise). The mid-prefetch and cold rows are ~0.6 s worse than main's: the room now also waits for the 72 KB group chunk (main's Reader.vue chunk was small and the rest loaded behind the flight), and in the mid-prefetch case the Book page's own requests share the pipe with the prefetch.

Offline (checked with the service worker in Chromium): a reader fetched once, by any trigger, opens offline from `libellus-reader`; a reader never fetched (Save-Data) does not. That is the one accepted regression: a member needs one online start with an ebook linked. A failed `import()` stays in the browser's module map for good (checked in Chromium: a retry fails too), so `utils/readerChunks.ts` fetches the files first (`fetch`, the list is the build's `_nuxt/builds/reader-files.json`; a failure leaves nothing behind) and imports only once they are cached. A failed prefetch is tried again after 5, 20 and 60 s (online, no Save-Data), and Read now itself loads whatever is missing before it opens the reader (a tap after a dropped prefetch opens it: 1,023 / 1,703 ms at Slow 4G/4x). A cold tap costs ~0.25 s more than with a parallel import (fetch, then import).

Bundler notes: a module that is in a `codeSplitting` group and also imported dynamically gets a facade chunk with an undeclared namespace export (`Export 'engine_exports' is not defined`), so the two dynamic entries stay out of the group. A group named `reader` collides with the chunk named from `stores/reader.ts`. Other lazily needed things in the precache (listed, not moved: no measurement of their opening): the shared chunk with the import store and `OwnEditionSheet` (~21 KB br), the Book page chunk (~18 KB), Friends' blocked page (~13 KB), the ebook ingest worker (~5 KB).

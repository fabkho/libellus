# #131 phase 2 — the built-in reader, design round

Three complete reading prototypes on one engine (foliate-js), each in D's language with
**light, dark and sepia**, plus the shared parts: the Aa sheet, Contents, the opening flight
from the book page's cover, *Start reading?*, the end of the book with Finish, the progress
line, Back, the screen kept on.

- **Try it (phone, same Wi-Fi):** http://192.168.178.81:3127/prototype/reader?v=a (`v=b`, `v=c`).
  The page is a stand-in for the book page (cover, *Read now* as the primary action); its panel
  switches variant, book (Peter Rabbit with pictures, Metamorphosis, or **your own EPUB** from
  the phone), status (Want to read / Reading), how fast progress is written, Reduce Motion, the
  app's theme. Useful address flags: `book=kafka`, `status=want`, `theme=sepia`, `margins=0`,
  `leading=0`, `open=1`.
- Code: branch `fabkho/reader-protos` (pushed, no PR), all of it in `web/app/proto/reader/`
  plus `web/modules/reader-proto.ts`, which adds the route **only under `nuxt dev`** — no build
  has it. Phase 1's files are untouched; the prototypes read the EPUB from a bundled fixture
  or a picked file instead of phase 1's OPFS store.
- Screenshots: `shots/` (phone 412 × 915, JPEG ≤ 1000 px), strips: `strips/`, engine numbers:
  `measure.txt`, the scripts that made all of it: `scripts/`.

## The three variants

### a — Quiet pages (paginated)
Nothing on the page but the text. Tap the outer 30 % on the right (or swipe left) for the next
page, the left 30 % for the previous one; the page slides and follows the finger (foliate's
own swipe). A tap in the middle brings a slim glass bar to the top (Back, the title, Contents)
and one to the bottom: the progress hairline you can **drag to jump** (a mono bubble says the
page, a tick marks the page saved in Libellus), the chapter (tap → Contents), "p. 12 of 96 ·
16 min left in chapter", and Aa. A tap anywhere, Escape or Back puts the bars away.
*Feels like:* Apple Books/Kindle done quieter. The most familiar; the bars only exist when
asked for. `shots/a-*.jpg`, `strips/turn-a.jpg`, `strips/swipe-a.jpg`.

### b — Scroll (one long page per chapter)
A lamp hairline along the top edge fills as the chapter scrolls by, the chapter's name floats
under it (mono eyebrow) on a short veil of the room. Scroll up (10 px, like the tab bar's
rule) or tap and the bars come back — Back, the chapter and Contents at the top; the book's
page, %, minutes left in the book and Aa at the bottom. At a chapter's end a quiet glass pill
says *Next chapter*. *Feels like:* reading a long web article; best for one-handed reading on
a bus, worst for keeping your place by "page". Per-chapter scrolling is what foliate does (no
continuous scroll across chapters). `shots/b-*.jpg`.

### c — Printed page (my pick for the third)
A printed book: the chapter set as a **running head** in Newsreader italic at the top margin,
the **folio** (the Book's page number) in mono at the foot — where you are is always visible
without any chrome. On a wide screen (tablet, landscape, desktop) **two pages face each other**
across a soft gutter crease (the spine crease from `UiCover`). Pages turn with a calm **fade**
(out over `instant`, in over `standard`), no slide; a swipe still follows the finger. The middle
tap floats up a small **glass capsule** like the app's tab bar: Back, "12 % · 84 pages left",
Contents, Aa. When progress is written a lamp-coloured **bookmark ribbon** drops in at the top
edge with "p. 13 saved" and lifts out again. *Feels like:* the most "book", the calmest page
turn, and the only one that still tells you where you are while the chrome is away.
`shots/c-*.jpg`, `shots/c-spread-tablet-sepia.jpg`, `strips/turn-c.jpg`.

## Shared pieces (all three variants)

- **Aa sheet** (`UiSheet` "Text"): room (Light / Dark / Sepia, each swatch drawn in its own
  room's tokens), typeface (the app's **Newsreader** serif or **Geist** sans), 7 sizes (15–25.5
  px, 18 default), **Margins in 4 steps — Edge to edge, Narrow, Normal, Wide**, **Line spacing in
  4 steps — Tight, Snug, Normal, Airy**, Justify (with hyphenation) on/off, Keep the screen on.
  Applied live, kept per device. *Owner request during the round:* "as much text as possible on
  the screen at a readable size" → **Edge to edge** takes the side margins down to ~1.8 % of the
  width (7 px on a phone, so no letter touches the glass), the top/bottom bands to the safe area
  plus 10 px, lifts the line-length cap (1100 px) and tightens the space between paragraphs;
  with **Tight** lines a 412 × 915 phone goes from ≈ 30 lines of ≈ 350 px to ≈ 38 lines of
  ≈ 397 px at the same 18 px — roughly 40 % more text per page
  (`shots/a-margins-normal.jpg` vs `shots/a-margins-edge-tight.jpg`; also in b,
  `shots/b-margins-edge-tight.jpg`). Text size is never touched by it.
- **Sepia**: a third, reader-only room (owner decision 4): warmer paper `#f1e6d0`, brown ink
  `#3b2b1c`, the lamp a step darker (`#a4651c`) so it still reads. Light/dark stay the app's own
  values. While the reader is open its room is also put on `<html>` (so its sheets wear it) and
  on `theme-color` (Android's status bar takes the page colour); both go back on close. On paper
  (light, sepia) pictures are multiplied into the page, so an illustration's white becomes the
  paper (`shots/a-pictures-sepia.jpg`); in the dark they are dimmed a little.
- **Contents** (`UiSheet`): small cover, "p. 39 of 96 · 40 % · 55 min left in book" over D's
  hairline, then the chapters in the serif with the page each starts on; the one being read lit
  with the lamp dot, the ones behind muted. Project Gutenberg's licence is left out (back matter).
- **Opening transition**: *Read now* → the hero cover (a copy of its image, `transform` +
  `clip-path` only, Web Animations, D's `sheet` duration on the `standard` curve) flies to where
  the book's **own cover page** is drawn; the room fades in under it; when the first page is
  ready the copy settles onto the page's cover and goes — on a cover page the hand-off is
  pixel-for-pixel (`strips/open-a-cover-page-light.jpg`). Resuming mid-book it lands in the page
  box and dissolves into the text (`strips/open-b-resume-dark.jpg`). Back: the page gives way
  to its cover (`quick`), which flies home into the hero while the room fades
  (`strips/back-*.jpg`). The flight also hides the engine's load. Reduce Motion: the reader
  cross-fades in and out over `standard`, nothing flies.
- **Start reading?** (Want to read Book): the Start sheet in the reader's room, once per
  opening, with one line on what starting means here ("the reader keeps your progress as you
  turn the pages"). Cancel keeps it Want to read and nothing is written.
- **Progress, forward only** (owner decision 2): the reader's place (fraction of the body,
  the licence excluded) × the Book's page count = a page. Written after a rest on a page (spec:
  10 s, at most once a minute; the panel's *Quick* uses 2.5 s / 5 s so it can be seen) and on
  close; never lower than what is saved, and never just for opening the book. a/b show
  "• p. 13 saved" in the bottom margin for 2.6 s, c drops the ribbon. Reading behind your
  saved page shows "Your progress is at p. 60 · **Set to p. 12**" in the chrome — the only way
  back is the member's own tap (`shots/progress-behind-a.jpg`).
- **End of the book**: turning past the last page of the text (not the licence) shows one more
  page: the cover with its light, THE END, the Book, the read in one mono line, **Finish** as the
  lit action (opens the Finish sheet over it: day, Rating, review), *Back to the last page*.
  Turning back, Back or Escape return to the last page.
- **Back / Escape**: chrome (or the end page) first, then the reader; each has its own history
  entry through `useBackDismiss`, so Android's back gesture behaves as everywhere in the app.
- **Screen kept on**: `navigator.wakeLock` while a book is open, re-taken when the app comes
  back; released on close. It needs a secure context, so over the LAN's plain http it is
  **simulated** (the dev panel says "wake lock: on (simulated: needs HTTPS)").
- Safe areas: the text's top/bottom bands include the insets; bars use `bar-top`/`safe-bottom`.

## Engine: foliate-js

- **Licence: MIT** (© 2022 John Factotum) for every file used. Its zip reader
  (`vendor/zip.js`) is a build of `@zip.js/zip.js` 2.8.22, **BSD-3-Clause** (needs its notice in
  a third-party notices file); `vendor/fflate.js` (MIT) only loads for MOBI. PDF.js (Apache-2.0)
  and `pdf.js` are **not** vendored. Pinned to commit `78914ae` (2026-05-01) — the npm package
  (1.0.1, 2025-04) is a year older and the README asks to pin the repo. Two small patches,
  documented in `vendor/foliate-js/VENDORED.md` (PDF branch removed; a render race guarded).
- EPUB 2/3, paginated and scrolled (per section), CFI locations, TOC, page list, search, TTS
  helpers; swipe that follows the finger is built in. Suitable — no reason to fall back to
  epub.js (last release 0.3.93, npm untouched since 2023; needs JSZip and does the same
  CSS-column pagination less accurately, per foliate's own README).

**Size** (production-style Vite 8/Rolldown build of the engine on its own,
`web/app/proto/reader/measure/`, minified; `measure.txt`):

| Loaded for an EPUB | raw | gzip | brotli |
|---|---|---|---|
| engine (view, CFI, progress, overlayer, wrapper) | 31.5 KB | 11.2 KB | 10.2 KB |
| epub.js | 21.7 KB | 8.1 KB | 7.4 KB |
| paginator.js | 21.1 KB | 7.0 KB | 6.3 KB |
| zip.js | 35.6 KB | 14.0 KB | 12.4 KB |
| **total JS** | **110 KB** | **40.4 KB** | **36.3 KB** |

Never fetched for an EPUB (separate lazy chunks): mobi 8.2, fb2 2.9, fixed-layout 2.3,
fflate 2.0, tts 1.8, search 1.1, comic 0.7 KB gzip. Fonts the reader adds: Newsreader 400
(22 KB) and 600 (24 KB) woff2; 400 italic is the app's own file. The entry chunk of that build is
2.5 KB and contains none of it.

**Time to the first page** — Chromium, 412 × 915 at 2.625×, touch, **CPU 4× slower**, the
built chunks and the book from disk, median of 5 cold page loads (each run imports the chunk
afresh):

| Book | first page | of which: chunk import · zip + OPF + nav | next page |
|---|---|---|---|
| War and Peace, 1.8 MB, 368 sections, from the start | **256 ms** | 3 ms · 72 ms | 183 ms |
| War and Peace, resumed at 50 % | **172 ms** | 3 ms · 70 ms | 118 ms |
| Peter Rabbit, 1.5 MB, 29 pictures | **223 ms** | 4 ms · 38 ms | 250 ms |
| Alice (Rackham), 1.5 MB, 38 pictures, at 50 % | **181 ms** | 4 ms · 51 ms | 122 ms |
| Metamorphosis, 0.3 MB | **208 ms** | 4 ms · 46 ms | 137 ms |

Well under the spec's < 1 s. Not included: fetching the chunk (≈ 40 KB gzip once, then the
service worker's cache) and reading the file from OPFS (phase 0: 8–70 ms). The opening flight
(380 ms) covers all of it. An emulated 4× CPU on a Mac is not a phone: one check on the owner's
Pixel is still worth it — the dev panel shows "Last open: … first page N ms" on the phone (dev
mode, unminified, so slower than production).

**Keeping it out of the entry and the precache** (production, same pattern as Regal/zxing):
the reader route imports the engine with `import()` only; `nuxt.config.ts` names it —
`codeSplitting.groups: [{ name: 'foliate', test: /foliate-js|reader\/engine/ }]`, chunk file
name `_nuxt/foliate.[hash].js`, `globIgnores: ['**/foliate*.js']` and a `CacheFirst`
runtime cache (`libellus-reader`) so it works offline after the first open. Without
`globIgnores` the precache's `**/*.js` would take it in. Plus a build check that the entry never
imports it (as for Regal).

## Effort to productionise (after the pick)

Shared, whichever variant (≈ 5–7 days): route `/book/:key/read` with the reader as a pushed,
immersive screen; the flight folded into `useBookFlight` (the hero → cover page hand-off and
back, interruptible like the push); engine + lazy chunk config + precache rule; settings store
and sepia as a third value in `design/tokens.json` (`build.mjs` writing a reader-only
`[data-theme='sepia']`, Swift side too); the progress writer through the progress repository
and outbox (#93) with the forward-only rule, the location (CFI) saved locally and server-side
(owner decision 3: a column/RPC + pgTAP); Start/Finish wired to the real stores; strip
`<script>`/`on*` from book documents (`book.transformTarget`) — foliate's iframes need
`allow-scripts`+`allow-same-origin`, and the app's CSP allows inline scripts; add `frame-src
blob:` before the CSP is enforced; copy into `en.json`; parity.md; Playwright flows (open,
turn, Aa, Contents, progress write, end → Finish, Back) and an Android emulator script;
DESIGN/MOTION entries; third-party notices (zip.js).
Per variant on top: **a ≈ 1 day**, **b ≈ 1.5 days** (chapter hand-over, a precise CFI in
scrolled mode, the scroll-up rule), **c ≈ 2 days** (running heads/folios in foliate's
marginal bands, spread + gutter, fade turn, ribbon). A **switch between pages and scroll** in the
Aa sheet costs little once one variant is built (foliate changes flow without reloading).

## Recommendation

**c — Printed page, with a's middle-tap bars available as its chrome if the capsule feels too
small**, and the Aa sheet's **Edge to edge** + **Tight** as first-class settings. Reasons: it is
the calmest (fade turn, no chrome needed to know where you are), it is the most Libellus (a
book as an object: running head, folio, the lamp ribbon for saved progress, facing pages on
a tablet), and it costs only ~1 day more than a. Keep **scroll as an option in the Aa sheet**
rather than a separate design — b's top hairline and floating chapter port over as its scroll
mode. If the owner prefers a page that slides under the finger to a fade, a is the safe
choice; the shared parts are identical.

Open points for the owner: the fade vs slide turn (try both on the phone); whether *Start
reading?* should wait for the first page turn instead of asking on opening; whether "min left"
should learn the member's own pace (foliate's estimate is bytes/1600 per minute, rough for
markup-heavy books); Fullscreen (hiding Android's status bar) as an option in the installed app.

## Files

- `shots/` — per variant `a|b|c-light|dark|sepia.jpg` (reading), `*-chrome-*.jpg` (bars/capsule),
  pictures in sepia/dark, edge-to-edge vs normal, the scroll's chapter end, the sheets
  (`sheet-type-*`, `sheet-contents-*`), `start-reading-*`, `end-of-book-*`,
  `end-finish-sheet-sepia`, `progress-saved-a`, `progress-saved-c-ribbon`, `progress-behind-a`,
  the stand-in book page (`book-page-*`), the spread (`c-spread-tablet-sepia`, 1280 × 800).
- `strips/` — `open-a-cover-page-light` + `back-a-light` (hand-off onto the cover page and back),
  `open-b-resume-dark` + `back-b-dark` (resume mid-book: dissolve), `turn-a` (slide),
  `swipe-a` (follows the finger), `turn-c` (fade). Opening/back frames are Web Animations slowed
  5× via CDP; turns are a real-time screencast.
- `measure.txt` — the raw engine numbers; `scripts/` — shoot/strip/measure scripts;
  `dev.sh` — the LAN dev server (port 3127).

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

---

# Round 2 (owner feedback, 2026-10-06): a + c, scroll as a setting, select → translate / define / copy / search / highlight

**Owner:** likes both **a** and **c**; **b becomes an option** in their settings; selected text needs
a menu with **Translate, Define, Copy, Search** and **highlighting in fixed colours**, results in a
bottom sheet like Google Books; variants of the menu welcome. Search was not built yet — a first
version is in now (below), the rest can follow.

Try it: http://192.168.178.81:3127/prototype/reader?v=a (or `v=c`); on the phone **long-press a
word** (or drag the handles over a passage). The panel's *Select words: menu* switches the menu
design; address flag `menu=bubble|dock|peek`. Screenshots: `round2/`.

## Scroll is a setting now
The Aa sheet starts with **Pages | Scroll**. Scroll gives a and c b's way of reading (one long page
per chapter, the lamp hairline at the top edge, the chapter floating, bars on scroll-up, *Next
chapter* at the end); Pages brings back the variant's own pages. The place is kept across the
switch (foliate changes flow without reloading). `round2/aa-scroll-c-sepia.jpg`,
`round2/c-scroll-light.jpg`, `round2/c-scroll-chrome-light.jpg`. (`v=b` still opens b directly.)

## The selection menu — three designs, the same actions
Every design: **Translate · Define · Copy · Search**, then the four highlight colours (**Lamp,
Sage, Sky, Rose**; fixed, the same in every room) and, on a highlight that was tapped,
**Remove**. Define is offered for one or two words; a passage goes to Translate.

1. **Bubble** (default) — an ink card by the words with a small tail pointing at them, the actions
   on top, the colours under a hairline. On a phone it sits **below** the selection, because
   Android draws its own Copy / Share / Select all bar above it; with a mouse it sits above.
   Closest to Google Books and Apple Books. `round2/menu-bubble-a-light.jpg`,
   `round2/menu-bubble-c-dark.jpg`, `round2/highlight-tapped-c-light.jpg`.
2. **Dock** — the same in a glass bar risen at the bottom edge (like the tab bar), with the
   selected words quoted on top. Never covers the words or fights Android's toolbar, always under
   the thumb; one more glance away from the words. `round2/menu-dock-c-sepia.jpg`,
   `round2/menu-dock-a-dark.jpg`.
3. **Peek** — Google Books one step further: a low panel at the bottom that **already shows the
   answer** — a single word's first meaning (with its part of speech), a phrase's translation
   (with "EN → DE") — and the actions and colours under it; a tap on the answer opens the full
   sheet. Fastest for language learners; it looks things up on every selection (debounced, phrases
   only up to 300 characters, because the free translation tier counts characters).
   `round2/menu-peek-word-a-dark.jpg`, `round2/menu-peek-phrase-a-dark.jpg`,
   `round2/menu-peek-word-c-light.jpg`.

My pick: **Bubble** as the default, with **Peek's instant answer** as an option for readers in a
second language. Dock is the safest on Android, but it puts the menu far from the words.

Behaviour in all three: a tap beside the menu, Escape or **Back** close it first (before the
chrome and the reader); a tap on a highlight opens the same menu for it (change colour or
remove); highlights are drawn as a soft wash multiplied into the paper (light, sepia) or a plain
tint in the dark; they are kept per book on the device in the prototype (production: with the
reader's location, server-side if the owner wants them on other devices too — later issue,
"highlights/notes export" is a non-goal of #131 v1).

## Translate and Define (bottom sheets)
- **Translate** sheet: the selected words in the serif italic, "English → **Deutsch** ⌄" (the target
  is a native select, kept per device; default: the phone's language, or German), the translation
  in the serif at input size on a quiet fill, and in the smallest type who answered. A word gets a
  *Define* link, Define a *Translate* link. `round2/translate-sheet-a-light.jpg`.
- **Define** sheet: the headword in the serif, each part of speech as an eyebrow, senses numbered
  in mono, an example in the serif italic where there is one, "From Wiktionary · CC BY-SA" at the
  foot. `round2/define-sheet-c-sepia.jpg`.
- Offline: both say they need a connection (on-device translation excepted).

## Which translator (free, ideally)
| Option | Cost | Key | From the app directly? | Quality / notes |
|---|---|---|---|---|
| **Chrome's built-in Translator API** | free, on device | no | yes | Private, offline after the model download. **Desktop Chrome 138+ only — Chrome's docs say it does not work on mobile**, so not on the owner's phone today. Use it first where it exists. |
| **DeepL API Free** | 500,000 characters / month free | yes | **no** (DeepL blocks browser calls: CORS) | Best EN↔DE quality. Its support page now says the Free plan "can no longer be purchased" — check at sign-up that a new free key is still issued. |
| Azure AI Translator (F0 tier) | free monthly allowance (2 M characters at the time of writing — verify) | yes | possible, but the key would be public | Good quality; key belongs on a server anyway. |
| Google Cloud Translation | first 500,000 characters / month free, needs a billing account | yes | key would be public | Good quality. |
| **MyMemory** (used in the prototype) | free; **5,000 characters / day** per device anonymously, 50,000 with an email | **no** | **yes** (CORS) | Fine for words and short phrases, weaker on long passages; 500 bytes per request (the prototype sends sentence by sentence). |

**Recommendation:** a small **Supabase Edge Function `translate`** (the app already runs on
Supabase) that holds the key in Supabase's secrets — the key never ships in the app — caches
answers by text and language, and rate-limits per member; behind it **DeepL API Free** if a free
key can still be had (else Azure's free tier). The app asks the **on-device translator first**
where the browser has one. Budget: a reader translating 50 passages of 200 characters a day uses
~300,000 characters a month — inside DeepL's free 500,000 for one member. MyMemory stays as the
no-account fallback (and is what the prototype uses today, so it works on the phone with no
setup). **Define:** English **Wiktionary**'s REST definitions — free, no key, CORS, multilingual
headwords with English senses; its licence (CC BY-SA) needs the credit line the sheet shows.
Production effort for this part: ≈ 2 days (edge function + secrets + cache + quota handling, the
sheets in `en.json`, Playwright with recorded answers, offline states).

## Search (first version)
Search from the selection menu (opens with the words in the field) or from the chrome's
magnifier (a's and the scroll's top bar, c's capsule): a `UiSheet` with one field, the places
streaming in chapter by chapter ("Searching… 40 % · 12 found"), each place a line of the book
with the words lit; a tap goes there and the places stay outlined in the lamp colour on the page.
foliate's own `search.js` does the matching (locale-aware, accent- and case-insensitive).
`round2/search-sheet-a-sepia.jpg`, `round2/search-on-page-a-sepia.jpg`. Follow-ups for later:
next/previous place without reopening the sheet, a result count per chapter, whole-word option,
searching a 3,000-page book in a worker.

## Engine cost of round 2
No new engine code: highlights and search are foliate's own (`overlayer.js` was already in the
engine chunk; `search.js` is its own 1.1 KB gzip chunk, fetched only when the member searches).
The lookups (`lookup.ts`, the sheets, the menu) are app code of the reader route, a few KB.

---

# Round 3 (owner, 2026-10-06): the bubble only; no browser bar over the words, on Android and iOS

- **Bubble is the only selection menu.** Dock and Peek are gone (code and switches); Round 2's
  description of them stays above for the record.
- **The browser's own selection bar never shows.** No web page can keep the browser's text
  selection and hide its bar (Chrome on Android: Copy · Select all · Web search · Share; Safari on
  iOS: Copy · Look Up · Translate · Share) — it is system UI. So on touch screens the reader
  **selects by itself**, as Readest (also built on foliate-js) does: the browser's selection is off in
  the page (`user-select: none`, `-webkit-touch-callout: none`, no `contextmenu`/`selectstart`),
  and
  - **long-press** a word (450 ms, finger still) selects it, with a short buzz on Android;
  - **keep the finger down and move** to stretch the selection word by word, either way (foliate's
    swipe never sees these moves, so the page does not turn);
  - **two lamp-coloured handles** (a stem from the line, a knob under it, 44 px to grab) stretch it
    afterwards; the bubble waits while a handle moves; the selection is drawn as the lamp's soft wash;
  - words come from `caretPositionFromPoint` (or WebKit's `caretRangeFromPoint`) and
    `Intl.Segmenter` in the book's language — both in Chrome on Android and Safari on iOS;
  - a tap beside it, Back or Escape lets it go; in scroll mode a scroll does too.
  With a mouse (desktop) the browser selects as usual: there is no bar to hide.
- **The bubble sits above the words** now (below only when there is no room above), its tail
  pointing down at them.
- Copy works without the browser's selection (a hidden field, the way iOS accepts it); on the LAN's
  plain http the Clipboard API is missing, so that path is the one used on the phone today.

**Checked:** Chromium, phone profile with real touch input (CDP touch events): long-press →
word, stretch, handle drag, the page does not move, the browser's own selection stays empty,
bubble above (`round2/touch-select-android-chromium.jpg`, `round2/touch-select-handle-drag.jpg`).
**WebKit (Safari's engine), iPhone 15 profile:** `-webkit-user-select: none` holds,
`caretPositionFromPoint` and `Intl.Segmenter` exist, the word/stretch logic, the handles (pointer
events) and the bubble work, Translate opens its sheet (`round2/touch-select-ios-webkit-sepia.jpg`,
`round2/translate-sheet-ios-webkit.jpg`). Playwright's WebKit cannot synthesise touches, so the
long-press itself was driven through the same engine calls the touch listeners make. **Still to
check on real devices:** the long-press on an iPhone (iOS sometimes starts its own loupe on a long
press even with selection off — `-webkit-touch-callout: none` normally prevents it) and the feel of
the handles on the owner's Android phone.

Production note: the reader's own selection needs its own accessibility path (VoiceOver/TalkBack
users select with the screen reader's text rotor, which does not use touch) — keep the browser's
selection when a screen reader is detected, or offer "Select text" from the chrome.

**Round 3, header:** a's top bar (and the scroll mode's) now follows the book page's `UiTopBar`:
no bar, no hairline — the round glass buttons float (Back at the left; Search and Contents at the
right, at the book page's inset), the title in the serif between them, and a short fade of the
room behind them (solid under the status bar and half the button row, then fading out) keeps the
title and the clock clear of the words. Scroll mode shows one line ("Metamorphosis · I").

## Round 3, c: search is the app's search palette
In c, the capsule's magnifier opens **the app's search palette** (`BookSearch.vue`) with the
**same morph as the tab bar → palette**: the palette is laid out at its open size from the first
frame, a `clip-path` grows from the capsule's outline to the palette's, the magnifier flies from
the capsule into the query row (the capsule's other buttons step back as the palette passes over
them), the veil and blur come in over the page, the surface and the results fade in at the same
stages (`overlay` in, `overlay-exit` out, `standard` curve). One Web Animations timeline per
direction, so a close turns an opening around wherever it is; Reduce Motion cross-fades in place;
swipe down, Escape, Back, Cancel or a tap on the veil close it; it rides on the iOS keyboard like
the app's.
- The query row is the app's (accent magnifier, field, clear, Cancel), the results above it: **the
  next place after where you are sits right by the query** ("II · next"), further places above it,
  then a "Before where you are" rule and the places before you. Each place is a chapter eyebrow
  and two lines of the book with the words lit; a lamp hairline sweeps above the query while the
  book is searched, then "25 places".
- A tap on a place goes there (the places stay outlined in the lamp colour on the page), the
  palette turns back into the capsule, then the capsule steps away.
- Search from selected words in c opens the same palette (a fade, as there is no capsule then).
  a and the scroll mode keep the Search sheet.
- **Progress no longer moves for look-ups:** a jump by Search, Contents or the scrubber is not
  reading — progress waits until the member reads on from there (turns a page, scrolls).

**Reuse:** `SearchOverlay.vue` cannot be dropped in as it is — it is wired to the catalogue's
search store, the tab bar's `[data-morph]` capsule and its Home/Library tabs. The prototype carries
a faithful copy of its palette and morph (same parts, tokens, keyframes, stages). **Production:**
extract the palette shell and the morph from `SearchOverlay` into one component (`UiPalette`:
veil, plate, shade, query row with a slot for its leading part, results slot, `morph from <element>`)
that both the app's search and the reader use; ≈ 1 day including the e2e of both.
Strips: `round3/c-search-morph-open-light.jpg` (capsule → palette → results, slowed 5×),
`round3/c-search-morph-close-pick-light.jpg` (a place picked → palette back into the capsule →
the page, places outlined), `round3/c-search-palette-dark-sepia.jpg`.

## Round 3, c: the page slider (scrubber)
Three ways in, one slider:
1. **Tap "20 % · 76 left" in the capsule** (it says where you are, so it moves you): the capsule grows
   across the column into a slider (the palette's clip-path morph, `standard`; Reduce Motion: in
   place). Drag anywhere on the track — the page behind follows the thumb (at most every 140 ms, as
   a new chapter has to load; the last position always), a glass label over it says "III · p. 62 of
   96". Ticks mark the chapters, a darker tick the page saved as progress. **"↻ p. 20"** at the left
   takes you back to where you were when it opened; the check, a tap on the page, Back or Escape put
   it away (it shrinks back into the capsule). Arrow keys move a page, Page Up/Down ten.
2. **Press and hold anywhere on the capsule (420 ms) and slide**: the slider opens under the finger
   and follows it in one gesture — the iOS space-bar-trackpad move; a short buzz on Android; the
   button under the finger does not fire. Let go and the slider stays open for fine-tuning.
3. **Contents**: the progress line at the top of the sheet is now the same kind of slider (drag, let go,
   the sheet closes on that page).
Scrubbing is looking, not reading: progress waits until you read on from the new place.
`round3/c-scrubber-light.jpg` (grow, drag, landed, hold-and-slide), `round3/c-scrubber-dark-and-contents-sepia.jpg`.

## Round 3: haptics on the slider, a as "Classic", a searches in the palette

**Haptics (Vibration API, through the app's `utils/haptics.ts`, as the progress wheel):** dragging c's
slider gives a light tick per page (in books over 200 pages one per 1 %, never closer than the
wheel's 40 ms, so a fast drag is a purr, not a buzz), a firmer one where a chapter begins, one at
either end; opening the slider (tap or hold), "↻ p. 20" and arrow keys tick once. The Contents
slider and a's bottom slider tick per page too. Android vibrates; iOS has no Vibration API — it
ticks only on taps (the app's switch trick), never while a finger drags, exactly like the wheel.

**Both styles as a setting:** the Aa sheet now starts with **Printed | Classic** (c | a), then
Pages | Scroll. Changing it switches the reader live, the place kept.
Is it hard to keep both? Not much, if the line stays where it is now. **Shared (≈ 85 % of the
reader):** engine, page CSS, settings, the opening flight, progress, Start/Finish/end page, the
selection and its bubble, Translate/Define, highlights, the search palette, Contents, the Aa sheet,
Back, wake lock. **Per style:** the chrome component (`ChromeQuiet` a, ≈ 70 lines; `ChromePrinted` c
with its slider, ≈ 400), how a page turns (slide vs fade, a few lines), c's running head and folio
(≈ 30 lines). The contract between them is one `ChromeInfo` and the same events, so a new feature
lands in the shared layer once; only something that lives *in* the chrome (like the slider) is
built per style. Cost in production: ≈ 1.5 days more than c alone, plus every reader e2e flow run
for both styles (parameterised, not duplicated). Recommendation: keep both — **Printed by
default, Classic as the alternative**.

**a's search is the palette now** (the scroll mode's too): it grows out of a's bottom bar (the
same morph, from the bar's own square corners instead of a capsule's round ends; the bar's
contents step back), the magnifier flies in from the top bar's button, everything else as in c.
The Search sheet is gone; Search from selected words opens the palette in every style.
`round3/a-search-palette-from-bottom-bar.jpg`, `round3/aa-style-printed-classic.jpg`.

## Round 3, last: the palette searches like the app's; Printed is the default
**The palette's search now behaves as the app's** (`components/search/Results.vue` and
`Loading.vue`, copied into `BookSearch.vue` and `BookLoading.vue`):
- the query goes out after the app's typing pause (`SEARCH_DEBOUNCE_MS`); **nothing shows for that
  pause and a `quick` more**, so a book that answers at once shows no loading at all;
- until the first places come: **the little book riffling its pages** over "Looking through the
  pages…", and the **lamp hairline sweeping** along the divider above the query; while more places
  may still come, the hairline keeps sweeping under the list ("… places in this book so far");
- the palette **glides to its new height** over `standard`, growing up from the query, the loading
  state fading out where it stood, and **the nearest places rise in one after another**
  (`sm`, `instant` / 2 apart);
- **a newer query dims the places on screen to 60 %** instead of emptying them; its own replace
  them when they come;
- the far end of the list (the top) **fades out** under a mask, the count line padded below the fade;
  no places: "Nowhere in this book", the query, a hint;
- Reduce Motion: the book rests half fanned, no hairline, heights just change.
Measured on War and Peace (1.8 MB, 368 sections) at CPU ×4: the first places of "Natasha" are there
before the loading state would show; all 1,213 in ≈ 10 s, streaming in; "Borodino" (later in the
book) shows the loading state for ≈ 2 s, then 108 places. Accents are ignored ("Natasha" finds
"Natásha"). `round3/search-palette-loading-long-book.jpg`,
`round3/search-palette-arrival-and-dimming.jpg`. In production, `Loading.vue` takes its line as a
prop and both searches use it.

**Both styles stay; Printed (c) is the default.** Switch in the reader (Aa → the **Printed page** toggle, last in the list under Keep the screen on: on = Printed, off = Classic) or in
the Profile: a **Reader style** row opens a sheet with the two choices, each with a little drawing
of its page (`round3/profile-reader-style.jpg`). On the prototype page the Profile row is a
stand-in under the book: the real row belongs in Profile → Account (`components/profile/Account.vue`),
which phase 1 is changing right now (its Ebook folder row), so it is not touched here. Both places
write the same device setting.

**Owner, after round 3:** the Printed | Classic switch at the top of the Aa sheet was too prominent —
it is now a plain **Printed page** toggle at the bottom, under Keep the screen on (on by default;
off is Classic), with one line under the group saying what each looks like.
`round3/aa-printed-page-toggle.jpg`.

**Owner, after round 3: the search loading glitched.** One book answers in well under a second, so
a loading state that waits for the typing pause showed for a few frames — a flicker. Now there is
**no loading state, no height glide, no rows rising in**: only the palette's **lamp hairline**,
which starts sweeping along the divider **with the first keystroke**, keeps going through the typing
pause and the search, and fades out (`sheetExit`) once the answer is there; places on screen still
**dim to 60 %** while a newer query is on its way and are replaced in place. A single letter (too
short to search) gets a short sweep that lets go after the pause. `BookLoading.vue` is gone.
`round3/search-palette-calm.jpg`.

**Owner, after round 3: the Aa sheet's controls, sepia first, "Classic mode".**
- **Concentric corners:** a selected segment (Pages | Scroll, Margins, Line spacing) has the group's
  radius less the gap around it, `calc(radius.md − space.xxs)` = 12 inside 14, so it sits in the
  group's curve. Its lift is a hairline and a tight contact shadow.
- **Switches:** the knob wore `shadow-button` (0 6 px 18 px), which on paper spread far outside the
  24 px track — the glow beside it when off and the boxy patch when on (invisible in the dark, which
  is why only light showed it). Now a hairline and a tight contact shadow inside the track.
  `round3/aa-switch-before-after.jpg`, `round3/aa-segment-before-after.jpg` (before | after, 4×).
  Production: the Profile's theme switch (`profile/Account.vue`) has the same knob — one `UiSwitch`
  for both, with this shadow.
- **Sepia is the reader's default room, whatever the app's theme**; Light and Dark are a tap away.
- The style toggle is now **Classic mode** (off by default = Printed; on = the classic bars), with
  the Profile row saying "Classic mode" too. `round3/aa-sepia-default-classic-mode.jpg`.

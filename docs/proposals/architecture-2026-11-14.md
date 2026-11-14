# Architecture review: module-deepening refactors (2026-11-14)

The test question for this repo is whether an agent can find its way in it. I walked the screens a
member actually uses (Book page, author page, Notes chapter, buddy read room, friend page and shelf,
Library, Home) and looked for the skill's seams: concepts that force a reader to bounce between small
files, pure helpers whose tests pin the safe part while the risk sits at the call site, and
copy-pasted solutions where the repo already has a thin-adapter pattern that worked
(`memberShelfFromFinished` over `memberShelfDocument`).

The good pattern, for reference: `coverImage(book, size, hosts)` in `web/app/utils/coverRef.ts` is the
one place a Book's cover image is decided, and ~57 call sites use it correctly. Every item below is
consistent with that shape: one module owns the concept, callers hand in what varies. Nothing below
proposes a competing cover abstraction, a framework migration, a schema redesign, or anything needing
a product decision.

## Recommended refactors, most valuable first

### 1. One voice press-to-play owner for both thread pages
- **Action**: Extract the duplicated press-gate + signed-URL + double-tap-like logic from the two thread pages into a single composable, and delete the copies.
- **Files/modules**: `web/app/pages/notes/[book]/[chapter].vue` (~lines 439–485: `voicePress` + `playVoice`), `web/app/pages/together/[id]/[section].vue` (~lines 318–365: same two functions, same shape).
- **Change**: New `web/app/composables/useVoicePress.ts` owns the whole interaction: capture-phase press interception, the `previewOf` early-out, the veil/`open` check, the signed-URL fetch with reuse, the in-flight double-tap race (`press.liked`), and pause/resume of the already-playing key. Each page keeps only its two differences as arguments: the like emoji and the archived/veil predicate. The two near-identical `Press`/`lastPress` blocks and the two `playVoice` functions go away.
- **Boundary**: `useVoicePress({ items, view open check, react, notice, voicePlayer })` with `onPress(event: MouseEvent): void` — one function, wired once at the thread root's `@click.capture`. Max two companions: the shared `DOUBLE_TAP_MS` constant.
- **Tests**: Add a boundary test driving the composable through its four races (second press while URL in flight likes-and-does-not-play; press on playing key pauses without fetching; press on a `previewOf` key is ignored; failed sign returns the play-failed notice) — all currently untestable page inline code. No existing shallow tests become redundant; there are none for this logic, which is exactly the gap.
- **Priority**: Must
- **Why**: This is the call-site-risk pattern at its purest: ~50 lines of subtle async race logic per page, zero tests, and the two copies already differ (`NOTE_EMOJI[0]` vs `EMOJIS[0]`, `archived` check only on one side), so the next fix will land on one copy and not the other.

### 2. One reaction-toggle rule instead of two
- **Action**: Merge the two identical optimistic-reaction helpers into one owner and point both threads at it.
- **Files/modules**: `web/app/utils/buddyRead.ts` (`reactedBy`, ~line 91) and `web/app/utils/notes.ts` (`reactedNote`, ~line 160).
- **Change**: Move the rule ("another emoji replaces hers, the same one takes it back, counts decrement and zero-count rows drop") into a single function owned by `web/app/utils/roomThread.ts` next to the other shared thread rules, e.g. `toggledReaction`, generic over the reaction row shape both call sites already share (`{ emoji, count, mine }`). `reactedBy` and `reactedNote` become thin re-exports or are deleted with their call sites updated (both stores import it directly).
- **Boundary**: `toggledReaction(reactions: readonly Reaction[], emoji: string | null): Reaction[]` — one pure function.
- **Tests**: Keep one boundary test (the buddy one, `tests/buddy-read-utils.test.ts` coverage, or the notes equivalent) and delete the other; today two suites pin the same truth and a rule change must be made twice.
- **Priority**: Should
- **Why**: Bit-for-bit the same rule in two files is how the repo's spec bugs happen: a reader fixing optimistic likes finds one copy, tests it, and ships while the other thread still misbehaves.

### 3. One quote owner for both threads
- **Action**: Give `roomThread.ts` full ownership of quote resolution, including the server-quote shapes only Notes uses today.
- **Files/modules**: `web/app/utils/roomThread.ts` (`quoteOf`, ~line 141), `web/app/utils/notes.ts` (`noteQuoteOf` ~line 216, `replyChipOf` ~line 232), call sites in `web/app/pages/notes/[book]/[chapter].vue` (lines ~171, ~227) vs `web/app/pages/together/[id]/[section].vue` (lines ~170, ~198).
- **Change**: Extend `roomThread`'s `quoteOf` with a resolver callback for "the server already told us what this quotes" (Notes' `hidden`/`removed`/`note` kinds, which carry no jumpable id), so the buddy page keeps calling `quoteOf` and the Notes page calls it too instead of the parallel `noteQuoteOf`. `replyChipOf` (composer preview: name + first 120 chars) is the same truncation rule both pages need — move it next to `quoteOf` and use it in both composers.
- **Boundary**: `quoteOf(items, replyTo, words, resolveServer?)` and `replyChipOf(item, words)` — two functions, both in `roomThread.ts`.
- **Tests**: Add boundary tests for the server-quote shapes (`hidden` → no id + hidden words; `removed` → deleted words; `note` with id present/absent) at the `roomThread` level; the existing thread-view tests (`tests/buddy-thread-view.test.ts`, `tests/notes-thread-view.test.ts`) keep passing unchanged as call-site coverage.
- **Priority**: Should
- **Why**: Two vocabularies for one concept (`quoteOf` vs `noteQuoteOf` + `replyChipOf`) force every quote fix to be reasoned about twice, and the truncation/preview rule already exists in triplicate.

### 4. Delete the `buddyThread.ts` shim or give it a reason to exist
- **Action**: Remove `web/app/utils/buddyThread.ts` as a module; point its consumers at `roomThread.ts` directly.
- **Files/modules**: `web/app/utils/buddyThread.ts` (34 lines, nearly all a re-export block of `roomThread` names — the source of the build's `Duplicated imports` warning for `REPORT_NOTE_MAX`/`reportInput`/`quoteOf`/`bubbleKey`), `web/app/pages/together/[id]/[section].vue` (line 37), `web/app/tests/buddy-thread-view.test.ts`.
- **Change**: The buddy page imports `threadItems`, `quoteOf`, `sameAuthorRun`, `VOICE_UNSIGNED` from `~/utils/roomThread` directly; the only thing `buddyThread.ts` adds — the `ThreadContext` adapter binding `BuddyErrorCode` — moves into the page (or into `utils/buddyRead.ts` next to `buddyErrorKey`) as the two-line wrapper it is. Net effect: one file deleted, one warning gone, one fewer hop for every reader tracing a buddy thread.
- **Boundary**: No new interface; the boundary is `roomThread.ts`'s existing `roomItems` + `RoomThreadContext`, with the buddy error-code adapter at the call site.
- **Tests**: Update `tests/buddy-thread-view.test.ts` imports only; no behavior change, so no new tests — the test's value is unchanged, it just stops pinning the shim.
- **Priority**: Should
- **Why**: A module whose interface is identical to another module's is the definition of shallow, and this one is load-bearing confusion: it makes readers believe buddy threads have their own view model when they don't.

### 5. One pending-link store for share, follow, and buddy-read links
- **Action**: Merge the three near-identical pending-link modules into one owner with one key scheme, one TTL, and one take/peek shape.
- **Files/modules**: `web/app/utils/pendingShare.ts`, `web/app/utils/pendingFollow.ts`, `web/app/utils/pendingBuddyRead.ts` (each ~60 lines: keep/peek/take + token-in-path + to-open), orchestrated by `web/app/utils/signedOutRoute.ts` (`signedOutDestination`) and consumed in `web/app/middleware/auth.global.ts`, `web/app/pages/share.vue`, `web/app/pages/t/[token].vue`, `web/app/pages/f/[token].vue`.
- **Change**: New `web/app/utils/pendingLink.ts` owns the concept "something she opened while signed out, kept through sign-in": `keep(kind, value)`, `peek(kind)`, `take(kind)`, and the path-token parsers as data (one 22-char token shape shared by follow and buddy-read; share's payload shape as the third kind). The three modules become re-exports or are deleted. Priority order (share before follow before buddy-read) stays exactly where it is — in `signedOutRoute.ts`, which is the one place that says where a signed-out visitor goes.
- **Boundary**: `keepPending(kind: 'share' | 'follow' | 'buddyRead', value: string): boolean`, `takePending(kind): string | null`, `pendingToOpen(...)` — three functions, one TTL constant.
- **Tests**: Collapse the three pending-link test files' overlapping cases (malformed token dropped, hour TTL expiry, take-forgets) into one boundary suite; keep one test pinning the share-beats-follow-beats-buddy priority in `signedOutRoute`.
- **Priority**: Should
- **Why**: Three files with the same keep/peek/take/TTL shape and two with the same token regex are a copy-paste waiting for its first divergence — today a TTL or prefix change must be made in three places.

### 6. One voice-path policy instead of two mirrored ones
- **Action**: Unify the object-naming and JSON-parsing rules for voice recordings; keep the bucket names and the Notes-private-only rule as parameters, not as parallel implementations.
- **Files/modules**: `web/app/data/buddyVoice.ts` (`voicePath`: `<read>/<author>/<client>.<ext>`, `voiceFromJson` with `duration_ms`, ~lines 50–100) vs `web/app/data/noteVoice.ts` (`notePath`: `<author>/<room>/<client>.<ext>`, `voiceFromNoteJson` with camelCase `durationMs`, ~lines 19–35).
- **Change**: Move the shared policy — allowed mimes (`voiceMime`), extension mapping (`voiceExtension`), `prepareVoice` limits handshake, `sendablePeaks` thinning, and the signed-URL-never-stored rule — behind one owner (extend `buddyVoice.ts` into a `voice.ts` both import, or keep `buddyVoice.ts` as the owner and make `noteVoice.ts` the thin adapter the shelf precedent blesses). What stays per-caller: the bucket name, the path-segment order, and the JSON key-case adapter — each a one-liner, each visibly the only difference.
- **Boundary**: `voicePath(parts)`, `prepareVoice(voice)`, `sendablePeaks(peaks)` — owned once; per-caller adapters `notePath(...)` / `voicePath(...)` keep their names so call sites don't churn.
- **Tests**: Add one boundary test asserting the two path builders produce the shape the database's `private.*_voice_path` functions expect (today verified only by reading SQL comments); the existing `tests/buddy-voice.test.ts` / `tests/notes-voice.test.ts` limit tests collapse to one suite.
- **Priority**: Later
- **Why**: The limits, waveform rules, and expiry policy are already shared by comment reference ("the buddy reads'", "docs/parity.md"), which means a limit change in one file silently invalidates the other's comments — ownership should be code, not prose.

### 7. Fold `friendsView`/`feedView` appliance functions into `data/feed.ts`'s boundary
- **Action**: Move the feed-list algebra (`mergeFirstPage`, `withoutDoubledReviews`, `withoutMember`, `appendPage`, `copyTimeLabel`, `copyTakenAt`) next to `feedDays` in `data/feed.ts`, and leave `feedView.ts` owning only words (verb keys, empty states, day labels).
- **Files/modules**: `web/app/data/feed.ts` (`feedDays`, ~line 100), `web/app/utils/feedView.ts` (120 lines, half list-algebra half wording), `web/app/utils/friendsView.ts` (imports both `feedDays` and `feedBatchKey`/`feedVerbKey`, ~line 1–3).
- **Change**: `data/feed.ts` becomes the one owner of "entries in, rows out, pages joined" (pure, framework-free, already tested in Node); `feedView.ts` keeps "rows to words" (day labels, verb/batch keys, empty states, copy labels). `friendsView.ts` then imports list logic from one module and wording from one module instead of straddling both. No call-site behavior change: Home's Friends and the feed page call the same functions from their new home.
- **Boundary**: `feedDays(entries, dayOf)`, `mergeFirstPage(current, fresh, following?)`, `withoutDoubledReviews(entries)`, `appendPage(current, page)` — all in `data/feed.ts`; `feedView.ts` keeps `feedVerbKey`, `feedBatchKey`, `feedEmptyState`, `feedDayLabel`.
- **Tests**: Move the list-algebra tests to the `feed` boundary suite; keep the wording tests where they are. The seam this kills is real: `withoutDoubledReviews` must run before batching, but nothing in the module layout says so — one owner can document and enforce the order.
- **Priority**: Later
- **Why**: A reader asking "how does the feed list work" currently assembles the answer from a data file and two utils files; the ordering constraint between dedup and batching lives only in a comment.

## What I did not look at

- **The database and edge functions** (`supabase/functions/**`, the `buddy_*`/`room_*`/notes migrations): the N3 convergence question from the brief needs SQL-level verification I did not do — item candidates there are deliberately absent, and the "two parallel thread layers" framing is unverified beyond the client seam (the `buddyThread.ts` shim and the `buddy*` vs `note*` mirrors above).
- **Importers, ebooks, and export** (`data/import/**`, `data/ebooks/**`, `data/export/**`, `BookImport` flows): the largest data-layer surface by line count (~3.9k lines in `data/import` alone); covered only by listing. A whole review could be written about importer mapping drift.
- **Library sorting/filtering** (`data/libraryView.ts`, `stores/libraryView.ts`, `pages/library.vue`): read enough to confirm `arrange`/`matches`/`sortLibrary` form a coherent boundary already — no item proposed, but not stress-tested against the "dangling client sort" pattern.
- **Enrich/authors/series** (`data/enrich/**`, `utils/enrich.ts`, `MoreFromAuthor`, author page): read `newestFirst`/`moreFromAuthor`/`workBookKey` closely; the teaser-vs-page ordering split is deliberate and documented, so no item — but the prefetch path (`coversToPrefetch` + per-component `coverHosts`) was not traced end to end.
- **Avatar/member-photo pipeline** (`data/avatar.ts`, `stores/avatar.ts`, `stores/memberPhotos.ts`): confirmed `MemberCard.photo` is a storage path resolved through a download cache (the good shape — no URL/path confusion found there), but did not audit every avatar call site.
- **Perf, motion, and the reader** (`perf/`, `docs/perf/`, `components/reader`, foliate): out of scope for a module-depth review; untouched.
- **E2E/typecheck/supabase stacks**: per the brief, none were run; every claim above is from reading code and tests, with line numbers as given.

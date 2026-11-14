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

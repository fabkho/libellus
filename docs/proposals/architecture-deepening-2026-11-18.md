# Deepening the app's modules: eight refactors

Assessment, 18 November 2026. No code in this document. It is the record of a codebase-architecture review
of `web/app/` (604 TypeScript and Vue files, ~86 000 lines) done with a deep-module eye: where a rule lives
in a module's *primitives* while every caller re-assembles it, where one concept needs seven files to
understand, and where a subsystem has no test at its boundary because the boundary does not exist yet.

Each item below states the friction, the proposed boundary, what it would hide, the tests it creates or
retires, the risk, and the effort. Four items are being planned or started now (marked **now**); the rest
are recorded to be revisited (**later**).

Vocabulary: *deep module* — a small interface hiding a large implementation (Ousterhout). *Boundary* — the
1–3 functions or composables a caller would see.

## Status

| # | Item | Priority | State |
|---|---|---|---|
| 1 | One cover resolution service | Must | **go** — 2 commits |
| 2 | One thread-screen composable | Must | **go** — app-only, not a layer |
| 3 | One `BookIdentity` module | Must | plan done; land before #5 |
| 4 | One shelf-row / status view model | Should | **go** — status first, covers already solved |
| 5 | Lift the upload seam off the match engine | Should | **go** — engine stays, 3 commits |
| 6 | The reader's test boundary (+ session composable) | Should | plan done — steps a, b, d; not c |
| 7 | `useDragReorder` out of `EntryList.vue` | Should | **go** |
| 8 | Split `useBookFlight` | Later | **dropped** — no duplication to remove |

## 1. One cover resolution service

### The friction

The cover chain — Apple artwork → Apple by ISBN → OpenLibrary → Placeholder — is a domain rule
(`app/data/covers.ts:233` `resolveBookCover`, `:324` `resolveOwnCover`), but the module only exposes the
chain's *primitives* plus a dependency bag (`CoverSources`, `:181`). Every caller re-assembles the bag by
hand:

- `app/stores/library.ts:415-422` — `withCover()`
- `app/stores/collections.ts:272-279` — a byte-identical copy of `withCover`
- `app/stores/edition.ts:327-332` — `useOwn()` builds the same sources for `resolveOwnCover`

Three stores know that Apple's ISBN lookup is reached through `search.repository()`, that the prober is
`probeImageInBrowser`, and in what order. A fourth source, or a time budget, means three edits kept in sync;
a divergence is silent and shows the wrong cover on "add to a collection".

### What stays outside

`app/data/coverFill.ts` (the import's background fill, its own pacing and budgets), `app/data/coverUpgrade.ts`
(one-time post-import Apple upgrade, larger-only), `app/data/ownEdition.ts` (form draft and validation),
`app/utils/ownCoverPath.ts` (`/c/<key>/<width>` addresses for stored copies) — each consumes one primitive
and has its own lifecycle; none re-assembles the chain. `app/data/bookImport.ts:906,912` keeps its
probe-only path (the legacy engine is item #5's business).

### The boundary

A new `app/data/bookCovers.ts`:

```ts
export type AppleIsbnLookup = (isbn13: string) => Promise<BookSnapshot | null>   // data/search.ts:121
export type BookCoversDeps = { probe: ProbeImage; lookupAppleIsbn?: AppleIsbnLookup; budgetMs?: number }

export type BookCovers = {
  resolveCatalogue(book: BookSnapshot | Book): Promise<ResolvedCover>   // was covers.ts resolveBookCover
  resolveOwn(book: BookSnapshot): Promise<ResolvedCover>               // was resolveOwnCover
  verifyAddress(url: string, budgetMs?: number): Promise<ResolvedCover | null>  // was verifyCover
}
export function createBookCovers(deps: BookCoversDeps): BookCovers
```

`lookupAppleIsbn` is **optional** so the probe-only callers keep typechecking; the stores always pass it.
Home of the wiring is a new `app/composables/useBookCovers.ts` (Nuxt side, may import stores) that hands
`createBookCovers` the browser prober and a *lazy* closure `(isbn13) => useSearchStore().repository()
.lookupAppleIsbn(isbn13)` — the closure keeps working when the `Search` repository is rebuilt for a
language change (`stores/search.ts:122-129`), which a captured instance would not. `search.ts` and
`useBackend.ts` are untouched.

Afterwards `stores/library.ts withCover`, `stores/collections.ts withCover` and `stores/edition.ts useOwn`
each become one line — `await useBookCovers().resolveCatalogue(book)` / `.resolveOwn(book)` — and lose their
`probeImageInBrowser` and `resolveBookCover`/`resolveOwnCover` imports. The early return for an already-in-
the-Catalogue Book (`'id' in book`) stays verbatim: that is the "Catalogue keeps its first snapshot" rule.

### Tests

New `tests/book-covers.test.ts`, pure and network-free (fake prober keyed by URL, fake
`lookupAppleIsbn` recording its arguments). It pins: the chain order Apple artwork → Apple by ISBN →
OpenLibrary by id → OpenLibrary by ISBN; a `low` image kept as fallback while the chain continues;
`tooSmall`/`placeholder` skipped; a timeout or unreadable own cover kept without thumbhash or colours;
`lookupAppleIsbn` called exactly once, and never when the Book has no ISBN; `resolveOwn` keeping an
arbitrary https URL as it is; `verifyAddress` treating ok/low as a cover and a flat image as none.

New `tests/cover-chain-call-sites.test.ts` — a source-text guard, the pattern the repo already uses
(`tests/own-cover-call-sites.test.ts` guards a different thing: display binding). It fails when
`resolveBookCover|resolveOwnCover|verifyCover|CoverSources|lookupAppleIsbn` appears in `app/stores/*.ts`,
and when a `CoverSources` object literal (`probe:` next to `lookupAppleIsbn:`) exists outside
`app/data/bookCovers.ts` and the tests.

### Risk and ordering

Green after every step: (1) add `bookCovers.ts` + `useBookCovers.ts`, unused; (2) add the boundary test and
the guard; (3) migrate one store per commit — `library.ts`, then `collections.ts`, then `edition.ts`; (4)
delete the dead imports and grep `resolveBookCover|resolveOwnCover|probeImageInBrowser|CoverSources` under
`app/stores` and `app/composables` — only `useBookCovers.ts` may answer.

What could shift silently: the placeholder shape (`{coverUrl:null,…}` spread into `{...book,...cover}`), the
default budget (`budgetMs ?? 6000`, which must live in the factory and not per store), and the thumbhash and
colour derivation, which must stay inside `covers.ts` rather than be reimplemented. `localData.ts` and
`deviceLibrary.ts` only persist the resolved snapshot; no cache rule changes.

### Effort

Two new files, one new pure test, one guard, three one-line store bodies. **Two commits**: (A) the boundary,
the composable and the tests; (B) the store migration plus the guard. No migration, no copy, no e2e.

## 2. One thread-screen composable

### The friction

`app/pages/notes/[book]/[chapter].vue` (740 lines, 467 in `<script>`) and
`app/pages/together/[id]/[section].vue` (506 lines, 343 in `<script>`) implement the same pipeline:
open/`openThread` on a `view.open` watcher, an online-reconnect watch, `loadOlder`, send/sendVoice/retry/
discard/react, an `actionsOf`/`action` bar mapping, composer focus, delete and block confirms. The same
names appear in both: `actionsOf`, `action`, `answer`, `back`, `discard`, `focusComposer`, `quoteFor`,
`reportNote`/`reportMessage`. `app/utils/roomThread.ts` already holds the pure part (`roomItems`, `quoteOf`,
`replyChipOf`, `sameAuthorRun`, `toggledReaction`) — the stateful half was never extracted.

Third consumer: `/Users/fabkho/code/trappist/web/app/components/chat/ChatPage.vue` (997 lines, 518 in
`<script>`), which takes the same `@fabkho/ui` + `@fabkho/chat` layers and the same `useThread`.

### The home: this app, not a layer

**Recommendation: `web/app/composables/useThreadScreen.ts` in libellus.** The three-way share was an
illusion, and the layers' own rules forbid the other two homes.

Trappist's `app/components/chat/ChatPage.vue` (997 lines, 518 in `<script>`) does **not** implement this
pipeline. It has none of the page-level names the two libellus pages share — no `actionsOf`/`action`,
`retry`/`discard`, `answer`, `focusComposer`, `quoteFor`, `sameAuthorRun`, `reportNote`. Its queue
semantics live in the store and its template binds `:load-older="store.loadOlder" @retry="store.retry"
@reveal="store.reveal"` directly; `pages/inbox/[id].vue` is a 16-line redirect. The real overlap is the
already-shared base — `UiChatThread`/`UiBubble`/`UiComposer`, and the chat layer's `thread`/`veil`/`queue`
utils.

- `@fabkho/chat` cannot hold it: its rules are no words, no app imports (`~/`, stores, `#imports`), no
  Supabase, no components. A screen orchestrator words errors (`t(buddyErrorKey)`/`t(noteErrorKey)`), reads
  `useOnline`/`useI18n`/the router, and drives sheets — it breaks all three on its face.
- `@fabkho/ui` cannot hold it either: presentational components hold no app state, and
  `tests/ui-layer-overrides.test.ts` pins zero app overrides.
- The cost comparison is decisive: app code moves for free; a shared-layer change is a release, a tag, and
  a bump PR per consumer (libellus `docs/DEVELOPMENT.md` "The package bumps"; trappist keeps the same
  machinery).

What would change the answer: trappist adopting libellus's page-level orchestration **verbatim** — then the
stabilised, word-free part (codes and state only) is promoted to `@fabkho/chat` as a follow-up.

### The boundary

```ts
// app/composables/useThreadScreen.ts
useThreadScreen<Bubble, Item>(adapter: ThreadScreenAdapter, opts: ThreadScreenOpts)
```

The **adapter** is what each product supplies: `me`, `open`/`isOpen`, `nameOf`/`previewOf`, `errorWord`/
`retryable`/`quoteSourceOf`, `messagesOf`, `load`/`open`/`close`/`refresh`, optional
`peek`/`retain`/`send`/`sendVoice`/`retry`/`discard`/`react`/`delete`/`report`/`block`/`edit`/`voiceUrl`.
The **options** are capabilities and wording, never product branches: `emojis`, `likeEmoji`,
`canLike`/`canWrite`/`archived`, `sendExtras`, `extraActions(item)`, the offline/failed words, a testid
prefix.

It returns eight groups: `items`/`status`/`hasMore`/`loadOlder`; `text`/`replyTo`/`notice`/`fresh`/
`quoteFor`/`replyChip`; `send`/`sendVoice`/`retry`/`discard`/`answer`/`react`; `actions`/`action` plus the
sheet states; `voicePress`; `veil({showOpen, showAnyway})`/`back`.

`app/utils/roomThread.ts` (`roomItems`, `quoteOf`, `replyChipOf`, `sameAuthorRun`, `toggledReaction`,
`reportInput`) and `composables/useVoicePress.ts` already hold the pure parts and do not change. The two
pages keep only route and store glue: notes' script falls from 467 to ~120 lines, the buddy thread from 343
to ~100.

### Where the two features stay different

Deliberately outside the composable, in each page: notes' visibility levels (`app/utils/noteVisibility.ts`
— `startLevel`/`settleLevel`/`noteSendOptions`, the microphone offered only at Only me, the
`voice_private_only` refusal checked before the adapter is called, `NotesVisibilitySheet`); the buddy room's
`archived` read-only composer, its `ahead`/`paused` banners, `isHost` delete-any, `retain()`/`release()` of
the live channel. The action bar is composed, not forked: `base(report, delete) + opts.extraActions(item)` —
notes passes edit/visibility/block, the buddy thread passes host-delete.

### Tests

New mount-free Vitest tests with a fake adapter, in the style of `tests/room-thread.test.ts` and
`tests/buddy-thread-view.test.ts`: a failed send setting `notice` to the error word with `permanent =
!retryable`; offline → online re-opening the thread; `open = false` emptying the items; the double-press of
a voice button (`DOUBLE_TAP_MS`); the four `quoteSourceOf` shapes. The e2e specs stay as the critical-path
cover and nothing is deleted: `e2e/book-notes.spec.ts`, `notes-voice.spec.ts`, `buddy-read.spec.ts`,
`buddy-voice.spec.ts`, `buddy-voice-hold.spec.ts`, `buddy-gestures.spec.ts`, plus the offline and a11y
specs.

### Risk and ordering

Green at each step: (1) the pure already-shared parts, no behaviour change; (2) migrate both `useVoicePress`
callers to identical options and run the voice e2e; (3) extract the send/retry/discard/react/answer/confirm
handlers behind the fake-adapter tests; (4) extract the veil, open and online/focus wiring last.

The risks worth naming: `permanent` retry semantics (`isRetryableBuddyError`/`isRetryableNoteError` versus
the error word — a mismatch shows "Try again" on a refusal that cannot be retried); `threadKey(room,
section)` and `closeThread`/`retain`/`release` leaks, which show up as a double-open or a missed live
resync; voice signing (`VOICE_UNSIGNED` placeholder, the capture-phase `voicePress`, the four-minute URL
cache) — a regression is silence or a sound reaching the wrong audience; and the veil's `peek` persistence.

Phone checks before merging: airplane toggle through retry and discard; double-tap ❤️ against the play
button; backgrounding mid-recording; "Show anyway" landing focus in the composer; 200 % text and the
VoiceOver names on the bar and sheets; the German `notes.level.*` menu fitting 360 px.

## 3. One `BookIdentity` module

### The friction

Book identity is re-derived in five modules, and the three "match" notions are all different:

- **Edition identity** — `app/data/merge.ts:213 editionKeys()` (Catalogue id | ISBN-13 incl. the ISBN-10
  conversion at `:207` | `appleId` | OL edition key). Exact.
- **Work identity, recall** — `merge.ts:238 workKey()` = `normalise(title)|normalise(authors[0])`, for
  collapsing search groups (`mergeResults:311`).
- **Work identity, precision** — `app/data/import/editions.ts:288 isSameWork()` = `sameTitle` +
  `sameVolume` + `sameAuthor` + a `COMPANION` guard + `LOOSE_TITLES` fuzzy matching (`app/data/titleMatch.ts`).
  A wrong `true` here silently merges the wrong Book: the app's most damaging failure class.
- **A third tolerance** — `editions.ts:92 isEditionOf()` (the Change-edition sheet), anchored on a stored
  Book, deliberately looser.
- **Display identity** — `editions.ts:179 editionSignature()`: "looks the same on the sheet", not "is the same".
- **Routing** — `app/data/books.ts:118 bookKey()` / `:131 sourceKeys()`: page addresses, not identity.

And **three cover rankings**, which must not collapse into one scalar:

| Ranking | Where | Ranks |
|---|---|---|
| Provenance | `app/data/coverRank.ts:22 kindRank()` over `exact > hardcover > ebook > sameWork > goodreads > placeholder` | whose edition's image it is; decides lent-vs-own and replacement (`coverFill.ts mergeCover`, `mergeBook.ts`) |
| Delivery | `merge.ts:231 coverRank(url)` — 2 mzstatic / 1 any / 0 none | speed of the CDN; picks the search group's representative (`merge.ts:319`) |
| Field belief | `app/data/mergeBook.ts:133 SOURCE_RANK.cover` + `coverKindOfCandidate()` + `COVER_HEIGHT` | which candidate's value wins per field |

Plus four normalisers with different character tables: `merge.normalise:64`, `titleMatch.normaliseTitle`,
`readingTracker.normalize`, `mergeBook.normalised`. And two language tables for one concept:
`import/editions.ts:66 languageCode` (named/ISO) versus `editions.ts:95 languageCode` (MARC `ger→de`).

### The boundary

A new `app/data/identity.ts`, framework-free and pure (`web/AGENTS.md`):

```ts
// keys
editionKeys(book): string[]; isbn13Of(book): string | null; normalise(s): string
// work
sameWork(a, b): boolean          // import/editions.isSameWork, guards and fuzzy included
nearWork(a, b): boolean
// edition choice
betterEdition(row, candidates): T[]   // rankEditions / nearEditions, thin over sameWork + editionFit
// cover
coverKindOf(source, url): CoverKind; kindRank / betterCover / isLent; coverUrlRank(url): 0 | 1 | 2
```

**Stays out, deliberately:** `editionSignature`, `isEditionOf`, `workKey`, `bookKey`/`sourceKeys`,
`SOURCE_RANK`, the search `MATCH`/`RANK` ladder, `probablyGerman` (import policy, not identity), and the
import ladder itself (it calls in). `merge.ts` does **not** grow into the owner — it owns search ranking.

The only genuinely unifiable pair is `coverRank.coverKindOf(source, url)` and
`mergeBook.coverKindOfCandidate(candidate)`: both sniff `mzstatic` for ebook. One delegates to the other;
the height tie-break stays local.

### What it hides

That there are four normalisers, two language tables, three tolerances and three cover ranks — and which
one a caller wants. Today a caller picks by importing the file that happens to export it.

### Tests

Fold `tests/import-same-work.test.ts`, `tests/cover-rank.test.ts`, `tests/title-match.test.ts` and the
same-work sections of `editions.test.ts`/`merge-book.test.ts` into one `tests/identity.test.ts`, pure
objects only (the `book()` helper style of `import-same-work.test.ts:26`), no stack rows. Cases it must
pin: same ISBN in two editions (same keys, different signature); same title, different author; `V2` vs `V3`;
`Harbour Lights` vs `Harbour Lights: V3` (false one way); an omnibus; a translation; a Manual book with no
ISBN (keys `[]`, matchable by title and author only); `Melville, Herman` and initials and umlauts; a Kindle
row against an Apple ebook (`rankEditions` order); the cover-kind table, including the tie-break that keeps
the first.

`tests/own-cover-call-sites.test.ts` is unrelated (proxy wiring) and stays.

### Risk

Silent shifts in ranking: (a) unifying the language tables can flip a DNB question on ISBN group `978-3`,
which changes which source is asked and which edition is picked; (b) widening `LOOSE_TITLES`/`nearEditions`
merges the wrong Book, narrowing it orphans rows into Manual Books; (c) the `COVER_HEIGHT` tie-break changes
which cover a search group shows, with no test failing. Detection: run the identity/import suite, then
`scripts/import-quality.ts` on the sample exports and diff the recorded `rankEditions` order, before and
after.

### Effort

≈2–3 hours plus review, as **three commits**: (i) normalise + language, lowest risk; (ii) keys + work —
needs owner review, this is the failure class; (iii) cover re-exports plus the import-line rewrites.
`app/data/bookImport.ts` only changes import lines and never logic; land #3 **before** #5 so that #5 is a
path rename.

## 4. One shelf-row / status view model

### What the ground actually is

The seam already exists and is narrower than expected: nearly every cover-showing component calls
`coverImage(book, size, coverHosts)` (`app/utils/coverRef.ts:61`) and `v-bind`s the result onto `UiCover`.
48 call sites in 45 `.vue` files already pass the same prop shape; they differ in the size token and in
per-context modifiers. `coverImage` returns `{ src, srcset, sizes, fallbacks, thumbhash, colors }` — *that*
is the view-model shape, and it is already right.

So the cover half of this item is nearly done. Two things are left:

1. **A call-site guard, not an extraction.** The 48 sites are consistent by convention, not by test. Guard
   that a new cover block uses `coverImage` rather than hand-binding `coverSrc`/`coverFor`.
2. **The status/progress half, where the divergence is real.** Six deliberate differences make one shared
   view model *wrong* if it is naive:
   - `notFinished` is **not** an `EntryStatus` (`app/data/library.ts:19` has three values; the database enum
     matches) — it is a read outcome (`SessionOutcome`, `:21`), surfaced through `isNotFinished`
     (`app/data/libraryView.ts:31`) and worded three different ways (`status.notFinished`,
     `library.notFinishedOn`, `status.finished`). A view model typed over `EntryStatus` cannot express it.
   - Three progress wordings for three audiences: `composables/useProgressText.ts` (`book.progress.*`),
     `components/reading/Card.vue:79-90` (its own fraction, bar and big-word logic on top), and the reader's
     separate `reader.percent`/`reader.pageOnly` namespace (`Reader.vue:245`, `Scrub.vue:19`,
     `ChromeScroll.vue:67`, `ChromeClassic.vue:53`, `ChromePrinted.vue:289`).
   - `app/utils/previewText.ts` hardcodes its statuses in English and German on purpose: a Pages Function and
     a Deno Edge Function import it and have no i18n. It must stay out.
   - Cover sources differ: `coverImage` (host covers, with srcset) versus `ebooks.coverOf(record)` (the file's
     own image, `whole`, no srcset — `Reader.vue:60`, `pages/ebooks.vue:96`, `WaitingRow`, `CandidateSheet`),
     plus a third seam in reader components (`book.covers()` from the base store).
   - Per-context modifiers: `dimmed` (`EntryRow`, `WorkRow`), `glow` + `@fallback` (`FriendsFeature`,
     `Card`, `EndOfBook`), `eager` thresholds per screen, `decorative` on all rows.
   - `shown()` seams (`CoverRow`, `FinishedList`, `FriendsRow`, `MemberFinishedRow`) decide
     library-versus-catalogue identity per surface. The view model must accept that decision as input, never
     re-decide it.

~30 row and hero components hold roughly 450–550 lines of this assembly between them.

### The boundary

Two small modules, not one grand one:

```ts
// app/utils/bookStatus.ts — status is derived, not looked up
type StatusView = { status: EntryStatus | 'notFinished'; label: string; tone: 'reading' | 'finished' | 'none' }
statusOf(entry, latestRead): StatusView        // carries the three wordings' choice, not their text
statusOrder(status): number                    // one ordering, replacing SEGMENTS (pages/library.vue:42) and FACETS (data/libraryView.ts:65)
nextStatus(status, session): EntryStatus
```

```ts
// app/composables/useShelfRow.ts — the row's meta, for the shelf's audience only
useShelfRow(book, entry?, size): { cover: CoverImage; title: string; author: string; status: StatusView; progress: { value: string; percent: number | null } }
```

Deliberately out of both: the reader's namespace (its own wording, its own component family), the ebook
file cover seam, `previewText.ts`, and the `shown()` decisions. The three progress audiences stay three;
the *derivation* of the shelf's wording becomes one.

### Tests

`tests/book-status.test.ts`, pure: `notFinished` derived from an abandoned session and from a `finished`
entry whose last read was abandoned; the ordering table; a Manual book with no session; a `want_to_read`
entry with no dates. `tests/shelf-row.test.ts` for the composable's non-DOM part (status + progress
selection), mounting nothing. What would become redundant: nothing much — the point is that `SEGMENTS` and
`FACETS` stop being two independent orderings, and that a fourth status-like state cannot be added to one
without the other failing.

### Risk and ordering

Low. Steps: (1) `bookStatus.ts` + `tests/book-status.test.ts`, then point `pages/library.vue` and
`data/libraryView.ts` at the one ordering; (2) `useShelfRow`, adopted by three components first
(`library/EntryRow.vue`, `search/ResultRow.vue`, `reading/CoverRow.vue`) and only then the rest; (3) the
cover call-site guard. The main risk is adopting the view model in a component whose context modifier
(`glow`, `dimmed`, `eager`) then gets lost — so the composable returns only the meta and the size, and the
component keeps its modifier.

### Effort

Small. ≈1–2 hours for the status module and its adoption, ≈1 hour for `useShelfRow` over three components,
≈30 minutes for the guard. Adopting it across all 30 rows is separate, cheap, follow-on work — worth doing
per screen as screens are touched, not as one sweeping commit.

## 5. Lift the upload seam off the match engine

### The friction

The app runs `stores/import.ts` → `data/importUpload.ts` (`prepareUpload`, the `Prepared` value at `:33`) →
`data/importJob.ts` (`start_import_job`) → the Edge Function `supabase/functions/import-job/` → a watcher
(`data/importJobWatch.ts` + `importJobFeed.ts`, 247 lines of good isolated logic) → `data/importedBooks.ts`.

Next to that path sits `app/data/bookImport.ts`: **1151 lines, 15 imports**, holding a complete device-side
lookup/match/write engine that the app no longer runs. Only two app imports survive —
`importUpload.ts:2` wants `importedKeys` + `libraryTitleIndex`, `stores/coverUpgrade.ts:7` wants
`pacedFetch` — but both pull the whole module into the upload path. The rest of its users are four
`scripts/import-*.ts` and twelve test files. A reader tracing one import must open seven files and then
rule out an eighth.

Riding on the import store: the Apple cover-upgrade side quest (`stores/import.ts:162-178 finished()`,
`UPGRADED_KEY`/`LEGACY_KEYS` at `:34-36`) and Web Push (`stores/importPush.ts`).

### The correction: the engine is not dead

The premise of this item was wrong, and it matters. `app/data/bookImport.ts` is **not** a leftover: the live
Edge Function imports it at runtime, by explicit `.ts` path, and runs the same match ladder as the app once
did.

- `supabase/functions/import-job/work.ts:17-24` imports `findEdition`, `isMatched`, `rememberingAnswers`,
  `reviewOf` and the `Edition`/`Lookups` types from `../../../web/app/data/bookImport.ts`.
- `sources.ts:2-7` rebuilds the app's source wiring from `web/app/data/` (`createSearch`, catalogue, `createDnb`,
  `createGoogleBooks`) with `jobFetch` returning `APPLE_OFF_ANSWER` for `itunes.apple.com`.
- `work.ts` calls `findEdition` per row; `reviewOf`/`coverLender`/`mergeCover` produce the match result;
  `write.ts` and `choice.ts` use `importArguments` from the same file.

The ladder is identical (`import/queries.ts`, `catalogueFirst`, `rankEditions`, `primeIsbns`). The
differences are **configuration, not code**: Apple is never asked (owner decision, 2026-10-19), the Goodreads
lookup is deferred to the cover stage, the match saves its choice with `outcome: null`, and the write runs as
the member.

So the three moves this item proposed are all worse than the current state: moving the engine beside the
Edge Function breaks the Deno↔Vite sharing and drags a dozen modules with it or duplicates them; `scripts/lib/`
is not deployed or bundled for Deno; a separate package needs dual-runtime compatibility and versioning for
one engine that has exactly two consumers.

**What is actually wrong is narrower:** `app/data/importUpload.ts:2` imports two small dedupe helpers out of
that 1151-line module, which pulls the entire engine — and its fifteen imports — into the app's `/import`
chunk for the sake of a title index.

### The steps

1. **`app/data/import/dedupe.ts`** — move `importedKeys` (`bookImport.ts:844`), `libraryTitleIndex` (`:729`)
   and their companions (`libraryIndex`, `entryFor`) as one unit, signatures unchanged, with only their real
   dependencies (`../library.ts`, `import/rows.ts`, `import/readingTracker.ts`, `import/editions.ts`,
   `../merge.ts` for `normalise`, `import/detect.ts` for `SUPPORTED_SOURCES`). Repoint
   `importUpload.ts:2`. This alone drops `search`, `covers`, `dnb`, `googleBooks`, `mergeBook` and
   `catalogueSearch` out of the upload graph.
2. **`app/data/import/startJob.ts`** — one door for the device's whole part of an import:
   `startJobFromFile(client, bytes, { today, zip?, device, languages })` → `{ ok: true, jobId, already, total }`
   or `{ ok: false, error, detail? }`. Inside: `parseFile`/`uploadRow`, `dedupe.ts`, `startImportJob`,
   `languagesOf`, `deviceOf`. The error codes are today's, unchanged (`notSupported`/`notCsv`/
   `missingColumns`/`empty`/`unreadable`/`unknown`/`zip*` from the upload, `import_too_soon`/
   `device_import_running`/`import_running`/`rows_invalid`/`job_unknown`/`offline`/`unknown` from the RPC).
   `stores/import.ts` then keeps only its screen state, the watcher, `retry`/`cancel`/`acknowledge`/`refresh`
   and the upgrade trigger.
3. **Move the cover-upgrade side quest off the store.** `finished()` (`stores/import.ts:~163-180`) becomes
   `stores/coverUpgrade.ts` `upgradeAfterJob(jobId)`, called in one line from the job watcher when the state
   turns `done`; it needs `addedEntryIds` (`importJob.ts`), the has-seen/mark logic and the
   `writeImportHint(load)` ordering. `UPGRADED_KEY` (`libellus.import-jobs-upgraded`) moves with it **with its
   value unchanged** — devices already have it set. Web Push is already independent
   (`stores/importPush.ts`); the page calls it when the job is live and nothing of it belongs in the import
   store. `LEGACY_KEYS` cleanup stays until this ships.

### Tests

Of the twelve test files importing `bookImport`, only the dedupe consumers repoint — `hardcover-import.test.ts`
(and any `libraryTitleIndex` cases); `cover-fill.test.ts` is type-only. The engine-behaviour files stay with
the engine (`import-find-edition`, `import-dnb`, `import-catalogue-first`, `import-edition-choice`,
`google-books`, `goodreads-import`, `hardcover-import`, `import-write-covers`, `merge-book`,
`import-hardcover-zip`).

New: `tests/import-dedupe.test.ts` (the two helpers against stack fixtures, which
`hardcover-import.test.ts` only reaches indirectly) and `tests/start-job.test.ts` (a real CSV fixture from
`tests/fixtures/goodreads/`, a fake client asserting `rows`/`already` counts and each `FileError` code, a
stubbed `start_import_job` for the `ImportJobError` codes).

**What cannot be tested, and should not be faked:** the job's phase machine
(`queued → running → paused → done/failed/cancelled`, with the `matched`/`covered`/`written` counters) is
driven only by the Edge Function, which the local stack never runs — CI starts the stack without an edge
runtime, the Deno tests (`runner/handler/work/covers/write/push`) cover the function itself, and pgTAP pins
the database rules. `e2e/import-job.spec.ts` plays the runner with hand-written SQL. Leave that arrangement
alone; it is honest about what it can reach.

### Risk and ordering

1. `dedupe.ts` + repoint the upload, run Vitest. 2. `startJob.ts` + repoint `stores/import.ts choose()`.
3. `finished → upgradeAfterJob`, keys unchanged. The four `scripts/import-*.ts` need no edit in this plan
because the engine file itself does not move — and if it ever does, the four relative script imports and the
Edge Function's `../../../web/app/data/*.ts` imports must move **together**, in one commit, or the deploy
breaks silently.

No `*-entry.test.ts` or allow-list gates `bookImport.ts`; removing it from the upload graph shrinks the
`/import` chunk and nothing else. Confirm with `pnpm perf:bundle`.

### Effort

Three small commits, ~250 lines moved in total, no migration, no copy. The honest scope: **this item is about
one chunk and one store's knowledge, not about deleting an engine.**

## 6. The reader: a test boundary and a session composable

### The friction

`app/reader/engine.ts` (902 lines) wraps the vendored foliate-js and adds trimming, TOC flattening,
relocation, highlights, custom touch selection, page CSS, sanitising — then closes with `openReader`
(`:690-902`), a 200-line function wiring sandbox probes, opening, link policy and eight listener families.
`app/components/reader/Reader.vue` (1116 lines) owns the chrome mode machine, the gesture policy, the
persistence lifecycle (`ProgressWriter` at `:215`, `leavePlace` at `:254` and `:703`) and the cover flight.
Understanding one reader flow means opening five files — and `engine.ts` has **zero** unit tests: nothing in
`tests/` imports it, and only `e2e/reader.spec.ts` (5 Playwright tests) exercises it.

**Recommendation: steps (a) and (d) only.** The engine already *is* the seam; what is missing is a test
boundary and a persistence owner. Moving tap/swipe policy into the engine is not worth its phone-risk
premium.

### What can be tested at all

`web/vitest.config.ts` runs `environment: node`, so nothing DOM-heavy is reachable — `tests/reader-markup.test.ts`
proves `jsdom` is installed and usable per file (`// @vitest-environment jsdom`), but Vitest cannot mount
`foliate-view`, iframes, OPFS or layout, and `e2e/build.ts` generates the whole app for Playwright, so it is
not reusable.

Testable today, once extracted: `pageCss` (string in, string out, fonts passed in), relocation
normalisation (`fraction`/`bodyEnd`, `atEnd`/`atStart`/`fits`, the back-matter trim), `prepare()`'s TOC
flattening with the `BACK_MATTER` filter and `bodyFractionOf`, `describeRange`'s box-shift maths against
stubbed rects, and `compareCfi`. `progressAt`/`isAhead` are already tested through
`data/reader/progress.ts`.

Not testable, ever, in this setup: the `ReaderEngine` class itself (`view.open`/`goTo`/`next`/`search`/
`addAnnotation`), the `frameSandbox` probe, `openReader` (it creates `foliate-view`, blob URLs, rAF loops,
listeners), `caretAt`/`wordAt`/`selectWordAt` (needs `caretRangeFromPoint`), `installTouchSelection`.

### The boundary

New pure modules under `app/data/reader/`, which is already where the tested reader logic lives:
`relocation.ts` (`normalizeRelocation`), `toc.ts` (`flattenToc`, `findBodyEnd`), `pageCss.ts` (the `pageCss`
function with `PageColors`/`Flow` and font URLs as an argument), `geometry.ts` (`shiftRects`, the pure core
of `describeRange`). `app/reader/engine.ts` stays as the DOM adapter importing them, and its public surface
is unchanged: operations `turn`/`next`/`prev` (the queued turn stays inside), `goTo`/`goToFraction`/
`bodyFractionOf`, `setLayout`/`setStyles`, `prepare`/`onRelocate`, `highlight`/`unhighlight`/`reconcile`,
`search`/`clearSearch`/`compareCfi`, `selectWordAt`/`extendFromPress`/`extendSelection`/`reportCustom`/
`clearSelection`, `destroy`; events `relocate`, `tap`, `scroll`, `swipe`, `overscroll`, `select`,
`highlightTapped` (`EngineHandlers`).

**Stays in `Reader.vue`, deliberately:** the back-dismiss stack (its order is load-dependent: end page,
chrome, scrubbing, menu, then Escape), the chrome mode machine and every sheet, the cover flight, folio and
page-area geometry, and the a11y focus handling. These are Vue reactivity, history entries, i18n and tokens —
the engine is framework-free by rule.

### The session composable

`useReaderSession({ entryId, fileHash, status, pageCount, progressFor, saveProgress, openingPlaceFor,
leavePlace, openHighlights, followHighlights, highlightsFor })` owns the persistence lifecycle:
`ProgressWriter` construction, the place's dual write with its 5 s debounce and flush-on-`now`, the
800 ms opening-place race, the 800 ms open-highlights race, `followHighlights`' 60 s poll with visibility and
online triggers, highlight reconciliation, and closing with `leavePlace(now: true)` plus `writer.flush()`.
It returns `{ writer, loc, ready, open(), onRelocate(at), readsOn, lookingUp, jump, close() }`.

The store **shrinks**: `stores/reader.ts` keeps settings, `retain()` and the lazy chunks, `saveProgress`,
`progressFor`, places, highlights, and the translate/define lookups; it loses the orchestration that
`Reader.vue` currently performs on its behalf (`Reader.vue:215-218`, `:254`, `:703`, `:788-830`). No new
Supabase path, no migration.

### Ordering, each shippable

(a) Extract the four pure modules and add `tests/reader-relocation.test.ts` + `tests/reader-pagecss.test.ts`
— no behaviour change, first tests at that boundary. (b) Extract the chrome mode machine into a
`useChromeMode` composable — component-only, no engine change. (c) *Deferred*: the gesture policy. (d)
Extract `useReaderSession` — `Reader.vue` stops wiring the writer, the place and the highlight poll.

### Risk

The three regressions to expect, in order: **edge taps stop turning** (the 30/70 split interacts with
`menuClosedAt` and `suppressTapUntil`; verify with an edge-tap matrix and the `data-fraction` poll in
`e2e/reader.spec.ts`); **the back stack inverts** (chrome vs slider vs menu vs end page vs reader — verify
Android Back and Escape); **place or progress lost on close or background** (5 s debounce, 800 ms race,
the writer's idle policy — verify closing mid-chapter and reopening offline). Deliberately untouched:
`guard`/`sanitizeResource`, the `frameSandbox` WebKit branch, the sheet motion curves, the wake lock and the
theme take-over.

### Effort

(a) small: ~200 lines moved, ~150 lines of test. (b) small: ~120 lines. (d) medium: ~250 lines. The
gesture move (c) would be 2–3 more steps of ~200 lines plus the costly manual phone matrix — skip it.

## 7. `useDragReorder` out of `EntryList.vue`

### What is actually there

`app/components/collections/EntryList.vue` is 461 lines; `:42-215` is the drag: a `Drag` record (`:46-55`,
rows in *page* coordinates so scrolling counts), `rowRects()` reading the `<ol>`'s direct `<li>`s, `lift()`
(`:72`), a hold-versus-scroll press state machine, window `pointermove`/`pointerup`/`pointercancel` wiring,
`follow()`, an auto-scroll `requestAnimationFrame` loop, a settle timer, and a keyboard fallback with a
live-region announcement.

No reusable primitive exists: `@fabkho/ui/app/composables/` has `useSwipeDown` and `useSheetTouch` but no
hold-to-lift or reorder; `app/composables/useHoldRepeat.ts` is a stepper's auto-repeat; trappist has
nothing. Build it.

### The boundary

```ts
// app/composables/useDragReorder.ts
useDragReorder(opts: {
  count: () => number
  rows: () => { top: number; height: number }[]
  canLift: () => boolean
  onCommit: (from: number, to: number) => void
  announce: (msg: string) => void
  msgs: { lifted(title): string; moved(title, from, to): string; dropped: string }
  holdMs?: number   // 350
  holdSlop?: number // 8
}) => { drag, settling, still, gripDown, rowDown, move, up, cancel, contextmenu, clickCapture, rowTouchmove }
```

plus three pure functions exported for plain-Node tests: `targetFor(rows, index, centerY)`,
`clampDy(rows, index, dy)`, `offsetsFor(rows, from, to, dy)`.

`EntryList.vue` keeps the template, the props, `rowStyle()` as a thin wrapper over `offsetsFor`, the
`<style>` block (lifted scale, glide transition, reduced-motion block), the keyboard handler, the live
region and the grip refocus — nothing about pointer physics.

The composable owns every listener and timer (window pointer events, the list's non-passive `touchmove`, the
rAF loop, the settle timer, the hold timeout) and cancels all of them in one `onBeforeUnmount`.
`setPointerCapture` stays inside `lift` in a try/catch. The timings move verbatim from
`docs/MOTION.md` ("Follow-the-finger"): hold 350 ms, slop 8 px, edge = two touch sizes, 8 px per frame,
settle = `--duration-quick` through `durationOf` (0 under reduced motion), and `navigator.vibrate?.(10)` on
lift. The commit reaches the store from the page, never from the composable:
`onCommit: (from, to) => collections.move(props.collectionId, entries[from].id, to)` —
`stores/collections.ts:336` already moves optimistically, saves by entry id, and reloads on failure.

### Tests

No mount infra exists and none should be added (no `@vue/test-utils`, no `happy-dom`; `jsdom` only by
per-file pragma in `tests/reader-markup.test.ts`). New `tests/drag-reorder.test.ts` covers the three pure
functions: target resolution down and up, clamping past both ends, the offset table for every row during a
move, and cancel restoring `target = index`.

### Risk

The known drift to preserve rather than fix: `rows` are captured once at lift, so an auto-scroll's `follow`
uses stale rects. That is today's behaviour — comment it and keep it. The real risk is the keyboard path,
the only route a VoiceOver user has: the announcement strings and the refocus must survive intact.

### Effort

~180 lines of composable, ~200 left in the SFC, one ~60-line test. One commit, two if the pure functions go
first.

## 8. Split `useBookFlight` — do not do it

### The friction, re-examined

`app/utils/flight.ts` **is already** the geometry module. `useBookFlight.ts` imports `boxOf`, `isFlightPath`,
`onScreen`, `startAt`, `transformFrom`, `valueOf`, the `Box`/`Channels`/`Towards` types and the `AT_*`
constants from it (`:60`), and its own `box()` (`:200`) is merely `boxOf(getBoundingClientRect())` — a DOM
adapter, not a duplicate. `flight.ts:1-6` states that boundary in its header. The "overlapping maths"
suspected in the review is not there.

What the file does hold is one FLIP state machine: `installBookFlight(router, {under, over})` (`:1032`) called
once from `components/shell/BookFlight.vue:15`, with `Layers` (`:117`), `prepare`/`launch`/`flightOf`
(`:368`, `:394`, `:429`) consumed through `v-on="flightOf(path)"` in about fifteen rows (`EntryList:342`,
`library/EntryRow:40`, `search/ResultRow:54`, `author/WorkRow:138`, …), plus `pose`/`track`/`letGo`/`land`/
`hold`/`handOff`/`wait`/`keep` sharing `Departure`/`Flight` closures (`:125-190`, `:446-1030`).

`tests/flight.test.ts` already covers `transformFrom`, `lerpBox`, `onScreen`, `isBookPath`, `isCardPath`,
`startAt`, `valueOf`. The only test that would need rewriting on a move is
`tests/own-cover-call-sites.test.ts:52`, which allowlists the file in its `HAND_BOUND` set and walks the
sources — a structural guard, not flight logic.

### Recommendation

**Leave it.** The flight is visible, interruptible and working; splitting it touches the closures above for
no new consumer, and a rename (`flightGeometry.ts`) would rewrite `tests/flight.test.ts` imports and the
own-cover allowlist for zero gain.

Triggers that would reopen this: a second consumer needing `timing`/`oriented`/`play`/`channelsOf`
(`:302-334`), or another route class added to the classifier. Then split as `utils/flightRoute.ts` (the
`is*Path` predicates) and keep `utils/flight.ts` as the pure geometry — never as a rename.

## What the plans change about the original list

Four of the eight items shrank once the ground was read, and two changed shape:

| # | In the review | After planning |
|---|---|---|
| 1 | three stores, one chain | confirmed; two commits, a new guard test |
| 2 | duplicated across two pages, maybe shared three ways | confirmed, but **app-only**; trappist is not a third consumer |
| 3 | one identity module | **three** identities that must stay apart; four normalisers and two language tables fold |
| 4 | one view model over ~30 components | cover half is already solved by `coverImage`; the win is status/progress, and six divergences forbid a naive merge |
| 5 | move the legacy engine | **wrong premise**: the Edge Function runs it; the win is the upload seam only |
| 6 | move gestures into the engine | **deferred**; extract the pure boundary and the session composable only |
| 7 | extract the drag | confirmed; pure functions plus a composable |
| 8 | split `useBookFlight` | **dropped**; it is geometry-plus-state-machine, not duplication |

Order to run them if all are pursued: 1 → 4 → 7 → 5 (small, additive, each independently shippable), then
2 (the largest duplication), then 3 (needs owner review), then 6a and 6d. Never 6c or 8.

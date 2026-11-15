# Page counts for the books that have none — how to fill them

Assessment, 15 November 2026. No code, no migration: findings and a recommendation.

## The finding

There are two different page counts, and the figure mixes them on purpose:

- **`books.page_count`** — the edition's count, from Open Library / Google Books / the
  import / Apple (Apple sends none). One row per edition in the shared Catalogue
  (`books.owner_id IS NULL`, readable by every member, writable only through RPCs —
  members have no UPDATE on `books` at all). Writing it changes every member who
  holds that edition. The import path keeps the first snapshot and never rewrites it,
  so even the system never corrects one.
- **`library_entries.page_count_override`** — her own total for that entry (issue #60:
  "an ebook's pages follow the font size"). Private to her entry, set in the Update
  progress sheet's total wheel (`update_progress(p_set_page_count => true)`), sent
  together with a progress save. A total that only repeats the edition's is stored
  as none (`ownTotal`, `data/progress.ts:112`), so it follows the Book. Ceiling
  99999 either way.

**What counts is the combination.** `pageCountOf` (`data/progress.ts:33`) answers
her total where she set one, else the edition's, else null. `StatsRead.pages`
(`data/stats.ts:113`) is that answer per closed read. `pagesMissing`
(`data/stats.ts:354`) is the finished reads where the answer is null — `readsWithoutPages`
(`data/stats.ts:260`) is literally its row filter, so the sheet and the line can never
disagree. The Pages sum (`figuresOf`, `data/stats.ts:348`) adds the answers that are
not null; `pagesFigure` (`utils/pagesFigure.ts:6-22`) draws the sum, the missing line,
and the per-book average only when nothing is missing.

**Why the sheet cannot set it today.** `ReadsSheet` (`components/profile/ReadsSheet.vue`)
is a list with one per-row control: the quick-rate stars, and only on her own unrated
sheet (`rateable = quickRate && !foreign`). There is no total-setting control anywhere
outside the Book page's Update progress sheet, and that sheet's write path requires an
**open read**: `update_progress` raises `not_reading` when the entry has no session with
`outcome IS NULL` (`20261004074435, lines 91-94`). The 21 in the sheet are finished
reads — closed. So even pointing the sheet at the existing RPC would fail: the fix
needs a write path that works on a finished entry, not just a button.

**The owner's context matters.** His 99%-imported Library means most of the 21 are
missing the *edition's* count (no override involved — an import never sets
`page_count_override`, and Apple imports carry no count at all). Setting her own total
on 20 imported books would move the figure, but each would be a guess typed against a
book whose real edition count is knowable. That argues for source-first.

## Filling it from a source

**What enrich stores today: nothing about pages.** Verified by grep across
`supabase/functions/enrich/*.ts`: no `page_count`, no `number_of_pages` anywhere in
the pipeline. `enrich_save` writes authors, series, works and `book_works` links —
never a `books` column. The queue (`enrich_backfill`, `enrich_refresh`, pg_cron
`enrich-drain` every 10 min) re-drives the same genre/series/author payload, so a
"refresh" would not fetch page counts either. There is a backfill *mechanism*
(`backfill.ts`: queue every never-enriched Catalogue Book, drain in-process,
resumable) but its payload has no page field to fill. **A source backfill is new
work in the enrich function, not a config change**: teach the payload a
`page_count`, teach the sources to read it (Open Library `number_of_pages` /
`pagination` parsing already exists client-side in `data/openLibrary.ts:224-264`;
Google Books `volume.pageCount` in `data/googleBooks.ts:46`), decide write rules
(first snapshot wins? fill nulls only?), add tests and recordings.

**A cheaper second source exists and is already deployed.** The `google-books` edge
function (issue #305) answers `isbn` / `search` / `book` with parsed volumes that
include `page_count`, keeps them in `google_books_cache` (≤1 day, per Google's terms),
and on `book` *inserts a Catalogue Book carrying that `page_count`* when the ISBN is
unknown. Budget: ~900 requests/day whole-app (Pacific day), `enrich` slice 300,
member slice 60/day each (`handler.ts:99-108`). One request per ISBN question,
cached answers free. For ~21 books the cost is ~21 requests — noise against any
slice. Rate limits that matter at scale (300/day enrich slice ≈ 2,000/week) do not
matter here.

**Realistic success rate: most, not all — which argues for both ideas, not one.**
Open Library has `number_of_pages` on the edition record for mainstream print
editions; Google Books `pageCount` covers much of the rest. Known gaps: Apple-sourced
books (no ISBN to ask with — Apple Books carry no ISBN in this schema), pre-ISBN /
small-press books, some German editions (DNB knows them but DNB records carry no
page count in the current `data/dnb.ts` path), audiobooks (durations, not pages).
The owner's own warning stands: "some APIs do not always return the page count".
Expect a backfill to clear the large majority of 21 and leave a residue of books no
source knows — the residue is exactly what the manual path is for.

**One open question inside the source option:** whether a backfilled edition count
should land in shared `books.page_count` (helps every member holding that edition;
matches how `change_edition` already inserts source books with their count) or stay
conservative. Filling *nulls only, never overwriting* keeps the "first snapshot wins"
rule intact and is additive in spirit. Overwriting an existing count would change
other members' figures — do not do that without the owner's explicit say-so.

## The manual options

All sizes are rough, counting tests (this repo pins behaviour in Vitest) but no
migration unless stated.

**(a) Inline total in the `pagesMissing` sheet row.** Precedent is exact: `quickRate`
threads `history.rateSession` → `update_session` → `stats.rated()` optimistic update
(`ReadsSheet.vue:102-146`, `history.ts:169-196`, `stores/stats.ts:136-144`). A
per-row stepper or numeric sheet would mirror it: new `quickTotal`-style prop
(own sheet only, never `foreign` — writing another member's total must stay
impossible), a small component next to `ProfileRateRow`, a store action that writes
and updates the read in place. But the only total-writing RPC needs an open read
(see above), and these reads are finished — so this option **also needs the new
write path** (a small RPC or an extension of `update_progress` that sets only the
override on a finished entry; additive, per-entry, no RLS change since entries are
already member-scoped). Files: `ReadsSheet.vue`, a new `TotalRow` component,
`stores/history.ts` (or a new store action), `stores/stats.ts` (a `withTotal`
sibling of `withRating`), `utils/statsSheet.ts` (no change — same rows), one
migration for the RPC. Size: medium — roughly the quick-rate change plus a migration.

**(b) Same, but explicitly her own total.** This is (a) with the semantics made
visible: the row control writes `page_count_override`, never `books.page_count`.
Same files, same size as (a) — the difference is product language, not code
("your total for this read" vs a bare number). Worth stating because the quieter
the control, the easier it is to mistake her guess for the edition's fact. If (a)
is built, build it as (b).

**(c) "Set the count" in the Book page's Update progress sheet.** The home of
progress already: the total wheel, `ownTotal` normalisation, `TOTAL_GUESS = 300`
starting point for count-less books (`data/progress.ts:118`), "Use percent" fallback.
For a *finished* book the sheet would need the same new write path as (a), plus a
way to open the sheet in total-mode from a finished entry (today `openProgress`
takes a `LibraryEntry` with a latest session). Files: `ProgressSheet.vue`,
`stores/reading.ts` (`confirmProgress` gains a total-only branch), the same RPC as
(a). Size: small-medium — less new UI than (a), but it preserves the detour the
owner complained about (sheet → book page → progress sheet → total wheel), just
shortened by one step. It does not answer "quickly add a count inside this bottom
sheet".

**(d) Bulk: one sheet, N rows, each a field, one Save.** The most UI (N validated
number fields, partial-failure handling, one RPC or N calls), the most new
behaviour (draft state per row, what "Save" means when 3 of 21 fail validation),
and it fights the sheet's existing architecture (rows are read-only; the one
mutable row control, quick-rate, writes immediately with Undo, not batch). No
precedent for batch writes anywhere in the app (the outbox queues single ops).
Size: large — and the UX is not obviously better than (a): 21 immediate steppers
with Undo beat one form with 21 fields. **Do not build (d).**

**Simplest to build correctly: (c).** It reuses the total wheel, its validation,
its normalisation and its tests; the only new thing is the write path, which every
option needs. **Best UX: (a)/(b).** It answers the owner's sentence directly — "inside
of this bottom sheet we can quickly add a page count" — with the quick-rate
precedent proving the sheet can hold a per-row control and the figures can follow
at once.

## What the figure then does

Nothing surprising, because the figure already counts the combination. Set her total
for 20 of 21: each read's `pages` becomes her number, `pagesMissing` drops to 1, the
Pages sum gains the 20 totals, and the per-book average stays hidden until the last
one lands (`pagesFigure`: `perBook` only when `missing === 0`). Her total and the
edition's can and do disagree — the data notes say up to 40% between editions
(`docs/plans/book-notes.md:71`), and her total is deliberately edition-independent
(ebook font size). There is no conflict to resolve: `pageCountOf` prefers hers, and
`ownTotal` stores it as none when it merely repeats the edition's, so a later
backfill that finds the real count silently takes over. The one asymmetry: her total
is per-*entry*, while the figure counts per-*read* — re-reads of one entry each
carry the same total, which is correct (she read that many pages twice).

## Risks

- **Shared-row danger is real but avoidable.** Writing `books.page_count` changes
  every member's figures for that edition. All manual options here write
  `page_count_override` (per-entry, per-member) — no cross-member effect, no new
  RLS needed (entries are already `member_id`-scoped; the RPC pattern is
  `security definer` + `auth.uid()` check like its neighbours). A backfill that
  writes `books.page_count` *does* touch shared rows: restrict it to null-fills and
  say so in the PR.
- **RLS / migration.** Manual path: one additive RPC (or an additive branch on
  `update_progress`), no table change, no policy change. Backfill: function code +
  possibly a payload-shape change in `enrich_save`, no table change if page count
  goes into the existing `books.page_count` column. Nothing here needs a
  destructive migration.
- **Data loss.** Per the standing rule: the manual write sets one nullable integer
  on her own entry; the old value (null or a previous total) is superseded, not
  destroyed — and `ownTotal` keeps edition-equal totals as null so backfilled truth
  wins later. A null-only backfill cannot lose anything. Neither path deletes,
  rewrites history, or touches `reading_sessions` / `reading_progress_days`.
- **Offline.** Ratings queue in the outbox; progress writes (`change_edition`,
  `use_own_edition`) refuse offline. The new total-write should follow the rating
  precedent (queueable single op) rather than the edition precedent — the sheet is
  exactly where offline happens.

## Recommendation

**Source first, then manual — in that order, both shipped.**

1. **Backfill the 21 through the `google-books` function** (ISBN lookup per book,
   null-fills into `books.page_count`), without touching enrich: ~21 requests,
   no budget pressure, no new pipeline. Expect it to clear most and leave the
   Apple/pre-ISBN residue. If the owner wants this recurring, *then* teach enrich
   a page-count payload — not before.
2. **Build (b): inline her-total field in the `pagesMissing` sheet**, on the
   quick-rate precedent, with the new finished-entry total-write RPC. It covers the
   residue and every future import, and it is the interaction he asked for.
3. Do not build (d). Do not let any manual control write `books.page_count`.

## What needs the owner's decision

- **Is a page count hers or the edition's?** The code already answers "hers first,
  edition's second" — confirm he wants the inline control to write *her total*
  (his phrasing, "the page count of a book I've read", suggests edition; his
  ebook-font-size reality suggests personal). If he wants edition corrections,
  that is a different feature (a correction flow onto a shared row, with review —
  much bigger).
- **May a backfill fill shared `books.page_count` nulls?** Helps all members, but
  writes rows others hold. Null-only is the safe scope; confirm.
- **May finished reads gain a total-write at all?** `update_progress` currently
  refuses without an open read. Extending it (or a new RPC) blesses "my finished
  book was N pages" as a first-class fact — small, but a semantic step worth his
  nod.

## What I could not verify

- The actual 21: no production access (by rule), no local seed with imported books.
  The Apple-import claim ("an Apple Books import has none") is per the `pagesFigure`
  comment and `apple.ts:123` (`pageCount: null`); the 99%-imported shape is the
  owner's word.
- Google Books hit rate on his specific ISBNs: the function and budget are verified
  in the repo, but no live lookup was run (no secrets in this task, no network
  calls against the linked project).
- Whether `enrich`'s Open Library path even sees edition records with
  `number_of_pages` for his books: the *client-side* parser reads it
  (`data/openLibrary.ts:224`); the *function-side* `openlibrary.ts` has no page
  parsing at all — confirmed absent, which is why enrich work is sized as new.
- Exact row counts and per-year split of the 21: needs his Profile, which is the
  coordinator's read-only job, not mine.

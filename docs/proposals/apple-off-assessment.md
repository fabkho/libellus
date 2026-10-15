# Assessment: can the import match without Apple? (15 Oct 2026, measurement)

Status: assessment, **DO NOT MERGE**. Companion to [proposals/import-background.md](import-background.md) (PR #329, the
server-side import job). Everything here is a count; no title, author or ISBN of the member's export is in this file,
in the commits or in the PR. The per-row audits (which name the books) stayed in a gitignored local path and are not
part of this branch.

Two questions, both measured on the member's real 709-row Goodreads export, on the code this branch starts from
(`main`, 1.22.0), against the live sources on a local Supabase stack:

1. **Can we match everything without Apple?** A server job cannot be based on Apple: the iTunes Search API refuses
   one address after ~100–170 requests (429/403 for minutes) and an Edge Function's address is shared.
2. **What does that cost in cover quality?** Apple's artwork is usually the good one.

## How to repeat it

`web/scripts/import-quality.ts` runs the import's lookup, its cover fill and Choose edition exactly as the store wires
them, and prints counts (its header says how). This branch adds one mode:

```
LIBELLUS_IMPORT_APPLE=off        Apple is never asked, and never counted as refused: its own empty answer
                                 comes back instead, so no row is "unsure" because of a source that is off.
```

Runs (15 Oct 2026, one residential address, local stack `libellus-apple-off` on ports 57400–57409, `project_id`
`libellus-apple-off`; the shared `libellus` stack was never touched):

- **A — Apple on:** full 709-row file, cover fill 600 s, Choose edition opened on every row that needs a look,
  Open Library through the local `openlibrary` function (proxy, no fallback to direct), the DNB through `dnb-lookup`
  on the import budget, Goodreads covers on (the store's flag).
  **Apple refused from its 24th second on, after 85 requests** (1,556 Apple requests: 171 answered, 1,382 refused with
  429/403, 3 aborted).
  The address was already hot: the previous full runs of 13/14 Oct ended the same way. So column A is a *bad Apple
  day*, and every Apple number below is a lower bound.
- **B — Apple off** (`LIBELLUS_IMPORT_APPLE=off`): the same file, the same settings. 0 Apple requests left the
  machine; the 1,440 Apple questions the pipeline asks were answered locally with Apple's own empty answer.

Both runs on the same day, same stack, same code. Commands, audits and the cover measurements: the run notes under
`.shots/apple-off/` (gitignored).

## Q1 — matching with the free sources only

| full 709-row file | A: Apple on | B: Apple off |
|---|---:|---:|
| matched to a real Book | 676 | **667** |
| … by ISBN / by title | 460 / 216 | 427 / 240 |
| … of them via the DNB | 68 | **129** |
| unmatched (only the file's own row) | 33 | **42** |
| … of them with an ISBN in the file | 6 | 10 |
| a source could not be asked (`unsure`) | 58 | **0** |
| needs a look | 114 | 138 |
| … a row that shows no cover | 114 | 131 (and 7 the preview's own rule flags) |
| probably fine | 193 | 259 |
| matched, but shown without a cover | 84 | 131 |
| rows whose title search found no candidate at all | 23 | 25 |
| Choose edition opened on the rows to look at: no edition at all | 21 of 119 | **1 of 166** |
| Apple requests (that did not answer) | 1,556 (1,385) | **0** (1,440 answered locally) |
| DNB calls (asked / answered / refused) | 383 / 383 / 0 | 583 / 583 / 0 |
| Open Library calls (`search` / work editions) | 1,275 / 41 | 1,603 / 71 |
| lookup | 734 s | **655 s** |
| whole run | 1,372 s | **1,255 s** |

Row by row (the two audits joined by the file's own key):

| | rows |
|---|---:|
| matched in both runs, the same edition | 601 |
| matched in both runs, **another edition of the same work** | 63 |
| matched in both, a different work | 3 |
| matched **only with Apple** | **9** |
| matched only without Apple | 0 |
| of the 42 rows Apple off leaves unmatched: a book only Goodreads knows | 41 |
| of the 42 rows Apple off leaves unmatched: no candidate anywhere | 1 |

(Every one of the 42 unmatched rows carries a cover: 41 a Goodreads one, 1 an Open Library one.)

- The 63 differently matched rows are Apple's ebook against an Open Library (54) or DNB (9) edition; the free side
  states no format for any of them (`format: null`), so "ebook against print" cannot be told from the data — Apple's
  catalogue is ebooks only, the free side's format is unstated. The file's own row is an ebook binding for 54 of the 63.
- The 3 "different work" rows are Apple editions the free sources matched to another work (a wording of the title
  that `isSameWork` does not join); 12 further rows look like a different work to a title comparison but carry the
  same ISBN on both sides (a source's own wording of one edition), so they are not a real difference.
- Apple's editions win the ranking for 174 rows in run A (238 on 13 Oct, when Apple answered more). Winning is not
  "only Apple": 165 of those 174 are matched by the free sources too.
- Why run B ends with rows to look at: 131 of the 138 rows show **no cover at all** (Apple's pictures are gone and
  Open Library has none either), 5 more have an Open Library cover address that did not load when measured
  (502/503 from its archive), 7 are rows nothing identifies. **Not one of the 138 is "nobody to ask"**: with Apple
  off, `unsure` is 0 by construction — every row was settled by a source that was asked.
- Run A's "needs a look" is the mirror image: 58 of the 114 are rows a source could not be asked (all because Apple
  refused), the rest show no cover because Apple's pictures never arrived.
- Choose edition is *better* without Apple: 1 of 166 rows with nothing to offer, against 21 of 119 in run A (Apple
  refused for 115 of them). The Catalogue, Open Library and the DNB offer editions for the work regardless.

### German-edition rows

The file has no language column; the import's own test (`probablyGerman`: the ISBN's language area first, the title
second) calls **160 rows German** — 152 by ISBN 978-3, 8 more by a German title.

| German rows (160) | A: Apple on | B: Apple off |
|---|---:|---:|
| matched | 158 | 157 |
| unmatched | 2 | **3** (all three a book only Goodreads knows) |
| matched via the DNB | 58 | **116** |
| matched only with Apple | — | **1** |
| shown without a cover | 38 | 86 |
| cover under the 300 px bar (of the 160 rows) | 44 | **95** |

The DNB is what carries the German half: 116 of 157 German rows are matched by it with Apple off, against 58 with
Apple on (in run A the ladder reaches an Apple edition — or gives up on the refusals — before the National Library
is asked). Apple's share of the German rows is one row.

### Q1 verdict: **yes, with these gaps**

667 of 709 (94.1%) match to a real Book with the free sources only, and 0 rows are left "unsure": every row is
settled, never parked on a source that was not asked. The 42 unmatched rows are a known tail: 41 of them a book only
Goodreads knows (Goodreads' cover is lent, so the row is not coverless either), 1 with no candidate anywhere.
Apple's own contribution to the match is small and it is the only thing lost:

- **9 rows matched only because of Apple** (a bad Apple day; a lower bound).
- 30 more of the 42 are rows today's Apple-on run left as "Apple refused, nobody was asked" — those are the rows a
  good day would match (13 Oct, same file, Apple refused from its 99th request: 38 rows were unmatched for that
  reason alone, and the plan's own full-file run of 14 Oct ended with 685 matched and 0 rows to look at). So the
  realistic ceiling of Apple's match value on this file is **~9 rows proven today, 30–39 rows on a day Apple answers**.

## Q2 — covers without Apple

### What the app asks and shows

| place | token width (CSS px) | pixels at 3× (a 390 px phone) |
|---|---:|---:|
| a list row, a search result, a sheet row (`sm`) | 40 | 120 |
| `md` (a shelf, a review card) | 72 | 216 |
| `lg` (currently reading) | 82 | 246 |
| **Book page hero, the reading page, the cover flight (`xl`)** | **140** | **420** |

- **"Good enough" for the largest place is ≥ 420 px wide**: the Book page's hero is 140 CSS px in a 2:3 box, so a
  3× device asks 420 px and the app's `srcset` picks Apple's 600 box for it. A list row needs 120 px. The Regal
  shelf's front cover is bounded by the same box (the `regal` layer is not in this checkout: not measured here).
- What each source is asked for: Apple any bounding box — `120x180bb` (`xs`/`sm`), `240x360bb` (`md`/`lg`), and
  `600x900bb` is what a Book keeps (`COVER_LARGE`); the image fits inside the box (a 2:3 cover arrives 600 × 900, a
  taller one 577 × 900). Open Library `-M` (up to 180 px wide) up to `md` and `-L` (up to 500 px high, typically
  300–430 px wide) above it; **the address the app stores for an Open Library cover is `-L`**. Goodreads' cover is
  taken as it is (its images are large: see below).
- The app's own floors: `MIN_COVER_SIDE` 40 px (below that, not a cover), `PREFERRED_COVER_SIDE` **150 px on the
  short side** ("low resolution"). The 300 px bar the brief asks about sits between the app's own floor and what the
  Book page wants.

### Cover sizes, matched rows

Measured by downloading each row's cover at the address the app stores it at (polite: one request at a time, ~1.8/s
per host), reading the pixels, and bucketing by width. Temp files deleted; nothing is in the repository.

| matched rows | A: Apple on (676) | B: Apple off (667) |
|---|---:|---:|
| no cover at all | 84 | **131** |
| under 150 px wide | 18 | 23 |
| 150–299 px | 66 | 84 |
| 300–599 px | 468 | 404 |
| 600 px and up | 36 | 20 |
| cover that did not load (Open Library 502/503) | 4 | 5 |

By source, Apple off (row B):

| cover from | rows | 300 px and up | 150–299 | under 150 | no image |
|---|---:|---:|---:|---:|---:|
| Open Library (`-L`) | 505 | 396 | 82 | 22 | 5 (502/503) |
| Goodreads, the last resort (31 matched, 41 unmatched) | 72 | 66 | 5 | 1 | 0 |
| Apple | 0 | — | — | — | — |

- Goodreads' images are the largest of the free sources (44 of the 72 rows ≥ 600 px wide) — they are the same files
  the website links, taken as they come.
- **Open Library's `-L` is not the biggest file it has.** Of the 494 Open Library covers of run B, the archived
  original (the same `covers.openlibrary.org/b/id/<id>.jpg` address with no size suffix, which redirects into the
  covers archive — the file Open Library was given) is larger than the `-L` the app asks for in **201 rows (41%)**;
  173 of those originals are ≥ 600 px wide. The originals are also much bigger files (the largest seen: 4.6 MB), so
  a pass that used them would need a size guard. Two examples of the same id: `-L` 333 × 500 vs original 1000 × 1500,
  and `-L` 313 × 500 vs original 891 × 1422; for other ids the original has the same pixels and only less
  recompression (38.9 kB against 33.8 kB). The app never asks for it today.

### Row by row: is the cover worse without Apple?

The 667 rows matched in **both** runs, compared bucket by bucket:

| | rows |
|---|---:|
| same bucket | 520 |
| **worse without Apple** | **118** (17.7% of the matched rows) |
| … cover lost entirely (Apple's picture gone, nothing found instead) | 75 |
| … still ≥ 300 px but smaller (600+ → 300–599) | 23 |
| … dropped under 300 px | 20 |
| better without Apple | 29 |
| a cover only with Apple (none without) | 74 |
| a cover only without Apple | 27 |

- The 29 "better without Apple": 27 are rows where Apple's match had **no cover at all** and the free run has one
  (26 of them Goodreads' last-resort cover, 17 of it ≥ 600 px wide), 2 where the free cover is bigger than Apple's.
- **Rows Apple saves** (Apple's cover ≥ 300 px, the free run's cover under 300 px or none): **96 of 709 (13.5%)** —
  75 rows that would end with no cover at all, 21 that would end under the 300 px bar.
- Apple's covers are never small: all 193 Apple covers of run A measured 300–599 px (157) or ≥ 600 px (36). Open
  Library's `-L` covers spread from 22 rows under 150 px to 396 rows in 300–599 px.
- This comparison understates Apple twice: run A is a refused Apple day (only 171 Apple answers arrived, so only 193
  rows carry Apple artwork), and the free run's cover fill had an uncontended 10-minute budget to fill what Apple left.
  On 14 Oct (same file, same code, more Apple answers) the plan's full-file run ended with **0 rows without a cover
  and 0 needing a look**.

### Q2 verdict: **yes, with a real cost — and the cost is not "Apple or nothing"**

Without Apple, more than three of four matched rows keep a cover of the same size class (520 of 667), but
**118 rows (17.7%) get a worse cover** and **96 rows (13.5% of the file) lose a cover at the 300 px bar: 75 of them
lose the cover entirely**. That is the number
the "Apple only as an upgrade lane" design has to answer for: the free run leaves 131 matched rows with no cover at
all, 112 matched rows under the 300 px bar and 42 unmatched rows whose only picture is Goodreads'. The good news for the
upgrade design: the app's ranking already knows how to replace a lent cover with Apple's own (`mergeCover`,
`coverKind`: Apple's `exact`/`ebook` beats `sameWork`/`goodreads`), and the missing covers are concentrated, not
spread: see the pass below.

## The gap list, with counts

| gap | rows |
|---|---:|
| matching: unmatched with the free sources | 42 (41 only Goodreads knows, 1 no candidate) |
| of those, matched by Apple alone (today, a bad Apple day) | 9 |
| of those, "Apple refused, nobody was asked" in run A (Apple may match them on a good day) | 30 |
| German rows unmatched with the free sources | 3 |
| covers: no cover with the free sources (matched) | 131 |
| covers: cover address that did not load (Open Library 502/503) | 5 |
| covers: under the 300 px bar with the free sources | 112 (23 tiny, 84 in 150–299, 5 not loaded) |
| covers: worse than with Apple (bucket by bucket) | 118 |
| covers: Apple's cover ≥ 300 px where the free sources give under 300 px or none | 96 |
| covers whose free picture is not the exact edition (lent: sameWork / Goodreads) | 66 |
| rows a free-only import would show as "needs a look" | 138 |
| rows a free-only import would show without a cover in the preview | 131 |

## Recommendation for the server job

**(a) Match with the free sources only, and upgrade covers from Apple on the device — this is what the numbers
support.**

- The match is 94.1% complete with the free sources and 0 rows are left unsure; the Catalogue, Open Library and the
  DNB settle every row, and Choose edition has an edition to offer for 165 of 166 rows. The DNB does the heavy
  lifting (129 rows, 116 of the 160 German ones), so the job's shape is "Catalogue → Open Library (identified, ~3/s)
  → DNB (the import budget: 583 calls, ~5 minutes of it, 120 calls a minute)".
- **The upgrade pass needs no new machinery**: the device already has the cover fill (`data/coverFill.ts`, its Apple
  lane paces one title search every 3 s — Apple's own ~20 calls a minute) and `mergeCover` replaces a lent cover when
  a better kind arrives. What it needs is a list of rows to ask for, which the job can leave behind (Book id + ISBN,
  cover kind of what it stored).
- **How many rows and calls:** the rows that want a touch are the **131 matched rows with no cover at all**, the
  **112 matched rows under the 300 px bar**, the **42 unmatched rows** (a Goodreads picture is not Apple's edition) and,
  if the owner wants the exact edition too, the 66 rows whose cover is lent (a Goodreads or another edition's picture).
  Union, overlaps removed: **298 rows**, of which 242 have a file ISBN (7 batches of 40).

  | pass | Apple calls | at ~20 calls/min |
  |---|---:|---:|
  | ISBN sweep for the 242 rows with an ISBN, 40 an ISBN per lookup, both storefronts | 14 (7 batches × 2) | ~1 min |
  | the 56 rows without an ISBN, one title search each | 56 | ~3 min |
  | worst case: the batch does not name an ISBN for most rows, so every row is asked by title | 298 | ~15 min |
  | every row of the file asked by title (what today's fill lane would do) | 709 | ~35 min |

  So: **the upgrade pass is minutes, not hours, and the file's whole Apple budget (~700 calls) fits an hour** — on
  the device, spread over the member's own address, invisible to her. Batches of 40 ISBNs are the difference between
  ~4 and ~15 minutes for the concentrated pass.
- Keep Goodreads as the last resort for the rows nothing else knows (41 of the 42 unmatched, 72 rows with a Goodreads
  cover) — the owner's flag and terms risk are unchanged (PR #327); it is also what makes the free run's unmatched
  rows *not* coverless.

**(b) Or keep Apple on the client for the match.** If the owner wants the 9 rows (today) to 39 rows (a good day) that
Apple alone carries, the cheapest shape is not the server but the device: the client has the file's rows and Apple's
budget from her own address, so a "finish the unmatched rows" pass costs one Apple title search per unmatched row
(~42 rows ≈ 3 minutes) and it can run after the job's push, in the same background fill the app already runs. The job
stays free-only and Apple's unpredictable per-address limit never gates a whole file — which is what the proposal
already plans for the cover side; this assessment says the match side can be treated the same way.

Either way, the server job should **cache what Apple later finds** (`fill_book_covers` already stores a found cover
on a Book the member holds), so the second member who imports the same book pays no Apple call at all.

## Uncertainty (be frank)

- **One address, one day, one file.** Both runs ran from one residential address on 15 Oct 2026, and Apple refused
  from run A's 24th second (after 85 requests) — the address was already hot from the measurements of 12–14 Oct. So
  the Apple-on column is a bad day: everything Apple looks like it buys here is a **lower bound** (9 rows matched
  only by Apple, 96 rows saved at the 300 px bar, 118 rows with a worse cover). Apple's behaviour also changes
  between days and is not published per endpoint.
- The reference for a day Apple answers is the plan's own data (`docs/plans/import-quality.md`): 13 Oct, the same
  file, 658 matched with 38 rows unmatched *only* because Apple refused; 14 Oct, the final code with the DNB, 685
  matched, 0 rows to look at, 0 rows without a cover. Run A of today reproduced the same ballpark (676 matched).
- The Apple-off mode is a **script-level** measurement of "the free sources alone": it makes the pipeline's Apple
  questions answer "Apple has nothing" locally. A real server job simply never asks. The difference is only in the
  pipeline's internal bookkeeping, not in what the free sources find.
- Cover sizes are what each host serves *today* at the address the app stores; Open Library's archive copies and
  Apple's CDN are outside our control, and the one-off download of 578 + 595 covers was paced, not a sample of every
  cover on those hosts.
- Open Library ran through our own function (identified, ~3/s) with a **local placeholder contact**: the pace and
  path are the real ones, the identity is not production's.
- The Goodreads cover stage is unofficial API access (the owner's accepted risk); 72 rows of the file depend on it,
  41 of them rows no other source knows at all.

# First published: where the work's date comes from and how to trust it

Assessment only. No code, no migration. Second of two: the first
(`published-dates-2026-11-15`, branch `origin/docs/published-dates`) established the plumbing
(option A: hero shows the work's year, edition line below); this one is about data quality.

Owner's ask: always the root book's first year, whatever the edition's language or date.

## 1. Where the work's year comes from, per source

`first_year` is written by `private.enrich_work`
(`supabase/migrations/20261011012000_enrichment_queue.sql:488`):
`first_year = year when the payload carries one, else kept`. The payload's `year`
(`supabase/functions/enrich/enrich.ts:361`):

```ts
year: work?.year ?? olWork?.year ?? null,
```

Wikidata first, Open Library second. What each means upstream:

### Wikidata P577 (`supabase/functions/enrich/wikidata.ts:291`)

`year: yearOf(time(entity, 'P577'))` — the first non-deprecated, non-`novalue` P577
claim (`wikidata.ts:83-89`, `126-133`), year part only (precision ≥ 9).

- **Which item is read**: the work item — unless the matched item is an edition/translation,
  in which case enrich climbs via P629 to the parent and takes the parent's date
  (`supabase/functions/enrich/enrich.ts:241-244`). Duplicate *work* items (two items for
  one novel) are not handled: whichever item is picked supplies the year.
- **What P577 means on a work item**: the publication date of the work — in practice the
  *original-language* first publication (e.g. 1969 German for a novel later translated to
  English). Wikidata models translations as separate edition items linked by P629; the work
  item's P577 is the original's date. **For a German edition of an English novel the hero
  would show the English first publication** (see §5: owner's decision).
- **Several dates**: first claim wins, preferred rank first (`claims()` sorts preferred
  first). A work item carrying both original and translation dates yields whichever is
  ranked first — unverified how often that misfires, but the P629 climb
  (`enrich.ts:241-244`) means edition dates rarely leak in that way.

### Open Library `first_publish_date` + search `first_publish_year`

Two different fields, both OL:

- **Work record** (`supabase/functions/enrich/openlibrary.ts:122-138`): `first_publish_date`
  string, first 4-digit group → year. OL computes this as the earliest publication date
  across the editions it has catalogued for the work — **the earliest *catalogued* edition,
  not necessarily the true first**. For a well-catalogued classic this is the true first;
  for an obscure or recent trade work it can be whatever edition was added first, or a
  reprint if no earlier edition is in OL.
- **Search doc fallback** (`supabase/functions/enrich/openlibrary.ts:215`): the search
  index's `first_publish_year`, which is the same earliest-edition computation in
  aggregate form. Used when the work record has no usable date — via `olWork.year`, which
  is one of the two already (`enrich.ts:361`), **not** a third source.
- **SPARQL list path** (`supabase/functions/enrich/wikidata.ts:432,444`): author/series
  listings take `MIN(?date)` over P577 — a minimum over *recorded* dates, same caveat as OL:
  the earliest recorded, not provably the true first. Only feeds author/series work rows,
  not the Book's own payload directly.

### Google Books / Apple / DNB: no work-level date

- **Google**: `volumeInfo.publishedDate` is per volume = the edition's date
  (`web/app/data/googleBooksRecord.ts:142`). Enrich never asks Google for anything but
  genres, and only when no genre signal exists (`enrich.ts:336-343`). No work date possible.
- **Apple**: `releaseDate` is the store release of that ebook (`web/app/data/apple.ts:117`).
  No work concept. Not consulted by enrich at all (only `appleGenres`, genre labels).
- **DNB**: `dc:date` of the catalogue record → edition year
  (`web/app/data/dnbRecord.ts:106`). Edition-level by construction (a record per printing).
  Not consulted by enrich at all.

Net: the work year is Wikidata P577 where present, else OL's earliest-catalogued-edition
date. Nothing else can supply one.

### The 149 enriched-but-yearless: OL has no date, or enrich never asked?

Read the code path (`enrich.ts:195-207`, `361`):

- A work payload is built when `work || olWork` exists; its year is `work?.year ??
  olWork?.year ?? null`. So a work row with an `openlibrary_key` went through
  `sources.olWork(workKey)` — **the work record was fetched, and its `first_publish_date`
  was parsed** (`openlibrary.ts:122-138`). If that parse yielded null, `olWork.year` is
  null and there is no second OL question: the search doc's `first_publish_year` is only
  read in the title-search path (`openlibrary.ts:215` — the `OlSearchDoc`), never as a
  retry for a fetched work record.
- Wikidata was also asked (or attempted) for the same work: `work?.year` null means no
  P577 on the item found, or no item found (no P648 link, title search missed).

So the 149 are **works OL knows by key but dates with no `first_publish_date`, and
Wikidata either has no item or no P577**. Two fixable sub-cases, one not:

1. OL record gained a date since, or the search index has `first_publish_year` while the
   record lacks `first_publish_date` — a re-fetch would fix. Cost: one OL work fetch per
   work (cheap, polite client, cached) — but only if the 30-day refresh
   (`enrich-refresh` daily, `migrations/…_enrichment_queue.sql:698`; `enrich_refresh`
   re-queues books enriched > 30 days ago) re-runs enrich and enrich actually re-reads
   the date. It does: `enrich_work` overwrites `first_year` whenever the payload carries
   `year` (`…_enrichment_queue.sql:488`, `coalesce(new, old)`), and refresh re-runs the
   whole enrich (`enrich_refresh` → queue → drain). **Fixable by waiting for refresh, or
   one targeted re-queue.**
2. Wikidata has the date but the link was missing at enrich time (no P648, title search
   missed) — a re-run with today's links may find it. Same mechanism, same cost.
3. Neither source dates the work (obscure/small-press/recent: the sample titles —
   *Want to Know a Secret?*, *Tempting Little Thief*, *Heartstopper Vol 4* — are recent
   trade books OL catalogues by edition before it computes a work date). **Not fixable
   from current sources**; needs a new source or time.

Which of the 149 falls in (1/2) vs (3) is **unverified, needs a read-only query from the
coordinator** (fetch the 149 work records' `first_publish_date` today).

## 2. The bad-link problem and the guards

### What matching actually checks

Three paths, in order (`enrich.ts:195-207`):

1. **Edition key or ISBN** (`matched_by = openlibrary | isbn`): edition → its work link.
   ISBN editions carry one guard: an edition found by ISBN counts only when its title
   matches the Book's (`enrich.ts:195`). No author check. OL's own ISBN→edition filing is
   trusted past that (the Dune Messiah / Dune comment at `:193-194` shows it misfiles).
2. **Title search** (`matched_by = title`): first doc whose title matches (folded,
   subtitle-insensitive: `match.ts` `titlesMatch`) **and** one author name matches
   (`namesMatch`: same surname + same first initial, `match.ts`). First hit wins (`docs.find`).
3. **Wikidata leg** (any path): candidates from OL's P648 link, else `P648=<work key>`
   search, else title-among-author's-works. Edition items climb P629 to the parent.
   Then the title guard: the item's title (any asked language) must match the Book's —
   or, when no title search ran, OL work's title (`enrich.ts:250`). **This guard applies
   to the OL path too** whenever candidates exist: a wrong OL work whose Wikidata link
   points at a wrong-titled item is rejected (the Dune Messiah / Dune comment at
   `:247-249` is exactly this case). But when Wikidata has no candidate at all, the OL
   work stands unguarded except by step 1/2's checks.

`matched_by` records *which path found the work*, not how sure it is — consistent with
the brief's numbers (weak predictor of quality).

### No plausibility guard exists anywhere

- `first_year > published_year` (impossible): nothing checks it. The only year check in
  the schema is `works_year_plausible` (`first_year between -3000 and 2100`,
  `migrations/20261011011000_authors_works_series.sql:130`) — range, not consistency.
  `books_year_plausible` likewise constrains the edition year alone.
- `first_year` decades before the edition (legitimate for classics): nothing checks it
  either, correctly — it is the normal case for a reprint.
- Title similarity at match time is the only guard, and it is loose by design
  (subtitle-insensitive, translation-tolerant titles).

### The cheapest guards that catch the two known-bad cases

Both known-bad cases die to one comparison, computed at display time from fields already
on the row (no fetch, no fuzzy system):

- **G1 — impossible: `firstYear > year` suppresses the work year.** Catches *Dream Again*
  (edition 1900, work 2020). False negatives: none in principle — a work cannot postdate
  its edition — except where the *edition* year is the wrong one (the OL search fallback
  stored the work's year in `published_year`, first assessment §1; then `firstYear >
  year` can fire on a correct link). Rare and visibly odd either way.
- **G2 — absurd gap + young edition: `year - firstYear > N` with a recent `year`
  suppresses the work year.** Catches *The Unhoneymooners* (edition 2020, work 1934)
  only with N small enough to also catch real cases — a 2020 edition of a 1934 novel is
  *usually* a legitimate reprint. G2 cannot distinguish "wrong link" from "reprint of an
  old book" without title comparison, so on its own it trades false positives for every
  classic reprinted recently.

Honest accounting against the 46 cases differing by 20+ years: G1 catches only the
impossible ones (6 known: 5 openlibrary + 1 title match). G2 with N = 20 would flag all
46 — **suppressing the 25 openlibrary-path and most isbn-path cases that are probably
correct reprints**. That is the wrong trade: the 16 `isbn`-path 20y+ cases have perfect
year coverage and title-guarded editions; suppressing them re-hides exactly what the
owner asked to see.

The guard that actually separates them is the one already at match time: title agreement
between work and Book. The two known-bad links (*The Unhoneymooners* → a 1934 work,
*Dream Again* → a 2020 work for a 1900 edition) are title mismatches that slipped through
because the OL leg has no title check on the key/ISBN path — only the ISBN-edition guard
(`enrich.ts:195`) and Wikidata's guard (`enrich.ts:250`, Wikidata-candidates-only).
**The minimal correct fix (code, not display): apply the title guard to the OL work on
the key/ISBN path too** — reject (or flag `matched_by`) an OL work whose title matches
neither the Book's nor, failing that, leaves the Book title-only. That is beyond this
assessment's remit (no code), but it is the one intervention that catches wrong links
without punishing reprints. A display-time version — distrust the work year when the
work's stored title differs materially from the Book's — is possible (`works.title` is
on the row) but title comparison across translations is exactly the false-negative
factory the brief rules out; do not fuzzy-match at display time.

Proposed display guards (cheap, no new data):

- Suppress the work year when `firstYear > year` (impossible — catches Dream Again and
  its 5 siblings).
- Suppress the work year when the work row's title matches neither the Book's title nor
  the edition's (exact folded match only — catches The Unhoneymooners *if* the stored
  work title is the 1934 book's; silent otherwise, never fuzzy).
- Everything else shows, however large the gap. The 20y+ cases that survive are
  overwhelmingly real reprints — that is the feature, not the bug.

## 3. The two gap groups

### 149 enriched-but-no-year: fixable by retry, some never

Covered in §1; the decision table:

| Sub-case | Fix | Cost |
|---|---|---|
| OL record has since gained `first_publish_date`, or search index has `first_publish_year` the record lacks | Daily `enrich-refresh` re-runs enrich and `enrich_work` overwrites `first_year` when the payload carries one (`…_enrichment_queue.sql:488,698`) — or one targeted re-queue | One OL fetch per work |
| Wikidata has P577 but the link was missing (no P648, title search missed) | Same refresh/re-queue with today's links | Same |
| Neither source dates the work (recent/small-press trade: the sample titles look exactly like this) | Not fixable from current sources | Needs a new source or time |

Which of the 149 is which: **unverified, needs a read-only query from the coordinator**
(re-fetch the 149 work records' `first_publish_date` today). Expectation, not a number:
recent trade books skew to the third row.

A Wikidata lookup for a work that only has an `openlibrary_key`: candidates already
exist — `P648=<work key>` search (`enrich.ts:228`) — so no new lookup is needed, just the
re-run. Cost per book is one enrich pass (seconds, polite client); the daily refresh
already pays it on a 30-day cycle.

### 128 with no work row: why matching failed, what can close

`enrich_save` writes `book_works` only when the payload has a work object; `matched_by`
falls back to `'openlibrary'` when a work exists but no path set it (`enrich.ts:391`).
No row means every path missed. From the code (`enrich.ts:187-207`), the causes in order:

1. **No ISBN and no OL keys, title search missed** — Apple imports (no ISBN path guard
   beyond title: `enrich.ts:199-201`) and catalogue rows without identifiers. Fixable if
   identifiers arrive later (catalogue-check backfills keys; then refresh matches).
2. **ISBN exists but OL files it under the wrong edition and the title guard rejects it**
   (`enrich.ts:195`) — correctly unmatched, stays unmatched until OL fixes its filing.
3. **Title search found nothing** (`docs.find`, `enrich.ts:204`): first-author name
   missing or folded differently, or OL has no record. Retrying later may work as OL grows.
4. **Owner books (manual, `owner_id is not null`)**: `book_work_key` returns null for them
   by design (`20261116010000_book_notes.sql:322-335`); enrich skips non-catalogue books
   (`enrich_save` deletes the queue entry for `owner_id is not null`). **Structurally
   cannot** — no work, ever, by design.

Share of (4) in the 128: unverified, needs a read-only query. If the owner's catalogue is
mostly catalogue books, (1)–(3) dominate and the group shrinks slowly with refresh; (4)
never does.

## 4. The display rule, with the guards

First assessment's rule was `firstYear ?? year`. With §2's guards (G1: impossible,
`firstYear > year`; G2: folded-title mismatch against work title):

| `firstYear` | edition `year` | guard says | hero shows | edition line |
|---|---|---|---|---|
| set, ≤ `year`, titles agree | set | clean | **`firstYear`** | "This edition: {publisher}, {year}" |
| set, > `year` | set | G1 impossible (Dream Again + 5 siblings) | **`year`** (work year suppressed) | same edition line |
| set, titles disagree | set | G2 suspicious (Unhoneymooners *if* stored title is the 1934 book's) | **`year`** (work year suppressed) | same edition line |
| set, titles disagree, stored title unavailable | set | cannot judge | **`firstYear`** (show; flag nothing — honest gap, §6) | same edition line |
| set | null | nothing to compare | **`firstYear`** | publisher only / nothing |
| null (149 or 128) | set | gap, not error | **`year`** (today's behaviour — never a hole where today shows a date) | nothing new (nothing to contrast) |
| null | null | both unknown | nothing (today's behaviour) | nothing |

Notes:

- A work year *younger* than the edition's is never trusted (G1): a reprint of a work
  whose OL record is wrong is indistinguishable from a wrong link at display time, and
  showing it would print an absurdity ("first published 2020" on a 1900 edition). The
  edition year is always at least true of the copy in hand.
- A large gap that passes both guards shows — the 20y+ survivors are the feature (real
  reprints: 1984 → 1949, Time Machine → 1895). Suppressing them would re-hide the
  owner's ask.
- Both-null and yearless-work cases keep today's rendering exactly: the rule only ever
  *replaces* a shown year with a better one, never removes one.

## 5. Recommendation

**Show `firstYear` guarded by G1+G2, fallback `year` — the first assessment's option A
with the §2 guards.** One optional read-path column, one fallback expression, one new
edition line; no migration; every null case renders as today. Pair with the match-time
title guard on the OL key/ISBN path (one `titlesMatch` check in `enrich.ts`, future work,
not this proposal) — that is the intervention that actually shrinks the wrong-link set
without punishing reprints.

### Needs the owner

1. **Translation question (still open, now confirmed from code)**: P577 on the work item
   is the *original-language* first publication — Wikidata models translations as edition
   items under P629, and enrich climbs to the parent (`enrich.ts:241-244`). So a German
   edition of an English novel shows the English first year. Confirm: hero shows original
   first publication in all languages, or does he want first-in-his-language (a different
   feature: "First published 1969 · German first edition")?
2. **Edition line placement**: under the description (proposed) vs in the facts row.
3. **Library rows**: one screen now (Book page); decide later whether rows/cards follow.

## 6. What could not be verified

No production query was run or attempted. Per the rule, no percentage beyond the brief's.

1. Which of the 149 are (1/2) vs (3) in §3 — needs a read-only re-fetch of the 149 work
   records' `first_publish_date` today (coordinator).
2. Share of owner/manual books in the 128 (cause 4 vs 1–3) — needs a read-only count.
3. Whether the stored `works.title` of the two known-bad links is actually the wrong
   book's title (G2 catches them only if so) — needs a read-only look at the two rows.
4. How often a work item carries several P577 dates with preferred-rank putting a
   translation first — code reads first-preferred; frequency unverified.
5. `matched_by` values predate the current three-way set? The check constraint allows
   only `openlibrary | isbn | title` (`public.book_works`), so no.
6. Whether `enrich-refresh` is actually scheduled in production (the `cron.schedule` at
   `…_enrichment_queue.sql:697-698` runs only where pg_cron is available) — if not, the
   149 wait indefinitely and a manual re-queue is the fix path.

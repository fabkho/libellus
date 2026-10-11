# Enrichment: authors, series and genres

The data behind the author pages, the series line and Home's "Next in your series" (#167) and the
canonical genres (#168), from the round specified in #166. This is the data layer only; the screens come
in phase 2 and use what is below.

**Where it comes from.** The `enrich` edge function (supabase/functions/enrich/README.md) asks Wikidata
first, Open Library as the fallback, Wikipedia for the author's intro, Wikimedia Commons for the
portrait and Apple Books for its genre names, and stores what it finds in the database. Members never
see a source named, except where its licence asks for a credit (below). The app never calls these
sources; it reads the database, so everything works offline from whatever the device kept, and a Book
nobody knows simply has no author page data, no series and no genres.

**When.** A Book that enters the Catalogue is queued and enriched within minutes (pg_net + pg_cron);
Books already there are filled by a one-off backfill; authors, works and series are refreshed after 30
days. Manual books are never sent anywhere (a member may still set their genres and series by hand once
the UI offers it for them: the corrections are per Library entry).

## The canonical genres

`web/app/data/enrich/genres.ts` (also the `genres` table): twenty stable ids, the i18n keys of their
labels are `genre.<id>` (en.json):

`sci-fi` `fantasy` `horror` `crime` `thriller` `romance` `literary` `historical` `classics` `ya` `graphic`
`poetry` `short-stories` `nonfiction` `biography` `history` `science` `philosophy` `self-help` `essays`

The mapping (Apple genre names, Wikidata genre items, Open Library subject keywords → ids) is versioned
(`GENRE_MAP_VERSION`) and unit-tested (`web/tests/enrich-genres.test.ts`). A Book gets at most three,
best first, never one genre twice. Wikidata comes first: where it names a Book's genres, another source
only adds a genre it is sure of. A new mapping version is applied to every Book without asking any
source again (`enrich` action `remap`, from the stored signals).

## API for phase 2

All readers are RPCs a signed-in member calls (security invoker: they read only what RLS lets her
read); the writers are security definer and act on her own Library entries only. Each has a typed
repository in `web/app/data/enrich/` (framework-free, `{ online }` like the others: writes are refused
offline with `offline`), tested in `web/tests/enrich.test.ts`.

### Authors — `createAuthors(client)` (`authors.ts`)

| Call | RPC | Answers |
|---|---|---|
| `page(key, language?)` | `author_page(p_author, p_language)` | `AuthorPage` or null |
| `forBook(bookId)` | `book_authors_of(p_book)` | `[{ position, name, authorId, key }]`, credit order |
| `forBooks(bookIds)` | `book_authors_for(p_books)` | the same for many Books at once, by Book id (a list's rows) |
| `refresh(key)` | `enrich` function, `{"action":"author"}` | whether it fetched again (only when stale) |

The author page is opened by any of the author's keys: a Wikidata item (`/author/Q46248`), an Open
Library id (`/author/OL25712A`) or the row's uuid; `forBook` gives the key a Book page links to. Only the
Book's real authors are linked: a translator or an introducer the edition credits is not.

```ts
AuthorPage = {
  author: {
    id, key, name, wikidataId?, openLibraryKey?,
    born?: { date: '1948-04-28', precision: 11 },   // 9 year · 10 month · 11 day
    died?: { date, precision },
    photo?: { url, credit: { source: 'commons' | 'openlibrary', artist?, licence?, licenceUrl?, fileUrl? } },
    summary?: { text, title, url, language },          // her language, else 'en'
    fetchedAt?,
  },
  genres: GenreId[],                                   // the chip row, from the works and her Books
  series: [{ id, name, wikidataId?, parentId?, parentName?, works: WorkCard[] }],  // reading order
  standalone: WorkCard[],                              // novels and novellas in no series
  other: WorkCard[],                                   // collections, non-fiction, works without a position
  stale: boolean,                                      // older than 30 days, or works never fetched
}

WorkCard = {
  workId?, wikidataId?, openLibraryKey?, title, year?, kind?, position?, coverUrl?, genres?,
  edition?: { title, isbn13, openlibrary_edition_key, cover_url },   // in the asked language: "+ Want to read"
  entry?: { entryId, bookId, status, rating?, finishedOn? },         // hers, if she has the work
}
```

Works are deduplicated per work; a title is her own edition's where she has one, else in the asked
language (the work's title or its edition's), else in English, else the work's own; covers and the edition
to add follow the same languages. The work's own title is picked English first, then Wikidata's default
label `mul` (items increasingly keep a name shared by many languages there instead of in English: Unseen
Academicals has only `mul` and `de`), then any other language. A work in a sub-series is listed there and not again
in its parent (Discworld lists the books in none of its sub-series; City Watch lists its own). Her own
Books of the author whose work no source knows are listed under `other`.

**Credits** (CC BY-SA, CC BY …): show the photo's `credit` (artist and licence, linking `fileUrl`) and
"From Wikipedia" linking `summary.url` wherever the photo or intro is shown.

### Series — `createSeries(client)` (`series.ts`)

| Call | RPC | Answers |
|---|---|---|
| `forBook(bookId, language?)` | `book_series_info(p_book, p_language)` | `{ overridden, series: BookSeriesPlace[] }` |
| `series(seriesId, language?)` | `series_works(p_series, p_language)` | one series in order (the series sheet) |
| `started(limit?, language?)` | `started_series(p_limit, p_language)` | Home's row: the series she has started and not finished, latest activity first: `[{ series, finished, count?, activeOn?, next: WorkCard }]` (`next_in_series` stays in the database for installed apps still on the older shape) |
| `muted(limit?, language?)` | `muted_series_list(p_limit, p_language)` | the started series she muted, the same items (not in `started`) |
| `mute(seriesId)` / `unmute(seriesId)` | `mute_series(p_series)` / `unmute_series(p_series)` | `true`; the whole series, idempotent, `series_not_found` for one she cannot see; online only, not queued |
| `set(entryId, { name, position })` / `set(entryId, { seriesId, position })` | `set_entry_series` | her correction, then `forBook` |
| `clear(entryId)` | `set_entry_series(…, null, null, null)` | "in no series" |
| `reset(entryId)` | `reset_entry_series(p_entry)` | back to the computed series |

`started_series` reads every work that is at least in progress. A series is started when one of its works is
currently reading or finished (Want to read, or a work given up on, alone does not start it) and listed while one
of its works is open (not finished, not read now, not given up on); the next open work comes with her status of it.
`count` is the Catalogue's whole-numbered positions: the total is whatever the Catalogue knows, so a series whose
every known work is finished is complete however many more may exist.

`BookSeriesPlace` is a series (`id, name, parentId?, parentName?, source, count, works`) with the Book's
`position` (decimals allowed: 0.5, 2.5) and where the membership comes from (`membership`: `member`,
`wikidata`, `openlibrary`). The most specific series comes first, so "Book 2 of 9 · The Expanse" reads
`series[0].position` of `series[0].count` (whole-numbered positions). A Book can be in two (Feet of Clay:
City Watch 3, Discworld 19).

**Split volumes are not members.** Wikidata files the paperback halves of a long novel as items of its
series at a decimal ordinal ("The Dragonbone Chair, part 1" = 1.1 … "To Green Angel Tower, Part 4" = 3.4:
Memory, Sorrow, and Thorn had eleven "books", not three). A work at a decimal position x.y of a series whose
novel at position x is titled "<its title>, part N" (`isSplitVolume`, wikidata.ts) is not stored as a
member — not from an author's works, not from a series' works, and a Book that is one keeps its work without
the place. A decimal alone stays a place (a novella between two novels: Ender's Saga 1.5, The Murderbot
Diaries 7.5, The Last King of Osten Ard 0.5), and so does a title like "..., part 2" with no such novel in
its series. `private.drop_split_volumes()` (migration 20261026010000) removes the ones stored before by the
same rule: the link always, the work only when no Book and no other series needs it.

`next` answers, per series she finished a work of, the first later work she has not finished (with its
status, so the UI may leave out one she is reading already); the sub-series rather than its parent; most
recent finish first. Her corrections count.

A correction by name finds the Catalogue's series of that name or creates one that is hers alone. Her
corrections are per Library entry: they follow the entry through Change edition and go with it.

### Genres — `createBookGenres(client)` (`bookGenres.ts`)

| Call | RPC | Answers |
|---|---|---|
| `forBook(bookId)` | `book_genres(p_book)` | `{ genres, overridden }`: hers for her entry, else computed |
| `library()` | `library_genres()` | every entry of her Library with its genres (the filter, the figures) |
| `set(entryId, genres)` | `set_entry_genres(p_entry, p_genres)` | 0–3 ids, her order, duplicates folded |
| `reset(entryId)` | `reset_entry_genres(p_entry)` | back to the computed genres |

Errors (`EnrichErrorCode`): `entry_not_found`, `invalid` (an unknown genre, more than three, a bad
series correction), `series_not_found`, `not_signed_in`, `offline`, `unknown`.

### Tables (read-only for members)

`genres`, `book_genres` (computed, rank 1–3), `entry_genres` (hers), `authors`, `works`, `work_authors`,
`series`, `work_series`, `book_works`, `book_authors`, the view `book_series`, `entry_series` (hers),
`book_enrichment` (per Book: `enriched` / `not_found` / `failed`, sources, when). Catalogue facts are
readable by every member and written only by the service role; her corrections only by her, through
the functions above. A series a member named is visible to her only.

## The screens (#167, phase 2)

The author pages (`/author/<key>`), the Book page's author links and series line, the series sheet and
her correction, and Home's "Next in your series" are described in docs/parity.md (Author page; Series
line, series sheet and correction; Next in your series). What they read last is kept on the device under
`libellus.enrich` (`data/enrich/device.ts`), so they open offline. The genre screens are described in
docs/parity.md, *Genres*; the author page's genre chips use the same labels (`genre.<id>`).

## Not yet

- The outbox does not carry the corrections yet (`sync_write`): they need a connection.

## Trial: the German National Library (DNB) as an import source

**Verdict: not worth shipping for the import.** It finds the edition of about half of the books no other
source knows, but it gives no cover and no usable genre, so what the owner sees in "Needs a look" does not
change. The trial code is on the branch `trial/dnb-source` (one commit: `web/app/data/dnb.ts`, its tests and
recorded fixtures, the hook in `findEdition`); this document is all that is proposed for merging.

### What was tried

The Google Books API was declined (its terms forbid storing the data and require branding). The DNB
catalogue is CC0: no attribution, no storing limit. Its SRU interface
(`https://services.dnb.de/sru/dnb`, CQL) answers cross-origin reads (`access-control-allow-origin: *`), so
the trial is a plain client module like the Apple and Open Library ones, no Edge Function. Record schema
`oai_dc` (flat, read with a few patterns; no XML parser). Queries: `num=<ISBN-13>`, and for a title
`tit="…" and per="<surname>" and (bbg=Aa* or bbg=Oa*)` (printed and online books; audio and music left
out). A record gives title (`Titel : Untertitel / Verfasser`), creators (`Nachname, Vorname [Verfasser]`),
publisher, year, language, extent (`622 S.`), ISBNs, and two subjects: the DDC class and the DNB's own coarse
group (`B Belletristik`, `K Kinder- und Jugendliteratur`, `S Schulbücher`). It was asked last, only for rows
the Catalogue, Apple Books and Open Library did not find: an ISBN lookup for a row with an ISBN, a title and
author search for a row without. The found record becomes an `import` Book (no migration); the title and
authors stay as the file says them (the trade's subtitles are noise: "Roman - Die hochwertig veredelte
Ausgabe"). Its own circuit breaker: three errors in a row rest it for a minute (the SRU reports a failing
converter as a diagnostic with HTTP 200, which a status check misses).

### Numbers (the owner's 709-book Goodreads export, run on 11 October 2026)

Before, the shipped pipeline (#303) without DNB: 709 rows in 532 s, **211 found by no source** (160 with an
ISBN no source knows, 51 without). The earlier run of the same file found 166 unfound (98 and 68): Apple
answers differently from day to day once its per-address limit is spent (44 Apple matches today against 135),
so compare the DNB gain with today's 211.

DNB added for those 211 rows:

| | |
|---|---|
| found by DNB | **103** (49 % of the unfound; 14.5 % of the file): 90 by their exact ISBN, 13 by title and author (these got an ISBN) |
| still found by no source | 103 (65 with an ISBN, 38 without); 5 more were found by Apple on being asked again |
| false matches in 30 DNB-only hits checked by hand (all 13 title hits, 17 of the 90 ISBN hits) | **0** (same book, same author); most record titles carry the trade's subtitle, hence her title is kept |
| language of the 103 | 101 German, 2 English (special editions listed under a German publisher) |
| calls / errors / time | 206 calls, 0 errors or timeouts, 102 ms on average: 21 s in all, about **5 s** of wall time at four rows at once |
| 20 well-known German titles by hand (title and author) | **20 of 20** found, 20 calls, 0 errors |
| covers for the 103 | **1** (Open Library cover by the DNB ISBN) |

`MARC21-xml` answered with a converter diagnostic on all five tries, so only `oai_dc` was used (0 errors in
about 250 calls).

### Why the verdict is no

- The 90 ISBN hits are rows the file already knew: Goodreads' export carries the ISBN, publisher, pages and
  year. DNB adds the language and a confirmation that the edition exists. Only the 13 title hits gain a thing
  that was missing (the ISBN).
- Those rows stay without a cover, which is what the preview treats as the bad sign: they would move from
  "added as the file says" to "matched, without a cover" and stay in the visible Needs a look list. The count
  the owner sees does not shrink.
- No cover is available from DNB: its catalogue shows covers (`portal.dnb.de/opac/mvb/cover?isbn=…`, 10 of
  12 sampled ISBNs answered an image), but only under an agreement between the German Library Association,
  VG Bild-Kunst and the VLB cover service; re-use needs a contract with the VLB (see
  https://www.dnb.de/EN/catalogueimage). Same kind of problem as Google Books. Not usable.

### Where it would help, where not

| Place | Value | Effort |
|---|---|---|
| Import | Low, as measured: the language and 13 ISBNs for 709 books | Done on the trial branch; shipping it is a day (merge, German copy for the note, parity.md) |
| Barcode scan / add by ISBN for a German book Apple and Open Library do not know | Good: a title and authors where there is none | About half a day (`lookupIsbn` is written) |
| Edition picker (Change edition) for German books | Moderate: German editions with publisher, year and pages (13 same-work records for one well-known title); rows without covers | Half a day plus a ranking that drops sets and reprints |
| Search Palette | Low: German results with no cover look poor; dedupe by ISBN needed | A day |

### What is still missing, and the cheapest fill

- **Covers.** No free source for German editions was found: Open Library has the cover of 1 of 103 ISBNs, DNB's
  and the VLB's are licensed. The remaining options are a VLB cover-service contract, or Apple's German
  storefront by title (the search already asks `de-DE`).
- **Genres.** DNB's `oai_dc` has only the DDC class and the coarse group: fiction is `B Belletristik` / `830
  Deutsche Literatur`, children's books `K Kinder- und Jugendliteratur`, which map to at most `ya` and the
  non-fiction classes (DDC 9xx → `history`, 1xx → `philosophy`, 5xx → `science`), never to `crime`, `fantasy`
  or `romance`. The RDF record (`recordSchema=RDFxml`) lists the GND subject headings as ids; their labels
  come from `https://lobid.org/gnd/<id>.json` (CC0, `access-control-allow-origin: *`), and a table of GND
  genre headings (Kriminalroman, Fantasy, Liebesroman …) to our twenty ids would be needed. Feasible, one to
  two days with a unit-tested mapping; how many novels carry such a heading was not measured (the `oai_dc` samples showed only
  the coarse group). Wikidata and Open Library subjects (above) stay the better source.

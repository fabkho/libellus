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
| `forCredits({ workKey, names, keys })` | `authors_by_ref(p_work, p_names, p_keys)` | the authors of a Book the Catalogue has none for: `[{ ref, position, name, authorId, key }]`, by Open Library author id (`ref` the id), by the authors of the Book's work (`ref` null), by credited name (`ref` the name) |
| `refresh(key)` | `enrich` function, `{"action":"author"}` | whether it fetched again (only when stale); for an Open Library id no row has yet, builds the row |

The author page is opened by any of the author's keys: a Wikidata item (`/author/Q46248`), an Open
Library id (`/author/OL25712A`) or the row's uuid; `forBook` gives the key a Book page links to. Only the
Book's real authors are linked: a translator or an introducer the edition credits is not.

The author name on a Book page always links where a key can be had, in the Catalogue or not
(`AuthorLine`, `creditedAuthors` in `web/app/utils/enrich.ts`): the Catalogue's linked authors first; a
Book with none (a search result, a work opened from an author's page, one nobody has enriched) asks
`forCredits` by what the page knows — the Open Library author ids the search gave (`BookSnapshot.authorKeys`),
the Book's Open Library work, the credited names — and a name nothing answers stays plain text. An Open
Library id no `authors` row has yet is linked by the id; opening that page asks the `enrich` function to
build the row from Open Library (only Open Library ids it knows; no Wikidata item or invented key).

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

## German editions from the German National Library (`dnb-lookup`)

Where Apple Books and Open Library do not know a German book, the German National Library (DNB, Deutsche
Nationalbibliothek) often does: its catalogue is open data (CC0: no attribution, no storing limit; the privacy
policy names it as a courtesy). It gives the *edition*, not the book's life around it: title, authors, ISBN-13,
publisher, year, language, pages. No cover (the covers its catalogue shows are licensed to libraries and the VLB
sells them: not usable) and no real genre (a DDC class and `B Belletristik`, see the trial in the draft PR #306).
It is used in the four places a member meets an unknown German edition: the barcode scan and the ISBN lookups, the
edition picker, and the import's match (owner decision 13 Oct 2026 lifted the earlier "only scan and Book page
picker" rule; what it does for the import is measured in docs/plans/import-quality.md).

| Where | What happens |
|---|---|
| Barcode scan, a typed ISBN in search, a book page opened cold (`createSearch`, `lookupIsbn`) | Asked last and only when the Catalogue, Apple and Open Library found nothing for the ISBN: the edition shows like any other result |
| My edition isn't listed → ISBN (`createEditions().lookupIsbn`) | The same last resort |
| Change edition / Choose edition (`createEditions().find`) | Editions of the work by title and first author, only where German is in play (`wantsGerman`); one row per ISBN-13, the facts filled into a row another source has; cover-less rows sort after those with a cover, unless German is the member's language and the edition is German |
| Adding or picking one (`createLibrary` → `catalogued`) | A member may only add or pick a Catalogue Book, so the function's `book` action first makes it (source `import`, from what the DNB says about the ISBN, with the cover the app resolved or Open Library's) |
| The import's match (`createSearch`'s ISBN step, `titleCandidates`, data/bookImport.ts) | The last resort of the ISBN lookup above, and the title ladder's ONE question (`dnbQuestion`, data/import/queries.ts: the main title and the first author) — asked **early** for a row that is probably German (ISBN group 978-3, the file's language, or the title's little words: `probablyGerman`), **last** for any other row the ladder found no covered edition of its work for, never for a row the ladder settled. Its editions join the one candidate pool (source `dnb`, written to the Catalogue as `import`: `book_source` has no `dnb`) with no cover of their own (the work's best is lent, or the row stays one to look at). A refusal is "not asked" (the row is `unsure`), never "nothing found". The import passes `purpose: 'import'` (its own 120-a-minute bucket) and paces itself 500 ms between calls |

### The function

`supabase/functions/dnb-lookup` (README there): `POST { action: 'isbn' | 'editions' | 'book', … }`, a signed-in
member (or the service role), 30 calls a minute per member (`edge_rate_hit`, bucket `dnb-lookup`: the scan, the
picker, adding a Book), 120 for an import (`purpose: 'import'`, bucket `dnb-lookup-import`, its own budget), 4 KB
bodies. The
SRU interface (`https://services.dnb.de/sru/dnb`, CQL, record schema `oai_dc`) answers cross-origin reads, so the
browser could have asked it directly; the function exists for the Catalogue write (`book`), the member limit, one
breaker and one politeness budget for all members (five requests a second, four seconds each, three failed
answers in a row rest it for a minute: its converter fails now and then with a diagnostic and HTTP 200). The
parsing is `web/app/data/dnbRecord.ts` (no imports; Deno and the browser both read it). There is no cache table:
the data is small, the answers are fast (about 100 ms) and a Catalogue Book is the cache of what was added.

Queries: `num=<ISBN-13>` (an ISBN-10 is converted first); `tit="<title>" and per="<surname>" and (bbg=Aa* or
bbg=Oa*)` (printed and online books; audio, music and periodicals left out, as are records titled like a reading).
The title is cleaned for readers: `Titel : Untertitel / Verfasser` → `Titel: Untertitel`, a leading
`[Original] ; ` and a series that leads the title (`Reihe 1 : Titel`, `Reihe, Band 3: Titel`) dropped; authors
`Nachname, Vorname [Verfasser]` → `Vorname Nachname`, translators, readers and artists left out.

Checked on a local stack with 15 ISBNs of well-known German classics (Faust, Die Verwandlung, Der Prozess, Werther,
Effi Briest, Der Sandmann, Michael Kohlhaas, Zarathustra, Die Räuber, Der Schimmelreiter): the 10 that Apple Books
and Open Library did not know were all found by the library and could be added (a Catalogue Book of source `import`,
no cover); the 5 they knew were found without asking it.

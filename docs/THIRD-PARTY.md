# Third-party data, services and code

BetterReads is a public repository and talks to services it does not run. This page lists what, why, under
which terms it knows of, and what is kept. It is a plain statement of how the code behaves, not legal
advice; the owner keeps it current when a source is added (the enrichment sources are also in
[ENRICHMENT.md](ENRICHMENT.md), the hosting in [HOSTING.md](HOSTING.md)).

## Data sources

| Source | Used for | How it is reached | Terms, as far as the project knows them | Kept |
| --- | --- | --- | --- | --- |
| Apple Books (iTunes Search API) | Search results, covers, genre names | Browser (search) and the `enrich` edge function | Apple's [Search API terms](https://performance-partners.apple.com/search-api) allow lookups for linking to and promoting Apple content and ask for attribution; the results are not a database to copy. BetterReads stores what a member adds (title, author, cover address), not the catalogue | The Book a member adds; the cover address, not the image |
| Open Library | Search results, covers, fallback metadata | Browser (search, covers), `enrich`, and the `openlibrary` edge function for the **import** (server side, identified and paced: `Libellus/1.0 (<contact>)`, at most 3 requests a second per instance; [supabase/functions/openlibrary/README.md](../supabase/functions/openlibrary/README.md)) | [Open Library](https://openlibrary.org/developers/api) publishes its catalogue records as open data (see its site for the current terms); its published rate limits are 1 request a second for an unidentified client and 3 for an identified one (a `User-Agent` with a contact address; a browser cannot set one, hence the import's asks go through our function and fall back to direct at 1/s when it fails). Covers have their own terms and are only linked, never copied (the Covers API is "intended for displaying covers on public facing websites and not for bulk download"; by cover id it has no per-address limit, by ISBN 100 requests per IP per 5 minutes; the import's cover fill asks `api/books` for up to 25 ISBNs in one call, one call at a time, and links the cover by its id, [cover-sources.md](plans/cover-sources.md)) | Fields of a Book a member adds |
| Wikidata | Authors, works, series, genres (`enrich`) | `enrich` edge function, server side | CC0 | Facts (names, series, genres) in the database |
| Wikipedia and Wikimedia Commons | An author's short intro and portrait (`enrich`) | `enrich` edge function | Wikipedia text is CC BY-SA, a Commons file has its own licence. The app shows the credit (artist, licence, link) the licence asks for, from the stored `credit` ([ENRICHMENT.md](ENRICHMENT.md), "Credits") | The intro, the image address and its credit |
| Goodreads | A Book's community rating, ratings count, reviews count and id | `goodreads-rating` edge function, **server side only**; the browser never contacts Goodreads | Goodreads has no public API for this and its terms forbid automated access to its site. The function reads the endpoints its own site uses, one Book at a time on demand, with a cache (30 days for a hit, 7 for a miss), and keeps only the figures and the id, never review text. This is an **owner-accepted risk**: the feature is optional and can be removed (delete the function and the line on the Book page) if Goodreads objects | Figures and the id, per ISBN or title key |
| Goodreads covers | The cover of a book without one, as a **last resort** (a Goodreads export's rows and a manual "find a cover") | `goodreads-rating` with `cover: true` (the same unofficial `auto_complete` search); the browser then loads the image from `i.gr-assets.com` | The image is **linked, never copied**: only its address is stored (`books.cover_url`; the answer cache keeps the address next to the rating), no description, page count or rating from this path. Same terms position as the row above, **owner-accepted risk**, behind one switch (`GOODREADS_COVERS` in `web/app/data/coverRank.ts`; docs/covers.md, *Goodreads, the last resort*). Taken down: set the flag to false and drop `i.gr-assets.com` from `private.cover_allowed`; those Books show the cloth cover | A cover address per Book |
| MyMemory (Translate) and Wiktionary (Define) | The built-in reader's "Translate" and "Define" on selected words | Browser, only with the words a member selected | MyMemory's and Wiktionary's own terms (Wiktionary: CC BY-SA) | Nothing |
| Goodreads and Hardcover exports | A member's own history | A CSV the member drops in; parsed in the browser | The member's own data | What the member imports |

## Services that process data

The ones that store or process members' data (Supabase, Cloudflare Pages, Cloudflare R2, Resend) are listed with
what each holds in the [README](../README.md) ("Where your data lives"). GitHub holds the code and
its CI only.

## Test fixtures: test-only recordings

The recordings under `web/tests/fixtures/` (`apple`, `openlibrary`, `goodreads`, `hardcover`, `barcode`, `ebooks`) and
`supabase/functions/*/fixtures/` are answers of those services recorded for the tests (so no test reaches a
real host) and are **for testing only**. They stay in the repository so a clone can run the suite offline. They are not
part of the app, are not served, and are not licensed for any other use: the data in them belongs to the
services above under their own terms. Do not build on them and do not add real members' data to a fixture.

## Code and assets shipped in the app

| Component | Licence | Where |
| --- | --- | --- |
| [foliate-js](https://github.com/johnfactotum/foliate-js) (the ebook reader's engine, vendored) | MIT | `web/app/reader/foliate-js/`, [VENDORED.md](../web/app/reader/foliate-js/VENDORED.md) |
| [zip.js](https://github.com/gildas-lormeau/zip.js) (inside the vendored reader) | BSD-3-Clause | `web/app/reader/foliate-js/vendor/zip.js` (the licence comment stays in the build) |
| [fflate](https://github.com/101arrowz/fflate) (vendored, MOBI fonts only) | MIT | `web/app/reader/foliate-js/vendor/fflate.js` |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (barcode scanner) | MIT (wraps ZXing C++, Apache-2.0) | `web/package.json` |
| Geist, Geist Mono, Newsreader (`@fontsource/*`) | SIL Open Font License 1.1 | `web/package.json` |
| Everything else installed from npm | Each package's own licence | `web/pnpm-lock.yaml` |

BetterReads's own code is licensed as the [LICENSE](../LICENSE) file says. The 3D shelf (Regal) is a separate layer in
its own repository and not part of that licence.

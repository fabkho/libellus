# Cover sources for the import's missing covers

Why: a Goodreads import of ~700 books leaves rows that are identified (ISBN, title, authors, pages, year) but
have no cover, and they land under *Needs a look*. Apple's Search API refuses once its per-address limit is
spent, and Open Library has no cover for many German ISBNs. This file is the evidence behind
`data/coverFill.ts` (the background cover resolver, see `docs/parity.md` → Import books) and the decision which
sources it uses. Measured on 11 October 2026 from one residential address (the member's own address is the one
that counts: the app calls these hosts from her browser).

The rule of the project stands (`docs/THIRD-PARTY.md`): a cover is **linked, never copied into our storage** (since 29 Oct 2026 the image is also cached at our edge, `/cover`, an
owner-accepted risk: THIRD-PARTY.md, "Cover cache"); the Catalogue
stores the address, and `private.cover_allowed` (migration `20261022010000`) lets a Book's cover live only on
`covers.openlibrary.org`, `*.mzstatic.com` and `books.fabkho.dev`. Any other host is a migration, a CSP change
and a service-worker change (see *What was not done*).

## The test set

60 ISBN-13, chosen before measuring and not from any member's file:

- **30 German**: from Wikidata (`P212` ISBN-13 on items with `P407` German and a publisher), seeded random
  within publisher: Heyne 4, S. Fischer / Fischer Taschenbuch 4, Rowohlt 4, dtv 4, Piper 3, Droemer Knaur 3,
  Bastei Lübbe 2; from Open Library's publisher search (language `ger`, taken without looking at covers):
  Carlsen 3, "Independently published" 3.
- **30 English**: Wikidata, publishers Tor, Bantam, Doubleday, Gollancz, Orbit, Del Rey, Vintage, Penguin,
  HarperCollins, Bloomsbury, Little Brown, Atria, Hodder and others, two per publisher at most, published 1990 or later.

DE: 9783453441088 9783453199231 9783453210929 9783453875517 9783596904587 9783596160488 9783100108463
9783100108425 9783499255564 9783498002039 9783498007409 9783499101700 9783423284882 9783423032827
9783423145473 9783423221115 9783890295473 9783492056779 9783492054522 9783426659847 9783426633311
9783426269121 9783404165162 9783785702611 9783551786975 9783551713773 9783551583574 9783987182242
9783527760572 9783423230124

EN: 9780008300777 9780593046326 9780765333605 9780061056925 9781841491004 9780356512501 9780812579925
9780553584462 9780553813142 9780345501165 9780575058088 9781787634046 9780553582024 9781473621442
9780385611077 9780385603409 9780345501172 9780099540281 9780747591054 9780679772538 9780316556347
9780141006369 9780062823946 9780002247436 9781982129828 9781526610140 9780062662590 9780316016407
9780140270372 9780575079052

**Caveats, honestly.** Wikidata only holds books somebody catalogued, so the set is *easier* than a real
Goodreads file: ebook-only and self-published romance (the hard case) is represented by three "Independently
published" ISBNs and nothing else. Read the hit rates as an upper bound for German trade books. A *hit* is an
image whose short side is at least 150 px (the app's `MIN_COVER_SIDE`), except where noted. 30 books per language
means ±9 points of noise.

## Results

| Source | Terms verdict | Hit DE | Hit EN | Speed (median) | Rate limit | Key | Recommendation |
|---|---|---|---|---|---|---|---|
| **Open Library**, `api/books?bibkeys=ISBN:…` → cover id → `covers.openlibrary.org/b/id/{id}-L.jpg` | Clean: the Covers API page: "intended for displaying covers on public facing websites and not for bulk download"; no crawling. Covers by *id* and OLID are not rate-limited | **19/30** (63 %) | **29/30** (97 %) | one call for 60 ISBNs 7.4 s; image 0.1–1 s (redirect to archive.org) | by-id none; by-ISBN documented 100 requests/IP/5 min → 403 (not reproduced: 140 calls in 80 s, 3 × 502) | no | **Use** (built): batched, by cover id, so the per-address ISBN limit is never touched |
| Open Library, `covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false` (what the write already tries) | as above | 18/30 | 27/30 (+2 × 502) | 0.9 s / 1.0 s | the 100 per 5 min above | no | Keep as it is; the batch above replaces it for the import |
| **Apple Books**, `search?term=title&entity=ebook`, title prefix match (no author check, so an upper bound; the import checks the work and the author) | Allowed: Search API terms (promotion / linking, cover address kept, not the image); already in `THIRD-PARTY.md` | **21/30** (70 %) | **29/30** (97 %) | 0.2 s | "approximately 20 calls per minute" (Apple). Measured, search: no refusal in 150 calls at 1 per 3 s (468 s); **429 on call 62 at 1 per 1.5 s**; **429 on call 97 at 4 per s**; `Retry-After: 5` and `11`; usable again after ≤ 10 s | no | **Use** (built), paced at 1 search per 3 s (one request to the first storefront = 20 calls a minute), `Retry-After` honoured |
| Apple Books, `lookup?isbn=` | as above | 2/30 (`de` storefront), 1/30 (`us`) | 12/30 / 8/30 | 0.2 s | as above | no | **Weak and costly**: an ISBN lookup only finds *ebook* ISBNs, yet each one spends two calls (two storefronts) of the same ~20/min. Not used for covers |
| Inventaire, `api/entities?action=by-uris&uris=isbn:…` → `img/entities/{hash}` | Data CC0 (Wikidata-based). Images are user-uploaded ("all book covers are accepted … send the admins an email" for removal): publisher covers, no licence statement. Small risk, documented; no API terms page found | 17/30 (57 %) | 28/30 (93 %) | 0.1–0.2 s | none documented | no | **Follow-up, not built** (owner's call): +6 books over Open Library in German. Needs the host on the DB allow-list, CSP and the service worker; the images have no CORS, so no thumbhash from the browser |
| Google Books, API `volumes?q=isbn:` | Gray: ToS + branding: "Powered by Google" next to results, a prominent link to Google Books for every result, results not altered | not measurable: every keyless call answered 429 ("Queries per day", the shared anonymous project's quota is spent) | same | – | free key, 1,000/day default | **a key is required** | **Excluded** (owner: no) |
| Google Books, `books.google.com/books/content?vid=ISBN…&zoom=1` (what the thumbnails link to) | Unofficial endpoint, the same branding terms apply | 16/30 at 128 px wide (below `MIN_COVER_SIDE`; real covers told from the "image not available" placeholder by its bytes) | 29/30 | 0.14 s | unknown | no | **Excluded** |
| Amazon image CDN, `images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg` | Not offered to third parties; its terms ask for a link back (LibraryThing's own 2008 post on why it built a cover service); no page found that allows it | 27/30 | 28/30 | 0.09 s | none seen | no | **Excluded** (most hits of all; that is no licence) |
| DNB / MVB, `portal.dnb.de/opac/mvb/cover?isbn=` | Licensed: the DNB shows covers under a dbv / VG Bild-Kunst agreement for library catalogues; the VLB (MVB) is the publishers' licensed service | 28/30 | 1/30 | 0.17 s | – | no | **Excluded** (the owner's "VLB: licensed") |
| LibraryThing covers, `covers.librarything.com/devkey/{KEY}/large/isbn/{isbn}` | Their 2008 post: free dev key (any member), 1,000 covers/day per key (counted when a cover is *made*), caching allowed, at most one cover per second for automatic fetches, no bulk redistribution, no promoting a competitor | not measured (no key; their pages answer 403 to a script) | – | – | 1,000/day/key | yes, and the key sits in the URL, so server side | Not built: a key, and nothing to say it beats Open Library |
| Hardcover API | GraphQL, a member's token (not a project key), user-uploaded images: their docs say to run a DMCA takedown policy if images are shown publicly | not measured | – | – | their docs name a daily limit | token | Not built: a token per member or one of the owner's, and the image licence |
| Internet Archive (`advancedsearch` isbn → `services/img/{id}`) | Terms page not readable by a script; Open Library's covers *are* its covers (bulk download is theirs, crawling asked against) | 6/30 | 18/30 | 0.4–0.8 s | – | no | Redundant with Open Library: its subset |
| Wikimedia Commons / Wikidata `P18`, `P996` | Open licences | **0/60** | | | | | Nothing: a book cover is rarely free |
| BookBrainz | CC0 data | not measured: no cover images in its model | | | | | – |
| VLB / publisher feeds | Licensed | – | – | – | – | – | Excluded |

### Unions (same 60 books)

| Sources | DE | EN |
|---|---|---|
| Open Library by ISBN alone | 19/30 | 29/30 |
| + Apple title search | **29/30** (97 %) | **30/30** |
| + Inventaire | 30/30 | 30/30 |

Open Library and Apple together cover what the others add, in this set; Inventaire is the safety net for
the German books both miss (3 of 30 in the set, probably more among ebook-only and self-published titles
that no Wikidata list holds).

## What the measurements say about the current import

1. **Apple's limit is spent by lookups that cannot succeed.** An ISBN lookup finds an Apple edition for 2 of 30
   German print ISBNs and 12 of 30 English ones, and each costs two Apple calls (two storefronts). The import
   asks 4 rows at once with 250 ms between requests: ~240 calls a minute, 12 times the documented 20, so the
   first 429 comes after about 36 s (measured). What is left is the cooldown, which was a flat 60 s although
   Apple answers `Retry-After: 5…11` and lets the address back in within 10 s. `pacedFetch` now reads
   `Retry-After`.
2. **Apple's title search is the strongest source for German books** (21/30), and it is the one the limit
   starves. The resolver asks it paced: one search per 3 s (one storefront: 20 calls a minute), only for rows
   the cheaper sources left without a cover.
3. **Open Library's by-ISBN cover is rate-limited per address, by id it is not.** One `api/books` call answers
   up to 60 ISBNs with the cover ids (7.4 s for 60); the images are then fetched by id.

## Measured on a real export (counts only)

`web/scripts/import-covers.ts` runs the lookup, the fill and the write of a 709-row Goodreads export on a
local stack against the live sources, from one residential address (the file stays outside the repository; only
counts are kept). The lookup itself is not repeatable: Apple refuses a different share of its 1,400–1,900
requests each run (21–130 refusals), so the Books' covers differ by tens between runs (no cover at all after the
write: 168 without the fill, then 188, 155 and 117 with it, unpaired). The figures that compare are the ones
inside one run, before and after the fill on the same lookup (the last run):

| | before the fill | after |
|---|---:|---:|
| identified rows (matched, or an ISBN in the file) | 677 | 677 |
| of them without a cover | 80 | **64** (16 found, all by the Apple search) |
| "Needs a look", old rule (a match without a cover and every book only the file knew) | 175 | 159 |
| "Needs a look", new rule (only what nothing identifies) | – | **32** |
| lookup / fill after the lookup / write | 556 s | 601 s (its budget; in the app it overlaps the preview) / 92 s |

Requests: lookup, Apple 1,888 (21 refused), Open Library 1,236; fill after the lookup, Apple 35 (13 refused, each
waited out: 30 searches in 10 minutes, 16 found), Open Library 57 `api/books` calls, 0 covers (the lookup had asked
it by ISBN already); write, `covers.openlibrary.org` 453, `mzstatic.com` 299 (no refusals). The production
baseline for the same member (an older version of the import): 707 entries, 156 without a cover, 330 Open
Library, 221 Apple, 65 without ISBN.

What this says: the **review list is the big win** (175 → 32, by the rule, not by covers: a missing cover is
a note now); the fill itself finds a fifth of the missing covers in ten minutes because Apple, the only source
here that has them, stays refused after a lookup that sent it ~1,900 requests (an ISBN lookup finds an
ebook for 2 of 30 German print ISBNs and still costs two requests). The lever left is the lookup's own use of
Apple (one storefront, no ISBN lookup for print ISBNs): a change of what the lookup finds, not of this PR. Open Library
by ISBN and sibling editions added nothing here: the lookup had asked Open Library by ISBN already.

## What was not done

- Inventaire (+6 German books of 30): see above. A follow-up PR needs `private.cover_allowed` to accept
  `https://inventaire.io/img/entities/<40 hex>` only (a migration + pgTAP), `connect-src`/`img-src` in
  `web/public/_headers`, the service worker's cover cache in `nuxt.config.ts`, `data/merge.ts`' and
  `utils/cover.ts`' host tests, Regal's `regal.config.ts`, `functions/r/[[path]].js` and the sign-in wall. Its
  images have no CORS, so a cover would show without thumbhash and colours (like a member's own edition's).
- Google Books and Amazon, DNB/MVB: excluded above.
- Rehosting covers (an own bucket): no source above allows copying; Open Library's by bulk archive is the only
  one that offers it, and it is a project of its own.

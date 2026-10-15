# Assessment: a cover source for the import that works from a server (15 Oct 2026, measurement)

Status: assessment, **DO NOT MERGE**. Owner request; companion to
[apple-off-assessment.md](apple-off-assessment.md) (PR #359, the free-only run),
[import-background.md](import-background.md) (PR #329, the server-side import job) and
[plans/cover-sources.md](../plans/cover-sources.md) (the 11 Oct 2026 measurement and the
decisions taken from it).

Everything here is a count; no title, author or ISBN of the member's export is in this file, in the
commit or in the PR. The per-row working data (which names the books) stayed in a gitignored
`.shots/` directory on one machine; the images were downloaded to a temp directory only to read
their pixels and are deleted.

## The question

Apple stays in the client-side search (Search palette, edition picker, scan) but comes **out of the
import** ([apple-off-assessment.md](apple-off-assessment.md)). The import runs as a shared Supabase
Edge Function: no residential address, no browser, no cookies, a `User-Agent` we control. So the
cover source it may use has to answer a server, at a polite pace, with terms that allow it.

The free-only run left **131 matched rows of 709 without any cover** (Apple's artwork gone, Open
Library has none, the DNB never had covers) and 112 more under the 300 px bar. This file measures,
for 13 candidate sources, whether a cover exists there, how big it is, whether a server may ask, and
what the terms say.

## Method (and why the numbers are smaller than a naive count)

- **The rows.** Two sets, taken from the audit of the Apple-off run (`.shots/apple-off/`,
  read-only): the **131 matched rows that ended with no cover at all** (130 of them carry an ISBN;
  85 of those are German, 978-3) and a **random 200-row sample** of the file's other rows that
  carry an ISBN (35 German), for the larger picture. The random pick is deterministic
  (sha1 of the file's own row key), so the run repeats.
- **A hit is a real cover, not a 200.** Each candidate answer is downloaded and its pixels read
  (`w × h`, bytes). A host's stand-in is **not** a cover:
  - Google Books answers **HTTP 200 with a picture for every ISBN, including ISBNs it does not
    know**: a grey "image not available" card (246 kB, the same file for 58 of the 131 rows), a
    8-bit-grey placeholder (9 kB), or a per-book white page with the title on it (5.5 kB). Counted
    naively, Google "covers" 130 of the 131 rows; with the stand-ins removed it covers **67**.
  - Amazon answers **HTTP 200 with a 43-byte 1×1 GIF** for an ISBN it has no picture for.
  - Open Library and Goodreads answer 404 / nothing for a row they have no cover for.
  A cover is counted when the response is 200, an image, at least 100 × 100 px, and its bytes are
  above what every stand-in seen on that host weighs (> 12 kB on this file's rows: every real cover
  measured is ≥ 26 kB, every stand-in ≤ 10 kB) and the very same file was not served for three or
  more different rows of the same source.
- **Correctness, eyeballed.** The covers of every source that produced them were also laid out on a
  contact sheet next to the row's title and author and looked at, because a 200 does not mean *the
  right book*. Open Library, the DNB, Literal and Goodreads were right on every tile checked; Google
  is right whenever it answers a real cover, and wrong-book answers are what its stand-ins mostly
  are. This is the one part of this file that is not a count.
- **Politeness.** At most 1–2 requests a second per host, per host in parallel (the same shape
  `covers.py` of the Apple-off run uses). Nothing was asked of Apple.
- **Stand-ins, sizes, and everything else are counts of what those hosts served on 15 Oct 2026**,
  from one residential address.

## Q1 — Does the source have a cover for the 131 rows?

| source | how it is asked | real covers of the 131 | … of the 85 German | … of the 46 other | no cover | stand-in |
|---|---|--:|--:|--:|--:|--:|
| Open Library, by ISBN (`-L`, `?default=false`) | 1 request per ISBN | **0** | 0 | 0 | 131 | – |
| Open Library, the archived original (by the ISBN's edition) | `isbn.json` + 1 image | **0** | 0 | 0 | 131 | – |
| Open Library, a sibling edition of the same work | `works/<key>/editions.json` + up to 5 images | **0** | 0 | 0 | 131 | – |
| **DNB / MVB cover service** (`portal.dnb.de/opac/mvb/cover?isbn=`) | 1 request per ISBN-13 | **68** | 68 | 0 | 63 | 0 |
| **Google Books**, bulk ViewAPI + `books/content` | 1 request per 50 ISBNs + 1 image per row | **68** | 49 | 19 | 5 | 58 |
| Google Books, `books/content?vid=ISBN…&zoom=3` (no ViewAPI) | 1 request per ISBN | 67 | 49 | 18 | 1 | 63 |
| **Literal** (`literal.club/graphql`, `book(where: {isbn13:})`) | 1 POST per ISBN | **53** | 33 | 20 | 76 | 2 |
| **Amazon** (`m.media-amazon.com/images/P/<isbn10>.01.L.jpg`) | 1 request per ISBN-10 | **74** | 46 | 28 | 54 | 3 |
| **Goodreads**, the lane the app already has (`auto_complete` + the file's own book id) | 1 search per row | **97** | 60 | 37 | 34 | 0 |
| Goodreads, a looser title match (any form of the title, any of the author's surnames) | 1 search per row | 115 | 78 | 37 | 16 | 0 |
| Google Books API `volumes?q=isbn:` **without a key** | 1 request per ISBN | **0** | 0 | 0 | 131 | – |
| Inventaire `api/entities?action=by-uris` | 1 request per ISBN | **0** | 0 | 0 | 131 | – |
| Wikidata `P18` by ISBN-13 (`P212`) | 1 SPARQL query per ISBN | **0** | 0 | 0 | 131 | – |
| LibraryThing covers API | needs a dev key | *not tested* | | | | |
| **Hardcover API** (`editions` by ISBN-13, the 34 residue rows of Chain A) | a PAT with `read:catalog` | **11 of 34** usable (≥ 300 px); 11 thumbnails only (98–128 px wide); 12 with no edition | 1 request per ISBN, 1/s; 22 of 34 have an edition | |
| ISBNdb, Syndetics, Penguin Random House, VLB REST API, publisher/retailer CDNs | paid or contract | *not tested* | | | | |

What this says:

- **The 131 rows are German-heavy** (85 of 131) — the German half of the file is where the free
  sources failed, and it is where the German trade's cover service answers.
- **Open Library has nothing at all for these rows**: not by ISBN, not the archived original of an
  edition it does not know, and **not on a sibling edition of the same work** (0 of 131; on the
  random 200-row sample it finds 92, so the query is not the problem — these 131 works genuinely
  have no cover on Open Library).
- **Google Books answers 130 of 131 with a picture and 67 of them with a real cover.** The 63
  stand-ins are the reason a naive count of this source is wrong by a factor of two.
- **The documented Google Books API is unusable without a key**: **330 of 330 requests returned
  HTTP 429** — `Quota exceeded for quota metric 'Queries' … for consumer 'project_number:624717413613'`,
  a shared anonymous project, not ours. The undocumented `books?jscmd=viewapi` and
  `books/content` endpoints answer without any key at all.
- **Goodreads has 115 of the 131** — and the lane already in the app finds **97 of them, 84 by the
  row's own Goodreads book id** (the exact edition), 13 by title. The free-only import ended with 72
  Goodreads covers in total, of which 0 on these 131 rows. See *Quick wins* below: this is the
  largest gap that needs no new source at all.
- **Inventaire and Wikidata `P18` are nothing on this file.** Inventaire's own 11 Oct measurement
  found 17/30 German books on a Wikidata-seeded set; this member's file (ebook-only romance, self
  published) has no Inventaire entity for any of its 131 rows. `P18` is empty for all of them.
- Amazon has the most answers of all (74) and the least right to be used (see *Terms*).

### The random 200-row sample, for the larger picture

| source | found | **real covers of 200** | stand-in | of 35 German | median width |
|---|--:|--:|--:|--:|--:|
| Open Library `-L` by ISBN | 132 | **131** | 1 | 19 | 326 |
| Open Library archived original | 130 | **124** | 6 | 19 | 333 |
| Open Library sibling editions | 92 | **92** | 0 | 12 | 506 |
| Google Books ViewAPI | 183 | **63** | 120 | 8 | 575 |
| Google Books `vid=ISBN` | 200 | **61** | 139 | 8 | 575 |
| Literal | 136 | **126** | 10 | 19 | 332 |
| Amazon | 154 | **154** | 0 | 30 | 328 |
| DNB / MVB | 34 | **34** | 0 | 33 | 382 |
| Goodreads | 100 | **100** | 0 | 25 | 558 |

Three things about this table matter:

- **Google is far weaker on an ordinary row than on these 131.** It answers a real cover for 68 of the
  German-heavy coverless rows (52%) but only 61–63 of the random 200 (31%), and 139 of its 200 answers
  there are stand-in cards (115 of them the very same grey file). A self-published romance is not
  what Google's catalogue holds.
- **Open Library's archived original is not a safe probe.** For the same cover id, `-L` (asked with
  `?default=false`) returned a real cover on 131 rows and the original on 124: with no size suffix
  Open Library serves a **blank image** where `-L` answers 404. The original address must go through
  the same pixel check the app already has (`probe`, `flatColour`), never a HEAD.
- The English half of the file is Open Library's: 112 of the sample's 165 non-German rows against 19
  of 35 German ones. DNB/MVB is the mirror image (33 of 35 German, 1 of 165 other).

## Q2 — How big are the covers?

Width buckets of the real covers found on the **131 rows** (the app wants ≥ 420 px wide for the Book
page hero; its own floor is 150 px on the short side, `PREFERRED_COVER_SIDE`):

| source | covers | < 150 | 150–299 | 300–599 | ≥ 600 | median width | ≥ 300 px |
|---|--:|--:|--:|--:|--:|--:|--:|
| DNB / MVB | 68 | 0 | 0 | 68 | 0 | 379 | 68 |
| Google Books (ViewAPI) | 68 | 0 | 0 | 68 | 0 | 575 | 68 |
| Literal | 53 | 0 | 2 | 51 | 0 | 392 | 51 |
| Amazon | 74 | 0 | 0 | 74 | 0 | 324 | 74 |
| Goodreads (the app's lane) | 97 | 0 | 10 | 48 | 39 | 350 | 87 |
| Goodreads (looser match) | 115 | 0 | 10 | 60 | 45 | 350 | 105 |

- **Every source here clears the app's own floor** (`MIN_COVER_SIDE` 40 px, and
  `PREFERRED_COVER_SIDE` 150 px on the short side): there is not one tiny cover in the six.
- None of them reaches Apple's `600x900bb` on its own, except Goodreads' originals (39 of 97 at
  ≥ 600 px). Google's `zoom=3` is a fixed 575 × ~887; `zoom=6` on the same volume is the whole scan
  (measured 1744 × 2691, 564 kB) and `zoom=2&w=600` gives 600 × 926 — the zoom is a knob, and only
  `zoom=0`/`6` are the large file.
- **Google's `zoom=5`, which is what the ViewAPI's own `thumbnail_url` recommends, is 128 × 198** —
  below the app's preferred side. Whoever wires this up must not take the URL the endpoint hands out
  as it comes.

## Q3 — Can a server ask? (feasibility, and what was actually tested)

| source | answers a plain server client | measured from here | published limits | bot challenge |
|---|---|---|---|---|
| Open Library covers by **id** | yes | 130–132 of 200 rows | **no per-address limit by id/OLID**; **by ISBN 100 requests/IP/5 min**; API 1 req/s unidentified, 3 identified (a `User-Agent` with a contact address) | none |
| Open Library `isbn.json` / `/works/…/editions.json` | yes | fine at 2/s | as above | none |
| DNB / MVB cover (`portal.dnb.de`) | **yes, if the `User-Agent` does not look like a browser** | 68 covers + 62 × 404 on the 131 rows, and 32 further probes; 0 refusals, 0 challenges | none published (it is a catalogue page, not an API) | **Anubis** proof-of-work sits in front of it: a Chrome `User-Agent` was challenged on **3 of 3** requests (`Making sure you're not a bot!`, 200 + HTML), while `curl/8.4.0`, `python-requests`, an empty UA and **our own `libellus-…` UA got the JPEG on 9 of 9** |
| Google Books `jscmd=viewapi` + `books/content` | yes | 12 requests at 0.15 s apart: 12 × 200, no refusal, no `Retry-After`, no rate-limit header, no `cf-mitigated`; 126 of 130 ISBNs answered in 3 bulk calls | **none published** — the endpoint is undocumented | none seen |
| Google Books API (with a key) | yes | **429 on every one of 330 requests** without a key | the key's own project quota (a free key is the documented requirement) | – |
| Literal GraphQL | yes, reads need no token | 131 POSTs, clean | **none published**: "Be respectful with request volume. If you need bulk data access, reach out to us. Cache responses where possible." | none |
| Amazon image host | yes | 154 image answers, no refusal | none published for this host; `robots.txt` names some bots | none seen |
| Goodreads | yes, through our own function only | — (not re-measured here; the app's `goodreads-rating` has the 10-minute breaker for 403/429/503) | none; its terms forbid automated access | the existing breaker; unchanged by this file |
| Wikimedia Commons | yes | not reached (0 hits) | 200 req/min with a descriptive UA, concurrency ≤ 2 | policy blocks a generic UA |

**The DNB is the surprise, and the risk.** `portal.dnb.de` is behind Anubis, a proof-of-work gate.
From this address it lets a **non-browser** `User-Agent` straight through — which is exactly the
shape a server-side job has — and challenges anything claiming to be Chrome. Anubis also weighs the
address, and **a Supabase Edge Function's address is one we share with strangers**: whether it is
challenged there is *not testable from here* (deploying a test function is out of scope for this
task). Treat the DNB path as "works, with a probe at deploy time and a fallback when it does not".

**Nothing on the Google path is documented.** `books?jscmd=viewapi` and `books/content` are the
endpoints Google's own thumbnail links point at (the Books API's `imageLinks.thumbnail` is the very
same address), but no page promises either of them, no limit is published, and there is no key, no
quota and no support relationship behind them.

## Q4 — Terms, with the page

| source | displaying (hot-linked) | copying/caching into our storage | commercial use | server-side bulk | page |
|---|---|---|---|---|---|
| **Open Library covers** | **explicitly the wanted use**: "If you want to display covers on public facing pages, please use a src URL that points to covers.openlibrary.org" | "Please, do not crawl our cover API."; the bulk archive is theirs, not an invitation | not addressed | by id/OLID not rate-limited; **by ISBN 100 requests/IP/5 min** | [dev/docs/api/covers](https://openlibrary.org/dev/docs/api/covers), [developers/api](https://openlibrary.org/developers/api), [licensing](https://openlibrary.org/developers/licensing) |
| …**the images themselves** | a courtesy link is appreciated, not required | – | – | – | the covers are user- and third-party-uploaded and carry **no stated licence**: "The Internet Archive does not assert any new copyright or other proprietary rights over any of the material in the Open Library database. **There may be existing rights issues** on some contributions and in some jurisdictions." Two probes came back `"source": "amazon"` |
| **DNB / MVB cover service** | **only libraries, only in a bibliographic record**: "The agreement allows **libraries** to use the cover service of the VLB – German Books in Print and to display cover images **in the presentation of a bibliographic record**" | the DNB may not: "It is **not possible** for the German National Library to **archive, store or exchange** illustrations or images relating to bibliographic metadata" | **not addressed** | "If you are interested in **re-using** cover images, please contact VLB – German Books in Print." | [dnb.de … Cover/cover.html](https://www.dnb.de/EN/Professionell/Metadatendienste/Kataloganreicherung/Cover/cover.html) |
| …the **VLB/MVB REST API** behind it | needs OAuth2 credentials per data recipient, and a separate **cover** authorisation: "Cover authorization is needed in order to access cover data"; an unauthorised account gets 401 "Contact MVB customer service" | tokens must not leak: "copying or viewing of which by third parties is **strictly prohibited**" (a proxy is suggested) | contract per customer | **against the intent**: "primär für den Abruf der zum einzelnen Produkt gehörenden Mediendateien gedacht und **nicht** zum Abruf größerer Cover- bzw. Mediendateien-**Mengen**" | [vlb.de/hilfe/datenbezug/rest-api](https://vlb.de/hilfe/datenbezug/rest-api), [v2 spec PDF](https://vlb.de/assets/images/VLB_REST_API_Version2_userspecification_EN.pdf) |
| **Google Books API** | allowed, but branded: "The 'powered by Google' graphic **must always** be displayed alongside any search modules or results"; "Every book result displayed in your application must have a **prominent link** to … the Google Books page for that book" | forbidden beyond headers: "Scrape, build databases, or otherwise create permanent copies of such content, or **keep cached copies longer than permitted by the cache header**" | no fee may be charged: "You may not **charge users any fee** for the use of your application, unless … a separate agreement" | **unclear** — neither page addresses it | [books/terms](https://developers.google.com/books/terms), [books/branding](https://developers.google.com/books/branding), [Google APIs ToS §5(e)](https://developers.google.com/terms) |
| …**`books/content` / `viewapi` themselves** | **unclear**: no page describes these endpoints. The branding terms above are written for the API, and they are the only terms that come near them | **unclear**, most likely the same rule | **unclear** | **unclear** | no page |
| **Amazon images** | **no**: "You may **not** frame or utilize framing techniques to enclose any … proprietary information (**including images** …) of Amazon without express written consent"; the licence is "personal and **non-commercial** use of the Amazon Services" | **no**: "No Amazon Service, nor any part of any Amazon Service or its contents, may be reproduced, duplicated, copied, sold, resold, visited, or otherwise exploited for any **commercial purpose** without express written consent" | no | no | [Amazon Conditions of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=508088); even as an Associate: "You will **not store or cache** Product Advertising Content consisting of an image" ([Associates IP Licence](https://affiliate-program.amazon.com/help/operating/policies/)) |
| **Literal** (`literal.club` GraphQL) | technically open — "Most read operations are available **without authentication**" — but **no clause anywhere covers the cover images** | "**Cache responses where possible**" | **unclear** — the terms are account-conduct only | "Be respectful with request volume. **If you need bulk data access, reach out to us.**" | [literal.club/developers](https://literal.club/developers), [terms](https://literal.club/terms-and-conditions) |
| …what Literal actually returns | 29 of its 53 covers on the 131 rows are `assets.literal.club` (its own CDN); **26 are `books.google.com/books/content?id=…`** | – | – | – | measured |
| **Goodreads** | the address is linked, never copied — the project's standing position | the image is not copied | – | the app's function asks one book at a time | the **owner-accepted risk** already recorded in [THIRD-PARTY.md](../THIRD-PARTY.md) |
| **Hardcover** | yes, with a caveat: "If you use any images from the API and those images are **open to the public**, make absolutely sure you have a **DMCA takedown policy** listed on your site" | not addressed → **unclear** | "If you're creating a commercial product, or making a publicly accessible website, you may **not** use data owned by users" | **expected**: "Queries are **not allowed to run in the browser**, they must be run in an environment where the token can be kept secure" | [docs.hardcover.app/api/getting-started](https://docs.hardcover.app/api/getting-started/) — free token, 5,000/day, 60/min, burst 10 |
| **LibraryThing covers** | the 2008 announcement wanted exactly this ("Put that in an image tag"), and the current pages no longer document the covers API at all | **contradiction**: 2008 "We encourage you to cache the files locally" against today's "you may not … cache, copy, or download any part of the site … by automated or systematic means" | "use the site … for any commercial purpose" needs authorisation | only "an API or data feed we expressly provide" | [services/coverimages](https://www.librarything.com/services/coverimages) now serves the Developer Hub; 1,000 covers/day and "not more than one cover per second" from the [2008 post](https://blog.librarything.com/2008/08/a-million-free-covers-from-librarything/); [privacy/automated-access](https://www.librarything.com/privacy#automated-access) |
| **Wikimedia Commons** (Wikidata `P18`) | allowed, discouraged: "Hotlinking is allowed from Wikimedia servers, but is not generally recommended"; no "hot spider" services | bulk download is capped, not forbidden | the file's own licence | ≤ 2 concurrent, ≤ 25 Mbps; 200 req/min with a descriptive UA | [reusing content](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/technical), [Robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy) |
| …and the licence of a modern book cover on Commons | **usually none exists**: "Book covers, unless they are very old … usually carry copyright-protected designs, and photographs of them may not normally be uploaded to Commons" | – | – | – | [Commons:Copyright rules … Book covers](https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_subject_matter#Book_covers) |
| **Inventaire** | API documented, images hosted by them | – | data is CC0, the **images are not** | "Rate limiting rules are enforced … get in touch" | [api.inventaire.io](https://api.inventaire.io/), [data.inventaire.io](https://data.inventaire.io/) |

Three things stand out.

1. **The sources that work are the sources with the weakest terms, and the other way round.** The two
   that answer the German half (DNB/MVB, Google) are the two the owner has already ruled out
   ([plans/cover-sources.md](../plans/cover-sources.md): DNB/MVB "Excluded (the owner's 'VLB:
   licensed')", Google "Excluded (owner: no)"). Amazon has the most covers of the three and its
   terms are the plainest *no*.
2. **Open Library is the only source whose terms name our exact use** — and it has nothing for
   these 131 rows. Its terms are also the only ones that raise a licence question on the images
   themselves (`source: amazon` in its own metadata).
3. **A hot-linked cover is not the same act as a copied cover, and this project only ever links**
   (`docs/THIRD-PARTY.md`, `private.cover_allowed`). That helps with Google's no-caching clause and
   with Literal's silence; it does not help with the DNB's "libraries, in a bibliographic record",
   nor with Amazon.

## The chain, and what is left

Every ordering below is measured on the same 131 rows; the order is the order the chain asks in, and
a row stops at its first real cover.

| chain | covered | left | … reaching the 300 px bar |
|---|--:|--:|--:|
| today, Apple off: Open Library by ISBN + by id | 0 | **131** | 0 |
| + Open Library sibling editions | 0 | **131** | 0 |
| + DNB/MVB cover service | 68 | 63 | 68 |
| + Google Books (ViewAPI + `books/content`) | 104 | 27 | 104 |
| + Literal | 114 | 17 | 113 |
| + Goodreads (already in as the last resort) | **129** | **2** | 127 |
| Goodreads alone | 115 | 16 | 105 |
| the app's own Goodreads lane, asked for every coverless row | **97** | 34 | 87 |
| Open Library + the app's own Goodreads lane (nothing new at all) | **97** | 34 | 87 |
| Google + DNB/MVB + Goodreads (no Literal) | 128 | 3 | 126 |

**In the all-in chain, which source supplies the cover first:** DNB/MVB 68, Google Books 36, Literal
10, Goodreads 15, nobody 2.

### Recommended chain for the server job — the honest version

There are two answers, because the coverage and the terms pull in opposite directions.

**Chain A — within the terms the project already accepts (Open Library + Goodreads):**

```
1. Open Library, by id (already built; api/books in batches of 25 → covers.openlibrary.org/b/id/{id})
2. Goodreads, the last resort — asked for EVERY row that still has no cover,
   not only for the rows the Apple search lane happens to finish
```

**97 of the 131 rows (74%) end with a real cover, 34 stay coverless, 87 of the 97 reach 300 px.**
This needs no key, no secret, no new host, no CSP change and no new migration — it is the lane that
is already in the app, unblocked (below). It is also the only chain whose terms this project has
already written down and accepted.

**Chain B — if the owner lifts the exclusions (what it would take to nearly close the gap):**

```
1. DNB/MVB cover service, German ISBN-13 only (68 of 131)
2. Google Books: bulk `jscmd=viewapi` (50 ISBNs a request) → `books/content?id=…&zoom=3` (36 more)
3. Literal GraphQL by ISBN-13 (10 more)
4. Goodreads, the last resort (15 more)
```

**129 of the 131 rows end with a real cover; 2 stay coverless** (both are also the two rows
Goodreads does not know), 127 of the 129 reach 300 px. **But step 1 is the VLB licence question, step
2 is the source the owner already said no to, and step 3's images are, for half of them, Google's own
files again.** Chain B is not a way around the terms question; it *is* the terms question.

**What Apple would still add on the device afterwards.** From
[apple-off-assessment.md](apple-off-assessment.md), whose Apple-on run was a refused-Apple day and
so a lower bound: Apple's artwork is ≥ 300 px where the free run gives under 300 px or nothing on
**96 rows**, 75 of which would end with no cover at all. With Chain A leaving 34 coverless and 112
under the bar, the device's upgrade list stays roughly what the Apple-off file already sized (the
131 coverless, the 112 under the bar, the 42 unmatched, the 66 lent ones — 298 rows, ~15 minutes of
Apple at ~20 calls a minute, on the member's own address). **Chain A does not remove the need for
the device-side Apple pass; it makes it the only place Apple is asked.**

## Quick wins that need no new source

| win | measured | what it is worth |
|---|---|---|
| **Ask Goodreads for every coverless row** | the lane the app has finds **97 of the 131** (84 by the file's own Goodreads book id — the exact edition — 13 by title), where the free-only run ended with 0 on these rows and 72 in total | **+97 covers of the 131 for zero new sources.** The lane is gated (`web/app/data/coverFill.ts`): a row must be from a Goodreads file, must have no cover **and no fallback**, is only reached after the Apple search lane has been through it twice, is asked one at a time every 1.6 s, the whole lane stops for good after `GOODREADS_FAILURES` = 3 failures in a row, and the fill's 600 s budget is shared with the Apple lane, which paces itself at 3 s a search. 131 rows × 2 storefronts × 3 s is 786 s of a 600 s budget, so the queue never reaches most of them — which is consistent with the 72 the run ended with |
| **Open Library's archived original instead of `-L`** | 506 of the file's 709 rows carry an OL cover by id; measuring both for the same id: the original is **wider than `-L` on 197 of 501 (39%)**, ≥ 600 px where `-L` is smaller on **162**, and crosses the 300 px bar on **3**. It is **never smaller**. Median 333 px against 324 px | sharper artwork on 197 rows, a third of the file, **for no new request**: the id is already stored. The files are much heavier (median 47 kB, **55 over 1 MB, the largest 10.4 MB**) — needs a size guard, and it is a bigger download for every member who scrolls a shelf |
| Open Library **by ISBN vs by id** | by ISBN: 132/200 on the sample, **0/131**; by id: 130/200, **0/131** | nothing here — both miss the same rows, and the by-ISBN address is the rate-limited one (100/IP/5 min). Keep asking by id, as the import already does |
| Open Library **sibling editions** | 0 of the 131, 92 of the 200-row sample | real on an ordinary file, worthless on this one: these 131 works have no cover on Open Library at all |
| The **5 rows whose Open Library address did not load** (502/503) | 3 have no ISBN at all; of the other 2, one has a DNB cover (387 × 599) and both have a Google one | 2 rows |
| **Literal alone** | 53 of 131, 29 of them hosted on Literal's own CDN | the only unmetered source that answers a server and is not already excluded — but 26 of its 53 answers are `books.google.com` URLs |

The first row is the finding: **the app's own last-resort lane already covers 97 of the 131, and the
free-only run used it for none of them.**

## What each source would need

| source | key / secret | edge function | cost of one 709-row file |
|---|---|---|---|
| Open Library by id (existing) | `OPENLIBRARY_CONTACT` (already a secret) | `openlibrary` (existing): 360 calls a minute per member, client paced at 3/s | 12 `api/books` calls for 300 ISBNs, plus one image per row found — the same shape as today |
| Goodreads (existing) | – | `goodreads-rating` (existing), the breaker and the 30-day cache included | 131 `auto_complete` searches at 1.6 s ≈ 3.5 minutes; the images are the member's browser's |
| **DNB / MVB cover** | none — but a **licence question**, not an engineering one | new: reuse `dnb-lookup`'s shape (its own `purpose: 'import'` budget, 120 calls a minute, 500 ms apart). It must **probe for Anubis** on the first answer and stop the lane on a challenge, never retry into it | 85 image requests for a 160-German-row file (one per German ISBN, 404 is a miss); ~1.5 minutes at 1/s |
| **Google Books ViewAPI + content** | none (that is the whole point) — the **documented** API would need a key as a function secret | new, or part of the same one: 1 ViewAPI call per 50 ISBNs, then 1 image per row; a fixed `User-Agent`, and `zoom=3` (not the `zoom=5` the endpoint suggests) | **3 ViewAPI calls** for 130 ISBNs + ~70 images; seconds |
| **Literal** | none for reads | new: 1 POST per ISBN (a GraphQL body), 1/s | 131 POSTs ≈ 2.2 minutes |
| Amazon | – | – | **not recommended** (see Q4) |
| LibraryThing | a dev key, **which sits in the URL path** → a function secret, and every image URL carries it | new | 1,000 covers a day per key; not tested: no key was made, and the endpoint is no longer documented |
| Hardcover | a PAT (`read:catalog` only) → a function secret | new | 5,000/day, 60/min, burst 10; 34 lookups for the residue |
| VLB REST API | OAuth2 credentials per data recipient + a cover authorisation | new, and its tokens may not be exposed | a contract with MVB |

## Risks

- **The terms are the binding constraint, not the technology.** Three of the four sources that would
  close the gap are excluded, licensed or forbidden; the fourth (Literal) is silent about its images
  and returns Google's files for half of them.
- **The DNB's Anubis gate is untested from a datacenter.** It answered our own `User-Agent` on every
  one of ~160 requests from a residential address and challenged a browser UA 3 of 3. An Edge Function's address
  is shared and may be treated differently. A probe at deploy time and a lane that stops on the
  challenge page is the only safe shape.
- **Google's endpoints are undocumented and can go away without notice.** They answer without a key,
  which is exactly why they are tempting; the documented replacement (the API) returned 429 on 330
  of 330 requests here. Nothing about the ViewAPI/content pair is promised, and the branding and
  no-caching clauses of the Books terms are the only terms near them.
- **A 200 is not a cover.** Google answers a picture for nearly every ISBN, including ones it does
  not know; a naive lane would fill the library with grey cards. Whatever is built must check the
  pixels, not the status.
- **Goodreads is the owner-accepted risk it already is** ([THIRD-PARTY.md](../THIRD-PARTY.md)); this
  file asks the lane to be asked more often, not to be given new powers.
- **Storage.** The project links covers and never copies them (`private.cover_allowed`). Chain B
  would add hosts to that allow-list, to the CSP and to the service worker — the same follow-up
  `plans/cover-sources.md` already listed for Inventaire.

## Verdict

**Can Apple come out of the import completely?**

- **On the match side, yes** — that is what [apple-off-assessment.md](apple-off-assessment.md)
  measured: 667 of 709 rows match, 0 rows are unsure.
- **On the cover side, not without a decision the owner has already made once.** Within the terms
  the project accepts today, the server job's best chain leaves **34 of the 131 rows (26% of them,
  4.8% of the file) with no cover at all** (and 10 of its 97 covers under the 300 px bar) — even after the
  Goodreads lane is unblocked, which alone is worth 97 of the 131. Closing the last 34 needs the
  VLB licence (68 rows), Google (36 more) or Amazon (74), and each of those is an owner decision,
  not an engineering one.
- **The residue, stated plainly:**
  - **Chain A (today's terms): 34 rows coverless out of 131, 0 of 131 from Open Library, 97 from
    Goodreads.** Apple on the device is still needed for those 34, for the 112 rows under the 300 px
    bar and for the 42 unmatched rows — unchanged from the Apple-off assessment.
  - **Chain B (all exclusions lifted): 2 rows coverless out of 131**, 127 of the 129 at ≥ 300 px.
    That is the size of what the terms are buying.

**Recommendation:** do the free thing first — **unblock the Goodreads lane and let the server job ask
it for every coverless row (97 of 131, no new source, no new host)** — and treat the remaining 34 as
the number the owner is deciding about. If the answer to the VLB licence question is yes, DNB/MVB
alone takes those 34 down to **12** (22 of the 34 are German ISBN-13s the cover service has a picture
for) at the cost of one image request per German ISBN; Google and Amazon should stay excluded, and the
archived-original upgrade on Open Library is a sharper picture on 197 rows for free.

## Uncertainty (be frank)

- **One address, one day.** Everything here was measured from one residential address on 15 Oct
  2026, at 1–2 requests a second. None of these hosts published a limit that was hit; Google's
  `books/content` took 12 requests at 6.7/s without complaint, which is *not* a statement that a
  shared Edge Function's address will be treated the same.
- **A datacenter was not tested.** No test function was deployed (out of scope). The Anubis
  behaviour, the Google endpoints and the Amazon CDN were probed from here only; the header,
  `robots.txt` and challenge evidence is recorded above, and nothing more is claimed.
- **The correctness check is by eye, not by count.** The contact sheets say the DNB, Literal,
  Open Library and Goodreads found the right book for every tile looked at; that is a few hundred
  images, not a proof. Google's stand-ins are the failure mode that was found and counted; a
  wrong-book answer that *looks* like a cover would not have been caught by either method.
- **The stand-in rule is calibrated on this file.** "> 12 kB, not the same file three times" fits
  what these hosts served here; a host that changes its card would need the rule looked at again.
- **My Goodreads matcher is not the app's.** The looser 115 figure uses title forms and surname
  matching without the app's `ratingsCount` requirement; the 97 figure is the app's own `titleQuery`
  and `matchTitle` ported faithfully, and **97 is the number to use**. Both are ability, not what the
  run did.
- **Why the free-only run ended with only 72 Goodreads covers is inferred**, not observed: the
  numbers are consistent with the Apple search lane's 3 s pacing spending the fill's 600 s budget
  before the Goodreads queue is reached, but the run's own logs were not re-read for this file.
- **LibraryThing is described, not measured; Hardcover was measured on the 34 residue rows only** (11 usable covers, counts only). No dev key was made for LibraryThing,
  and creating accounts is not this task's call.
- **Amazon's and DNB's sample numbers were not eyeballed**, only stand-in-checked (both were 0
  stand-ins there, and every cover on the 131 rows of both was looked at).

## The working data

Counts only here; the per-row scripts and the images stayed in the gitignored
`.shots/cover-sources/` of the worktree that produced this file (`rows.py` picks the two row sets,
`harness.py` is the polite cached fetcher, `sources.py` + `google_bulk.py` + `goodreads_app.py` +
`ol_original.py` ask the sources, `verify.py` tells a stand-in from a cover, `analyze2.py` prints
every number above). Re-checked in this pass: `analyze2.py` (coverage, sizes, chains), `ol_original.py`
(the archived-original numbers), and the Goodreads, DNB, Literal and Google result files; all matched. `rows.py`,
`verify.py` and `sources.py` are not in the gitignored directory of this worktree and were not re-run.
Hardcover was measured on the 34 Chain-A residue rows (11 usable covers ≥ 300 px, 11 thumbnails, 12 without an edition); its images are user uploads and their licence is not tested. Not tested: retailer CDNs, ISBNdb, Syndetics, Penguin Random House and LibraryThing. They are a measurement, not a proposal: they read the Apple-off run's audit
from a local path and name the member's books, so they are not part of this branch.

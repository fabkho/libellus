# dnb-lookup

German editions from the German National Library (DNB, Deutsche Nationalbibliothek) for the barcode scan, the
ISBN lookups, the edition picker and the import's match (docs/ENRICHMENT.md). CC0 data: no attribution, no storing
limit. It has no covers and no genres
(an Open Library cover by ISBN is added where there is one). The app side is `web/app/data/dnb.ts`; docs/ENRICHMENT.md
says where it is used and why.

```
POST /functions/v1/dnb-lookup   { "action": "isbn",     "isbn13": "9783499267017" }
POST /functions/v1/dnb-lookup   { "action": "editions", "title": "Der Schwarm", "authors": ["Frank Schätzing"] }
POST /functions/v1/dnb-lookup   { "action": "book",     "isbn13": "9783499267017", "cover": { "coverUrl": "https://…", "coverThumbhash": "…", "coverColors": { "dominant": "#…", "secondary": "#…" } } }

200 { "status": "found", "edition": { title, authors, isbn13, publisher, year, language, pages, coverUrl } }
200 { "status": "not_found" }
200 { "status": "ok", "editions": [ … ] }
200 { "status": "found", "book": <a `books` row> }
400 isbn_invalid · book_unidentified · action_unknown · 401 unauthorized · 413 payload_too_large · 429 rate_limited · 502 dnb_unavailable
```

- **Who**: a signed-in member's access token or the service-role key (`verify_jwt` is off, supabase/config.toml; the
  function checks the caller). A member may call it 30 times a minute (`edge_rate_hit`, bucket `dnb-lookup`; the scan,
  the picker, adding a Book), an import 120 a minute: its body says `purpose: 'import'` and is counted in its own
  bucket (`dnb-lookup-import`), and the import paces its calls 500 ms apart (`createDnb`'s `gapMs`) so a whole file
  meets no refusal.
- **`book`** makes the Catalogue Book (source `import`, found again by its ISBN-13) from what the DNB says about the
  ISBN, never from what the caller sends. A member may only add or pick a Catalogue Book (`add_to_library`,
  `change_edition` refuse an `import` snapshot that matches none), so this is what makes a German edition only the
  library knows addable. A Book the Catalogue already has is returned as it is. The cover is the one the app sent (only
  Apple's CDN or Open Library, a thumbhash and two `#rrggbb` colours, anything else is left out), else Open Library's by
  ISBN when it has one (`HEAD`, nothing downloaded).
- **The DNB** (`client.ts`): SRU (`https://services.dnb.de/sru/dnb`, CQL, `oai_dc`), identified by `User-Agent:
  Libellus/1.0 (…)` (`LIBELLUS_SITE_URL` adds where the instance lives), at most five requests a second **across every
  instance** (one shared pace booked in Postgres, `edge_pace_take('dnb', 200, 3000)`, `../_shared/pace.ts`; a turn more than
  3 s away answers 503 `busy` with a `Retry-After`, the database out of reach falls back to this instance's own queue),
  four seconds each, and a breaker: three failed answers in a row (a converter diagnostic arrives with HTTP
  200) rest it for a minute. A failure is never stored; the answer is 502 `dnb_unavailable` and the app shows nothing.
- **Parsing** is `web/app/data/dnbRecord.ts` (shared with the app; no imports of its own).
- No cache table: the DNB answers in about 100 ms and the Catalogue keeps what was added.

```
cd supabase/functions/dnb-lookup
deno lint && deno check *.ts && deno task test      # recorded answers in fixtures/, nothing is fetched
supabase functions serve dnb-lookup                  # or: supabase start (the edge runtime serves it)
```

Deploy: `supabase functions deploy dnb-lookup --no-verify-jwt` with the rest of the functions.

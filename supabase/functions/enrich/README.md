# enrich

Authors, series and genres for the Catalogue (issues #166, #167, #168), server-side: the browser never
talks to Wikidata, Open Library, Wikipedia, Wikimedia Commons or Apple for this. What it finds is cached
in the database (supabase/migrations/20261011010000–20261011012000) and read by the app through RPCs
(docs/ENRICHMENT.md). Sources stay invisible to members; what their licence asks for (Commons photo
credits, "From Wikipedia" with a link) is stored with the data.

```
POST /functions/v1/enrich
{ "action": "drain", "limit"?: n }       service: work through the queue (up to 90 s), then refresh stale authors
{ "action": "book", "bookId": "…" }      member or service: enrich one Catalogue Book now
{ "action": "author", "key": "Q46248" }  member or service: refresh one author if older than 30 days
{ "action": "backfill", "limit"?: n }    service: queue every Catalogue Book never enriched
{ "action": "remap" }                    service: apply the current genre mapping to stored signals
{ "action": "status" }                   service: the queue at a glance

200 { … } · 400 action_invalid · 401 unauthorized · 403 forbidden · 404 not_found · 429 rate_limited · 502 source_unavailable · 503 busy
```

A member's `book` and `author` calls are counted per member (10 a minute, `public.edge_rate_hit`): they spend the
shared Apple, Open Library and Wikidata budget. The service is not counted; an unreachable counter is a 503.
The service-role key and `ENRICH_TOKEN` are compared in constant time (`secret.ts`).

## When it runs

1. A Book enters the Catalogue (add, import, Change edition: any insert of a Catalogue row into `books`):
   the trigger `books_enrich` queues it in `private.enrich_queue` and calls `private.enrich_kick()`, which
   POSTs `{"action":"drain"}` to the function through pg_net, at most once in two minutes. The member's write
   never waits for it and never fails because of it.
2. pg_cron's `enrich-drain` (every ten minutes) calls the kick again for whatever is still due (a Book
   that failed waits 10, 20, 40 … minutes, at most a day; after six attempts it is recorded as `failed`).
3. pg_cron's `enrich-refresh` (daily, 04:20 UTC) queues up to 200 Books enriched more than 30 days ago;
   every drain also refreshes up to three authors of Library Books whose facts are older than 30 days.
4. The one-off backfill for Books that were there before: `backfill.ts` (below), or `{"action":"backfill"}`
   followed by the drains pg_cron makes.

Without the function's URL and token (the local stack, CI) nothing is sent: the queue waits.

## What it asks, per Book (`enrich.ts`)

1. **Open Library**: the edition by the Book's own key or ISBN (`/isbn/<isbn>.json`), its work
   (`/works/<key>.json`: authors, subjects, `identifiers.wikidata`, `series`); without either, a title +
   first-author search. The work's authors (`/authors/<key>.json`: name, photo, `remote_ids.wikidata`).
2. **Wikidata**: the work item by Open Library's link, else `haswbstatement:P648=<work key>`, else a title
   search among the first author's works (`haswbstatement:P50=<author>`); an edition item leads to its
   work (P629). Series and ordinal (P179 + P1545), genres (P136), kind (P31/P7937), labels per language.
3. **Series**: for a series met for the first time (or 30 days ago), its name and parent series and every
   work in it (SPARQL), so the Book page has neighbours. Without Wikidata: Open Library's series, else the
   edition's free-text `series` ("Discworld ; 15").
4. **Authors**: the Book's credited names matched by name to the work's authors (a translator or an
   introducer the edition credits stays unlinked); a first author nobody knows gets a name-only row.
5. **Genres**: Apple's genre names (iTunes lookup by track id, else by ISBN, in English, many Books per
   request), Wikidata's genres, Open Library's subjects → `web/app/data/enrich/genres.ts` (versioned,
   unit-tested) → at most three canonical ids. The raw signals are kept for a later mapping version.
6. Every linked author not fetched in 30 days: Wikidata facts (one SPARQL query: life dates with precision,
   portrait, Open Library ids, Wikipedia articles), the portrait on **Commons** (thumbnail, licence,
   author), else Open Library's photo; the **Wikipedia** summary per language (`ENRICH_LANGUAGES`); the
   works (Wikidata's list with series, merged with Open Library's per language for covers and a
   representative edition with its ISBN).

A source that fails (down, slow, refusing) puts the Book back in the queue; a source that knows nothing is
a miss, and the Book is stored with what the others found (`not_found` when nobody knew anything).

## Politeness (`http.ts`)

`User-Agent: Libellus/1.0 (private book tracker; +<LIBELLUS_SITE_URL>; <ENRICH_CONTACT>) enrich`, as the
Wikimedia User-Agent policy asks; one request at a time per host and spaced (Open Library and the Wikidata
Query Service 1/s, Apple one every 3 s, the Wikimedia APIs 5/s); 10 s per request; 429 and 5xx retried
twice, honouring `Retry-After` (at most 10 s); answers kept ten minutes in memory. The tables are the
long-term cache: authors, works and series are asked about again after 30 days, not before.

## Files

- `wikidata.ts`, `openlibrary.ts`, `wikimedia.ts`, `apple.ts` — pure: URLs and parsing. No I/O.
- `match.ts` — pure: titles and names across spellings.
- `http.ts` — the only way out: user agent, per-host spacing, timeout, retries, short cache. `fetch` and
  clock injected.
- `sources.ts` — the sources as typed calls on top of `http.ts`.
- `enrich.ts` — what a Book and an author come to, as one payload for `enrich_save`.
- `store.ts` — the database side (service-role RPCs), and an in-memory store for the tests.
- `handler.ts` — the requests. `index.ts` — the wiring.
- `backfill.ts` — the backfill and coverage report from a terminal.
- `scenarios.ts`, `fixtures/`, `record_fixtures.ts` — recorded answers for Pratchett (Small Gods),
  Le Guin (A Wizard of Earthsea), Haldeman (The Forever War) and a Book nobody knows.
- `*_test.ts` — unit tests; never call a source (an unrecorded URL fails).

## Local

```sh
cd supabase/functions/enrich && deno task test        # unit tests, offline
supabase functions serve enrich                       # from the repo root, against the local stack
```

Backfill (live calls, politely spaced: a few seconds a Book, more for an author met the first time;
resumable: stop it any time and run it again) and the coverage report for one member's Library:

```sh
cd supabase/functions/enrich
SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<from supabase status> \
  deno run --allow-net --allow-env --allow-read=.,../../../web/app/data/enrich backfill.ts dev@libellus.local
# --no-queue: only drain what is queued · --report: only report · --remap: apply a new genre mapping first
```

Renew the recordings (rarely):

```sh
cd supabase/functions/enrich && deno run --allow-net --allow-read --allow-write=fixtures record_fixtures.ts
```

## Deploy (hosted)

1. Migrations: `supabase db push` (genres, authors/works/series, the queue and its jobs).
2. Function: `supabase functions deploy enrich` (reads `verify_jwt = false` from `config.toml`).
3. Secrets: `supabase secrets set ENRICH_TOKEN=$(openssl rand -hex 32)`, the shared secret pg_cron's call
   sends. Optional: `LIBELLUS_SITE_URL` (the instance's address, named in the User-Agent),
   `ENRICH_CONTACT` (an e-mail address or URL for source operators; the project's page by default),
   `ENRICH_LANGUAGES` (`en,de` by default: Wikipedia intros, titles and editions in these languages).
   The runtime provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Let the database call it (SQL editor):

   ```sql
   update private.enrich_settings set function_url = 'https://<ref>.supabase.co/functions/v1/enrich';
   select vault.create_secret('<the same ENRICH_TOKEN>', 'enrich_token');
   ```

5. Backfill: `curl -X POST https://<ref>.supabase.co/functions/v1/enrich -H "Authorization: Bearer <ENRICH_TOKEN>"
   -d '{"action":"backfill"}'`; pg_cron drains it (about 50 Books an hour), or run `backfill.ts` against the
   hosted URL and service-role key to do it at once.

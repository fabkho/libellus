# catalogue-check

A checked Catalogue (social v2a contract §5, `docs/proposals/social-v2a-contract.md`). A Catalogue Book
keeps what the first member to add it sent; this function reads each unchecked one at its source and writes
what the source says: **title, authors, description, cover URL**. Until a Book is checked, other members and
the public reading page get its title and authors but not its description (`private.description_shown`).

```
POST /functions/v1/catalogue-check
{ "action": "drain", "limit"?: n }   service: check up to n (8, at most 20) unchecked Books
{ "action": "status" }               service: unchecked / checked / failed / backing off

200 { checked, missed, failed, released } · 400 action_invalid · 401 unauthorized · 405 · 500 check_failed
```

## When it runs

pg_cron's `catalogue-check` (every minute) calls `private.catalogue_check_kick()`, which POSTs
`{"action":"drain"}` through pg_net when an unchecked Book is due (at most once in 50 s). The queue is
implicit: every Catalogue Book (`owner_id` null) with `checked_at` null, never-tried first, then newest
first. Existing rows are unchecked too, so the check works through them over time, eight a minute. A Manual
book (`owner_id` set) is never checked; a constraint keeps it so.

Without the function's URL and token (the local stack, CI) nothing is sent: the Books stay unchecked.

Once, by the owner:

```sql
update private.catalogue_check_settings set function_url = 'https://<ref>.supabase.co/functions/v1/catalogue-check';
select vault.create_secret('<the CATALOGUE_CHECK_TOKEN function secret>', 'catalogue_check_token');
```

```sh
supabase secrets set CATALOGUE_CHECK_TOKEN=<random>      # LIBELLUS_SITE_URL and ENRICH_CONTACT are read too (User-Agent)
supabase functions deploy catalogue-check
```

## What it asks, per Book (`check.ts`)

- **Apple** (a Book with an `apple_id`): `https://itunes.apple.com/lookup?id=<ids>&country=us` (then `de`, `gb`
  for the ids not found), many Books per request. An id no storefront knows is unknown.
- **Open Library**: the edition `/books/<key>.json`, else `/isbn/<isbn>.json` (13, then 10), else the work
  `/works/<key>.json`; the edition's work for a blurb or cover it lacks; `/authors/<key>.json` for the names
  (at most three). A key the source lacks falls through to the next.
- Covers by the app's rules (`web/app/data/covers.ts`): Apple's artwork on `*.mzstatic.com` at 600 × 900, or
  `covers.openlibrary.org/b/id/<n>-L.jpg`. Anything else is left out and the Book keeps its cover. The cover's
  thumbhash and colours are dropped when the URL changes (they described another picture).

## What happens to the answer

| Answer | Stored |
| --- | --- |
| the source knows the Book | `catalogue_check_save`: title, authors, description (the source's, null if it has none), cover; `checked_at` set |
| the source does not know it | `catalogue_check_miss`: `check_failed = true`, `checked_at` set, data kept |
| the source failed (down, slow, garbled, 429) | `catalogue_check_failed`: tried again after 5 min, 10, 20 … at most a day; never given up (an unchecked Book only keeps its description withheld) |
| the run ran out of time (50 s) | `catalogue_check_release`: back at once, the attempt not counted |

## Trust and limits (the security notes)

- **Caller**: the service-role key or `CATALOGUE_CHECK_TOKEN`, nothing else; a signed-in member's token is
  refused (`verify_jwt` is off, the function checks itself). The request carries an action and a number; the
  work comes from the database queue, so no member chooses what is fetched.
- **Fetches**: only `itunes.apple.com` and `openlibrary.org`, over https (`safe_fetch.ts`: allowlist per
  request and per redirect hop, no credentials or ports, three hops at most). The addresses are built from the
  Book's keys after a shape check (digits, `OL…M/W/A`, ISBN-13/10), so a hostile key cannot steer a request.
  Polite as the enrichment is: one request at a time per host (Open Library a second, Apple three), identified
  by User-Agent, a timeout, two retries.
- **Writes**: only through the service-role RPCs of `20261021020000_catalogue_check.sql`, only to an
  unchecked Catalogue Book, and only title, authors, description, cover (and the cover's hash and colours,
  cleared). Every field is validated here (type, length, plain text, https cover on the two cover hosts) and
  again in `catalogue_check_save`. A title that is too long, a cover elsewhere, authors that are not all text are
  ignored (the Book keeps its own); a description over 10 000 characters is cut there.
- **Trusts**: that Apple and Open Library answer for the Book's keys. It does not trust the first member's
  text, which is the point. An Open Library record is crowd-edited; what it says about a Book is checked only
  for shape, as the app's own search already treats it.

## Tests

`deno task test` (needs `deno`): the lookups on stand-in sources (nothing touches the internet; `fetch` and
the clock are injected), the validation, the host allowlist, the handler against an in-memory store. The
database side is `supabase/tests/catalogue_check_test.sql`.

# catalogue-check

A checked Catalogue (social v2a contract §5, `docs/proposals/social-v2a-contract.md`). A Catalogue Book
keeps what the first member to add it sent; this function reads each unchecked one at its source and writes
what the source says: **title, authors, description, cover URL, publisher, language, format, pages and year**. Until a Book is checked, other members and
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
supabase secrets set CATALOGUE_CHECK_TOKEN="$(openssl rand -hex 32)"   # 32 characters at least, else it is ignored
supabase functions deploy catalogue-check                              # LIBELLUS_SITE_URL and ENRICH_CONTACT are read too (User-Agent)
```

The address must be `https://` (the database refuses another: the call carries the token). The Vault secret
`catalogue_check_token` must be the same string as the function secret.

## If it does not run

The cron's call is sent through pg_net and answers into the database a minute later, where the next kick reads it.
The owner looks here:

```sql
select last_kick_at, last_status, last_error, last_status_at from private.catalogue_check_settings;
```

`last_status` 200 is a drain that ran; **401** is a token the function does not accept (the Vault's is not the
function secret, or the secret is under 32 characters: the function logs it and takes the service-role key only);
5xx or a null status with an `last_error` (a timeout, no route) is the function being down or slow. The status
action of the function (`{"action":"status"}`) answers the counts and the same three fields as `lastKickAt`,
`lastStatus`, `lastError`; the function's logs have the rest. Nothing alerts: a Book that stays unchecked is the
sign (it shows to others as its first member sent it, title and authors only).

## What it asks, per Book (`check.ts`)

A Book is resolved by **one** key, in this order: ISBN-13, ISBN-10, Apple id, Open Library edition key, work
key. **Every other key the row stores must agree** with what the source says, and the stored title must be the
source's title by the app's normalised key (`work_title_key`: brackets and the part after a colon dropped, accents
and punctuation ignored). Any disagreement is a `mismatch`: `check_failed`, nothing written, and no other key is
ever tried (a member could otherwise pair a real ISBN with a bestseller's id and have the bestseller's data
written under the ISBN).

- **By ISBN** (13, or an ISBN-10 as its ISBN-13; both stored must be the same number): a row with an Apple id
  is asked of **Apple** (`/lookup?isbn=<isbn>&country=us`, then `de`, `gb`): the edition with the stored id
  must be among the answers. Else a row with Open Library keys, or whose `source` is openlibrary, is asked of
  **Open Library** (`/isbn/<isbn>.json`): the record's `key` is the stored edition key, its ISBNs list the stored
  ISBN, its works list the stored work key. A row with an ISBN only asks its own source first, then the other.
- **By Apple id** (no ISBN): `/lookup?id=<ids>&country=us` (then `de`, `gb` for the ids not found), many Books
  per request. Open Library keys stored with an Apple row are read at Open Library: the edition has the same
  title and lists the stored ISBN; the work is one of the edition's (or, with no edition, has the same title).
- **By Open Library edition key** (`/books/<key>.json`), else **work key** (`/works/<key>.json`); the edition's
  work for a blurb or cover it lacks; `/authors/<key>.json` for the names (at most three).
- Keys that are not shaped like keys (an ISBN-10 that is no ISBN-13's twin, an Apple id that is not digits, …)
  are a mismatch before anything is asked. A key the source lacks is `unknown`, which is a miss too.
- Covers by the app's rules (`web/app/data/covers.ts`): Apple's artwork on `*.mzstatic.com` at 600 × 900, or
  `covers.openlibrary.org/b/id/<n>-L.jpg`. Anything else is left out. The cover's thumbhash and colours are
  dropped when the URL changes (they described another picture).

## What happens to the answer

| Answer | Stored |
| --- | --- |
| the source knows the Book | `catalogue_check_save`: the source's title, authors (or none), description (or none), cover (or none), publisher, language and format (or none); pages and year the source's, else the row's own only if plausible; `checked_at` set. Nothing the member sent stays that the source did not say |
| the source does not know it, or its answer disagrees with the row (`mismatch`) | `catalogue_check_miss`: `check_failed = true`, `checked_at` set, nothing written |
| the source failed (down, slow, garbled, 429) | `catalogue_check_failed`: tried again after 5 min, 10, 20 … at most a day; never given up (an unchecked Book only keeps its description withheld) |
| the run ran out of time (50 s) | `catalogue_check_release`: back at once, the attempt not counted |

## Trust and limits (the security notes)

- **Caller**: the service-role key or `CATALOGUE_CHECK_TOKEN` (32 characters at least, else ignored), nothing
  else, compared in constant time (`authorize.ts`); a signed-in member's token is refused (`verify_jwt` is off,
  the function checks itself). The request carries an action and a number; the
  work comes from the database queue, so no member chooses what is fetched.
- **Fetches**: only `itunes.apple.com` and `openlibrary.org`, over https (`safe_fetch.ts`: allowlist per
  request and per redirect hop, no credentials or ports, three hops at most). The addresses are built from the
  Book's keys after a shape check (digits, `OL…M/W/A`, ISBN-13/10), so a hostile key cannot steer a request.
  Polite as the enrichment is: one request at a time per host (Open Library a second, Apple three), identified
  by User-Agent, a timeout, two retries. A response is read to 1 MB and no further (a record from a source we
  do not control): past it the Book is `unavailable` and tried again later, not retried at once.
- **Writes**: only through the service-role RPCs of `20261021020000_catalogue_check.sql`, only to an
  unchecked Catalogue Book, and only title, authors, description, cover (and the cover's hash and colours,
  cleared), publisher, language, format, pages, year. Every field is validated here (type, length, plain text,
  https cover on the two cover hosts) and again in `catalogue_check_save`. A title that is not the row's
  (`work_title_key`) marks the Book failed and writes nothing; authors that are not all text, a cover elsewhere,
  a description over 10 000 characters are stored as nothing, not as the member's value.
- **Trusts**: that Apple and Open Library answer for the Book's keys. It does not trust the first member's
  text, which is the point. An Open Library record is crowd-edited; what it says about a Book is checked only
  for shape, as the app's own search already treats it.

## Tests

`deno task test` (needs `deno`): the lookups on stand-in sources (nothing touches the internet; `fetch` and
the clock are injected), the validation, the host allowlist, the handler against an in-memory store. The
database side is `supabase/tests/catalogue_check_test.sql`.

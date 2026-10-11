# The owner's instance

Tooling that only the owner's instance (libellus.fabkho.dev) uses: bringing the owner's Fable
history over once (and, from the app's own export, a Reado account's), and publishing the owner's Library to Regal, the 3D bookshelf on
fabkho.dev/books. Nothing here is needed to run Libellus; anyone not working on these two can ignore this page and
the files it names (`web/scripts/import-fable.ts`, `web/scripts/fable/`,
`web/app/data/import/{fable,readingTracker}.ts` for Fable;
`web/scripts/import-reado.ts`, `web/scripts/reado/`, `web/app/data/import/reado.ts` for Reado;
`web/scripts/export-regal.ts`, `web/app/data/export/`, `supabase/functions/regal-export/` and the
`shelf_publish` migration for Regal). The Regal layer itself is opt-in (`LIBELLUS_REGAL=1`,
[SETUP.md](SETUP.md), Optional pieces).

## The Fable import and the dev seed

The owner's Fable history comes over once, with `web/scripts/import-fable.ts` (#17). It reads
`reading list --json` from the [reading-tracker CLI](https://github.com/fabkho/reading-tracker-cli)
(`~/code/reading-tracker-cli`, or `READING_TRACKER_CLI`), applies the overrides file Regal reads
(`~/.reading-tracker/regal-overrides.json`: skips, merges, dates, the edition and language read, pinned
covers), and maps it (`web/app/data/import/`, pure and tested): editions of one title by one author
become one entry with the most recent edition as its Book, every Fable read one Reading session
(the `read` shelf finished, `dnf` abandoned, a start with no end on any other shelf Currently
reading; none on *Want to read*), ratings exact in quarters. Then
it looks up covers and Catalogue ids (Apple Books by ISBN, then by title in the storefront of the
language read, then OpenLibrary) and writes as the service role, keyed by the Fable record
(`import_key`), so a rerun changes nothing that has not changed.

```sh
cd web
pnpm seed:dev                                # the dev member dev@libellus.local, local stack
pnpm import:fable --email you@example.com --dry-run   # what a run would write, nothing written
pnpm import:fable --help                     # --from, --overrides, --prune, --offline, --target
```

It asks the network once per Book: lookups are cached in `.data/fable-import/` at the repo root, with
the last run's report (counts, covers per source, what could not be carried over). `.data/` is ignored
by git; the real reading history never lands in the repository. `--target local` (the default) always
writes to the stack `supabase status` reports, whatever `SUPABASE_URL` says; `--target hosted` (#18)
takes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and wants the host repeated with `--confirm-host`.

Known gaps: the German National Library's covers are found for German editions but not stored (its
server answers browsers with a bot page, so they need rehosting first; follow-up issue); Regal's
Goodreads second opinion on read dates is not part of the import.

## The Reado import

Reado's iOS app has a data export (found by exploring the app: it is in none of Reado's help articles;
the exact menu path is for the owner to add here). The file is `schemaVersion: 1` JSON and holds much
more than books (notifications, followers, comments, push tokens, the email), so it is private: keep it
out of the repository, commits and pull requests. `web/scripts/import-reado.ts` reads only the keys it
needs (`userObject.lists`, `readingJournal`, `newJournal`, `customBooks`, `posts`).

```sh
cd web
pnpm import:reado --from ~/Downloads/export.json --plan                      # map only: counts and the report
pnpm import:reado --from ~/Downloads/export.json --email you@example.com --dry-run
pnpm import:reado --from ~/Downloads/export.json --email you@example.com     # local stack
pnpm import:reado --help          # --started-only, --aborted, --no-collections, --no-covers, --prune, --offline
```

One run per exported account, into the member it belongs to; `--target hosted` works as for Fable.
The rules are in the header of `web/app/data/import/reado.ts`. In short: `_read` finished with the
journal's real days (the shelf item's `updatedAt` is when it was added, never a reading date), `_reading`
currently reading, `_stack`, `_wishlist` and every custom list Want to read, `_favorites` and the custom
lists also Collections (additive: the import never takes an entry off one), an `ABORT` event a DNF,
ratings in half stars kept exactly as quarters (4.5 stars is 18). Keys are `reado:isbn:<isbn13>`.

**The export names books by ISBN or by a 64-hex `p_id`, and holds no titles.** The ISBN books are looked
up like a barcode scan (Apple Books, then OpenLibrary; cached in `.data/reado-import/`), then get the
Fable import's cover chain. A `p_id` is attached to an ISBN only on hard evidence (an ISBN on its shelf
item, or a dated event that is the same in `newJournal` and the journal and belongs to one ISBN); the
rest is **not imported** and the run says so, last and loudly, by reason, with the full list in
`.data/reado-import/report-<member>.json`.

First real run (the larger account, 458 finished books on Reado's shelves; local stack): 196 entries
(166 finished, 30 Want to read), 166 reads (163 finished, 3 DNF), 144 ratings, 71 reviews, 7 Collections
with 115 entries; a second run changed nothing. Not imported: 461 `p_id`-only books (692 shelf items, of
them 267 on `_read`; 257 finished, 135 rated, 101 reviewed; 2 684 progress entries), 49 Kindle ASIN
books, 66 ISBNs with no title on Apple or OpenLibrary (41 finished), and 114 ISBN books that are a lone
`START` on no shelf (what the 2023 imports wrote for books never read; `--started-only want` keeps them).

Known gaps, and what closes them (stage 2): the `p_id` → ISBN/title bridge. Reado's own API
(`internal/booksBatched` on `backend-14.read-o.com`) looks like p_ids in, books out, but answers 403
anonymously, so it needs a credential. It would attach the 461 books above, plus their ratings, dates and
reviews. The mail to `support@reado.app` about the export's `library: null` is the zero-risk route.

## Feeding Regal

[Regal](https://github.com/fabkho/regal), the owner's 3D bookshelf on fabkho.dev/books, reads one
file: a [Regal library file](https://github.com/fabkho/regal/blob/main/docs/library-file.md)
(version 2). Libellus writes it from a member's Library with `web/scripts/export-regal.ts` (#22)
and serves the owner's with the edge function `regal-export` (#110), read only: one Book per Library entry (the edition's id as its id), the Status from the latest
Reading session (`read`, `dnf`, `currently-reading`, `to-read`), the date read, Rating and review
from the last finished read, the read count, ISBN, pages (the member's own count where she set one), publisher, blurb, the Cover URL and a
palette from the Cover's colours. The mapping is `web/app/data/export/regal.ts` (pure, pinned by a
fixture); the file is checked with Regal's validator, vendored in
`web/app/data/export/regalLibraryFile.ts` with the Regal commit it came from (run the tests with
`REGAL_DIR=<regal checkout>` to compare it with Regal's own). Want to read stays out unless
`--statuses` asks for it. Libellus has no series, binding or Spine art: Regal assets fills what it
can.

The daily chain runs in the cloud (#110), nothing on a Mac:

```
owner's change ─► trigger (owner only, ≥ 10 min apart) ─► pg_net ─► GitHub repository_dispatch libellus-changed ─┐
daily 05:00 UTC, or by hand ───────────────────────────────────────────────────────────────────────────────────┼─► fabkho/regal publish-shelf.yml
publish-shelf.yml: GET /functions/v1/regal-export ─► validate ─► regal-assets --no-ai --no-model --revalidate --publish v2 ─► R2 portfolio-books/v2/
```

1. **The export endpoint**: the edge function `regal-export` (`supabase/functions/regal-export/`, its
   README has the details) answers the owner's Library as a library file to
   `Authorization: Bearer <REGAL_EXPORT_TOKEN>`: the Books read, the art of the published file carried
   over, the member's own page count (`page_count_override`, #60) where she set one. The same mapping
   as the script below, imported from `web/app/data/export/` (a closed set of pure modules with
   `.ts` imports, which Deno runs as they are). Without the published file it answers 502 and nothing
   is published.
2. **The trigger** (`supabase/migrations/20261005114229_shelf_publish_dispatch.sql`): a change to
   the owner's `library_entries` or `reading_sessions` (a read, a Rating, a review; not progress, the shelf shows finished books only) sends
   fabkho/regal a `repository_dispatch` through pg_net, at most once per ten minutes; a change inside
   the ten minutes is sent by pg_cron's `shelf-publish` job (every five minutes) once they are up.
   The owner is the one row of `private.shelf_publish` (no address in SQL); the GitHub token is the
   Vault secret `github_dispatch_token`. Without either, or without pg_net, it does nothing (the
   local stack, the tests). A failing dispatch never fails the write.
3. **The workflow** in Regal (`.github/workflows/publish-shelf.yml`, Regal's README: The daily
   chain) fetches the file, validates it and runs Regal assets with `.data/regal-assets` cached
   between runs, so a quiet run uploads nothing.

Configuration, all outside the repo:

| Where | Name | |
|---|---|---|
| Function secrets (`supabase secrets set`) | `REGAL_EXPORT_TOKEN` | The shared bearer secret, ≥ 32 characters (`openssl rand -hex 32`). |
| | `REGAL_OWNER_EMAIL` | The owner's sign-in address. |
| | `REGAL_OWNER_NAME` | `Fabian`: the file's `owner`, as Regal shows it. |
| | `REGAL_TIME_ZONE`, `REGAL_STATUSES`, `REGAL_CARRY_ART_URL` | Optional: `Europe/Berlin`, `read`, `https://books.fabkho.dev/v2/library.json`. |
| Database | `private.shelf_publish.owner_id` | `update private.shelf_publish set owner_id = (select id from auth.users where email = '<owner>');` |
| Database | `private.instance_owner.owner_id` | `update private.instance_owner set owner_id = (select id from auth.users where email = '<owner>');` Not for Regal: it lets the owner read the client error log (Profile → Errors) and the waitlist (Profile → Waitlist) in the app ([Errors](OPERATIONS.md#client-errors), [Waitlist](OPERATIONS.md#waitlist)), together with the web build's `NUXT_PUBLIC_SHELF_OWNER_ID`. |
| Vault | `github_dispatch_token` | A fine-grained GitHub token, fabkho/regal only, Contents read and write: `select vault.create_secret('<token>', 'github_dispatch_token');` |
| fabkho/regal Actions secrets | `REGAL_EXPORT_TOKEN`, `LIBELLUS_EXPORT_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | The same token; `https://<project>.supabase.co/functions/v1/regal-export`; R2 Object Read & Write on `portfolio-books`; the account id. |

By hand, the same file from any stack (read only; never `--publish` by hand while testing):

```sh
# 1. Libellus → library file, keeping the art Regal shows now
cd web
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm export:regal --target hosted --confirm-host <project host> \
  --email <owner> --owner Fabian --statuses read --carry-art https://books.fabkho.dev/v2/library.json \
  --out ../.data/regal/library-v2.json
# 2. in a Regal checkout: Spines, backs, pile copies and colours; --dry-run shows what would be published
pnpm regal-assets --in <libellus>/.data/regal/library-v2.json --no-ai --no-model --revalidate --dry-run --publish v2
```

`--carry-art` takes the file that is published now: every exported Book it has (by ISBN-13, else by
title and first author's surname, so a Book whose edition changed in Libellus still finds it) keeps
its published front, Spine, back and colours, so the portfolio's paid AI art survives; a Book it does
not have gets the Libellus Cover, and Regal draws its Spine and back (or `regal-assets` without
`--no-ai` makes them). Published art sticks: a matched Book keeps it when its Libellus Cover changes.
The export is deterministic and is not rewritten when only `generatedAt` would change, so Regal
assets finds every Book in its cache and uploads nothing on a quiet day. `pnpm export:regal --help`
lists the options (`--statuses`, `--time-zone`, `--generated-at`).

# regal-export

The owner's Library as a [Regal library file](https://github.com/fabkho/regal/blob/main/docs/library-file.md)
(issue #110), for the Regal workflow that publishes the portfolio's shelf on fabkho.dev/books
([`publish-shelf.yml`](https://github.com/fabkho/regal/blob/main/.github/workflows/publish-shelf.yml)).
Read only.

```
GET /functions/v1/regal-export[?statuses=read,dnf,currently-reading,to-read]
Authorization: Bearer <REGAL_EXPORT_TOKEN>

200 the library file (two-space JSON), headers x-regal-books, x-regal-art-carried
400 statuses_invalid · 401 unauthorized · 405 method_not_allowed
500 not_configured · owner_not_found · export_invalid · export_failed
502 published_unavailable
```

The same file as `pnpm export:regal --email <owner> --statuses read --carry-art <published>`
(`web/scripts/export-regal.ts`), byte for byte but for `generatedAt`: the mapping
(`web/app/data/export/regal.ts`), the art carried over from the published file
(`web/app/data/export/carryArt.ts`) and Regal's validator (`web/app/data/export/regalLibraryFile.ts`)
are imported from the web app as they are. Those three files are a closed set of pure modules (no
imports but each other, with their `.ts` extension), which is what lets Deno run them; keep them so.
The member's own page count (`library_entries.page_count_override`, #60) is the Book's `pages`
where she set one.

The published file (`REGAL_CARRY_ART_URL`) is read first. When it cannot be read or is not a valid
library file, the answer is 502 and no file goes out: a file without the published art would make
Regal assets replace the portfolio's Spines and backs with drawn ones.

## Configuration

Function secrets (`supabase secrets set …`); the runtime provides `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` (the Library is read with the service role).

| Secret | |
|---|---|
| `REGAL_EXPORT_TOKEN` | Required. The shared bearer secret, at least 32 characters (`openssl rand -hex 32`); the same value as Regal's repository secret `REGAL_EXPORT_TOKEN`. Compared in constant time. |
| `REGAL_OWNER_EMAIL` | Required. The member whose Library is the shelf. |
| `REGAL_OWNER_NAME` | `owner` of the file, as Regal shows it to visitors (`Fabian`). Left out when unset. |
| `REGAL_STATUSES` | Default `read` (the portfolio shows the Books read). A request's `?statuses=` wins. |
| `REGAL_TIME_ZONE` | The zone `dateAdded` is a day in. Default `Europe/Berlin`. |
| `REGAL_CARRY_ART_URL` | The published file whose art the export keeps. Default `https://books.fabkho.dev/v2/library.json`; `none` = no art carried (a first export). |

Without `REGAL_EXPORT_TOKEN` or `REGAL_OWNER_EMAIL` every request is answered 500 `not_configured`
(the log says which). `verify_jwt` is off in `supabase/config.toml`: the caller has no Supabase key,
only the token, which `handler.ts` checks.

## Files

- `handler.ts` — the request/response logic, configuration, the token check, the published file. Everything injected.
- `library.ts` — the read: rows of `library_entries` with their Book and every read, as export entries.
- `index.ts` — the wiring: supabase-js with the service role, `Deno.serve`.
- `fixtures/` — a synthetic Library (`entries.json`), a published file (`published.json`) and the file they give (`expected.json`).
- `handler_test.ts`, `library_test.ts` — unit tests, offline.

## Local

```sh
cd supabase/functions/regal-export && deno task test        # unit tests, offline
# against the local stack, from the repo root (the env file outside the repo, never a dotenv in it):
printf 'REGAL_EXPORT_TOKEN=%s\nREGAL_OWNER_EMAIL=dev@libellus.local\nREGAL_OWNER_NAME=Fabian\n' "$(openssl rand -hex 32)" > /tmp/regal-export.env
supabase functions serve regal-export --env-file /tmp/regal-export.env
curl -fsS -H "Authorization: Bearer <the token>" http://127.0.0.1:55321/functions/v1/regal-export -o /tmp/library.json
```

Then, in a Regal checkout, `pnpm regal-assets --in /tmp/library.json --no-ai --no-model --dry-run --publish v2`
shows what a run would publish; never `--publish` without `--dry-run` from a local stack.

## Deploy

```sh
supabase functions deploy regal-export --use-api     # bundles ../../../web/app/data/export/*.ts with it
```

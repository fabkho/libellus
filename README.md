# Libellus

A mobile-first book tracker, installable from the home screen: search a book → **Want to read** →
**Currently reading** → **Finished** with a date, a quarter-star rating and a few words. Built web
first on Nuxt and Supabase, with the docs that make a later Swift/Kotlin port mechanical.

Spec: [SPEC.md](SPEC.md) (condensed) and issue [#1](https://github.com/fabkho/libellus/issues/1)
(full). Domain words: [CONTEXT.md](CONTEXT.md).

## Running it locally

Needs Docker (for the local Supabase stack), Node 24, pnpm and the Supabase CLI.

```sh
supabase start                     # in the repo root: Postgres, Auth, Studio, Mailpit on 553xx
cd web
cp .env.example .env               # paste the anon key `supabase start` printed
pnpm install
pnpm dev                           # http://localhost:3020, best in a phone-sized viewport
```

The libellus stack has its own project id and ports (55320–55329), so it runs next to other local
Supabase stacks (Trappist's on 5432x) without touching them. Stop only this one with `supabase stop`
from the repo root — never `supabase stop --all`.

Dependency build scripts pnpm 11+ may run (esbuild) are approved in the committed
`web/pnpm-workspace.yaml`; local and CI both use pnpm 12.

Tests, from `web/` (with the stack running):

```sh
pnpm test                          # Vitest: data layer against the local stack, no mocks
pnpm exec playwright install webkit # once
pnpm e2e                           # Playwright: iPhone viewport in WebKit, own server on :4327 (LIBELLUS_E2E_PORT moves it)
supabase test db                   # pgTAP, from the repo root
```

The Vitest suite reads the anon key from `supabase status` unless `SUPABASE_ANON_KEY` is set, reads
six-digit codes out of Mailpit, and tags its fixtures per run: it only ever deletes what its own run
created.

The Playwright flows (`web/e2e`) never call a live API: Apple and OpenLibrary answer from the recordings in
`web/tests/fixtures`, and a fixture fails any test that reaches another host or shows a control without a
`data-testid`. `e2e/core-loop.spec.ts` is the smoke flow of the whole loop (sign in, search, add, start,
finish with a rating and a review, counted on Home and under Finished). On a pull request they run as the
`e2e` CI job against a fresh local stack, with one retry, split into three shards that run side by side; a failed
run uploads one merged HTML report with the traces (artifact `playwright-report`; open it with
`pnpm exec playwright show-report`). Locally a failure is not
retried, so a flaky flow is seen.

What a desktop browser cannot show — the system bars, the browser's toolbar, the real keyboard — is
checked on a real Android emulator running Chrome: `web/e2e/android/smoke.ts`, not part of CI; how to
set it up and run it is in [`docs/TESTING.md`](docs/TESTING.md).

`pnpm build` (or `pnpm generate`) runs `nuxt generate`; `.output/public` (also linked as `dist`) is
what Cloudflare Pages serves, service worker and manifest included.

### Design tokens

`design/tokens.json` is the single source for colours, spacing, radii, type and durations. After
editing it:

```sh
cd design && pnpm install && pnpm tokens   # rewrites the generated files
pnpm tokens:check                          # fails if a generated file differs from tokens.json
```

`pnpm tokens` writes `web/app/assets/css/tokens.generated.css` (a Tailwind v4 `@theme`) and
`design/generated/Tokens.generated.swift`, each with a light and a dark theme. Never edit the
generated files; CI checks they match. The values are direction D "Night Reader" from the design
round (#4); docs/DESIGN.md says what each token is for.

### Signing in locally

Libellus is invite-only, and `supabase start` / `supabase db reset` seed what local work needs:

| What | Value |
| --- | --- |
| Invite code | `LIBELLUS-DEV` (1000 uses, never expires; `supabase db reset` puts them back) |
| Dev member | `dev@libellus.local`, already confirmed |

Sign in as the dev member: type the address, then the six-digit code from the local mailbox
(http://127.0.0.1:55324). Or sign up with any other address and `LIBELLUS-DEV`. Addresses ending in
`@libellus.test` belong to the test suites, which delete them.

An invite is spent when the new member proves their address (the code from the mail), not when the
mail is requested, so a mistyped address costs nothing. Addresses that never prove themselves are
removed after a day.

#### Creating invite codes

```sh
scripts/create-invite-code.sh                            # one use, 14 days, a random code like K7QM-X2PA
scripts/create-invite-code.sh --uses 5 --days 30 --label "Anna and friends"
scripts/create-invite-code.sh --days 0 --code HELLO-BOOKS   # never expires, a code of your choosing
```

It prints the code. The script calls `public.create_invite_code` through the REST API with the
service-role key, which only the owner holds: locally it asks `supabase status`; against a hosted
project export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` first. Never put that key in `web/.env`.
Members cannot read, create or change invite codes (RLS and revoked grants, covered by pgTAP).

#### The Fable import and the dev seed

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

#### Feeding Regal

[Regal](https://github.com/fabkho/regal), the owner's 3D bookshelf on fabkho.dev/books, reads one
file: a [Regal library file](https://github.com/fabkho/regal/blob/main/docs/library-file.md)
(version 2). Libellus writes it from a member's Library with `web/scripts/export-regal.ts` (#22),
read only: one Book per Library entry (the edition's id as its id), the Status from the latest
Reading session (`read`, `dnf`, `currently-reading`, `to-read`), the date read, Rating and review
from the last finished read, the read count, ISBN, pages, publisher, blurb, the Cover URL and a
palette from the Cover's colours. The mapping is `web/app/data/export/regal.ts` (pure, pinned by a
fixture); the file is checked with Regal's validator, vendored in
`web/app/data/export/regalLibraryFile.ts` with the Regal commit it came from (run the tests with
`REGAL_DIR=<regal checkout>` to compare it with Regal's own). Want to read stays out unless
`--statuses` asks for it. Libellus has no series, binding or Spine art: Regal assets fills what it
can.

The daily chain, run by the owner's job (hosted Libellus, never `--publish` by hand while testing):

```sh
# 1. Libellus → library file, keeping the art Regal shows now (hosted, read only)
cd web
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm export:regal --target hosted --confirm-host <project host> \
  --email <owner> --owner Fabian --carry-art https://books.fabkho.dev/v2/library.json \
  --out ../.data/regal/library-v2.json
# 2. in a Regal checkout: Spines, backs, pile copies and colours, then publish under v2/
pnpm regal-assets --in <libellus>/.data/regal/library-v2.json --no-ai --no-model --revalidate --publish v2
```

`--carry-art` takes the file that is published now: every exported Book it has (by ISBN-13, else by
title and first author's surname, so a Book whose edition changed in Libellus still finds it) keeps
its published front, Spine, back and colours, so the portfolio's paid AI art survives; a Book it does
not have gets the Libellus Cover, and Regal draws its Spine and back (or `regal-assets` without
`--no-ai` makes them). Published art sticks: a matched Book keeps it when its Libellus Cover changes.
The export is deterministic and is not rewritten when only `generatedAt` would change, so Regal
assets finds every Book in its cache and uploads nothing on a quiet day. `pnpm export:regal --help`
lists the options (`--statuses`, `--time-zone`, `--generated-at`).

### Local services

Studio at http://127.0.0.1:55323, the local mailbox (sign-in codes) at http://127.0.0.1:55324.

## Layout

```
web/          Nuxt 4 SPA + PWA — the reference app (rules: web/AGENTS.md)
  app/data/     framework-free repositories and the Supabase client factory
  i18n/locales/ en.json, every string the UI shows
  tests/        Vitest data-layer suite against the local stack
  e2e/          Playwright flows, iPhone viewport in WebKit
  scripts/      import-fable.ts, the Fable import and dev seed (web/scripts/fable/); export-regal.ts,
                the Regal library file (web/app/data/export/)
scripts/      create-invite-code.sh, the owner's tool for minting invite codes
design/       tokens.json + the Style Dictionary build (Tailwind theme CSS, Swift)
supabase/     config (ports 553xx, email template), migrations, seed, pgTAP tests
docs/         DESIGN.md (design guideline), MOTION.md (motion), parity.md (per-screen behaviour),
              agents/ (how agents use the issue tracker)
SPEC.md       condensed spec; CONTEXT.md the domain glossary
```

CI (`.github/workflows/ci.yml`) runs on every pull request: pgTAP and the Vitest data layer against a
local stack, the Playwright flows in WebKit (its own job), `nuxt generate`, and the generated-tokens check.

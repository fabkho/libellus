# Developing Libellus

How to run, test and change Libellus on your machine. What it is and how to host your own:
[README](../README.md) and [SELF_HOSTING.md](SELF_HOSTING.md). Rules for code changes:
[web/AGENTS.md](../web/AGENTS.md); domain words: [CONTEXT.md](../CONTEXT.md).

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
`e2e` CI job against a fresh local stack, with one retry, split into two shards that run side by side (docs/TESTING.md, "CI: what runs when"); a failed
run uploads one merged HTML report with the traces (artifact `playwright-report`; open it with
`pnpm exec playwright show-report`). Locally a failure is not
retried, so a flaky flow is seen.

What a desktop browser cannot show — the system bars, the browser's toolbar, the real keyboard — is
checked on a real Android emulator running Chrome: `web/e2e/android/smoke.ts`, not part of CI; how to
set it up and run it is in [`docs/TESTING.md`](TESTING.md).

`pnpm build` (or `pnpm generate`) runs `nuxt generate`; `.output/public` (also linked as `dist`) is
what Cloudflare Pages serves, service worker and manifest included.

### Regal, the owner's shelf (optional)

Regal is the owner's 3D bookshelf, a Nuxt layer in a private repository. It is opt-in: without
`LIBELLUS_REGAL=1` the app builds, runs and tests without it, the shelf's places stay empty and
`e2e/shelf.spec.ts` skips. CI builds both ways. With access to it:

```sh
export LIBELLUS_REGAL=1
export REGAL_LAYER=/path/to/regal                       # or GIGET_AUTH=<a token that can read fabkho/regal>
export NUXT_PUBLIC_REGAL_LIBRARY_SRC=https://…/v2/library.json
export NUXT_PUBLIC_SHELF_OWNER_ID=<the auth user id who sees it>
pnpm dev
```

With the flag set and the layer or the library file missing, `dev` and `generate` stop and say so.

### README screenshots

`docs/images/*.jpg` come from the running app, never by hand: with the stack and a dev server up,
`LIBELLUS_SHOTS_URL=http://localhost:3020 pnpm exec tsx scripts/readme-shots.ts` (from `web/`) makes a
throwaway member with a few classics, shoots Home, Library, a Book and the Profile at iPhone size in
light and dark, composes `hero.jpg`, and removes the member and her Books again.

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

### Local services

Studio at http://127.0.0.1:55323, the local mailbox (sign-in codes) at http://127.0.0.1:55324.

## Layout

```
web/          Nuxt 4 SPA + PWA — the reference app (rules: web/AGENTS.md)
  app/data/     framework-free repositories and the Supabase client factory
  i18n/locales/ en.json, every string the UI shows
  tests/        Vitest data-layer suite against the local stack
  e2e/          Playwright flows, iPhone viewport in WebKit
  scripts/      readme-shots.ts (the README's screenshots); import-fable.ts and export-regal.ts are
                the owner's (docs/OWNER.md)
  regal.config.ts  the optional Regal layer (LIBELLUS_REGAL=1)
scripts/      create-invite-code.sh, the operator's tool for minting invite codes
design/       tokens.json + the Style Dictionary build (Tailwind theme CSS, Swift)
supabase/     config (ports 553xx, email template), migrations, seed, pgTAP tests, edge functions
docs/         SELF_HOSTING.md, DEVELOPMENT.md (this), TESTING.md, DESIGN.md (design guideline),
              MOTION.md (motion), parity.md (per-screen behaviour), covers.md, OWNER.md (the owner's
              instance only), agents/ (how agents use the issue tracker)
SPEC.md       condensed spec; CONTEXT.md the domain glossary
```

CI (`.github/workflows/ci.yml`) runs on pull requests, for the paths they change: pgTAP and the Vitest data layer
against a local stack, the Playwright flows in WebKit (same job, sharded), `nuxt generate`, and the
generated-tokens check. A push to `main` runs the cheap checks only, docs-only changes run nothing
(docs/TESTING.md, "CI: what runs when").

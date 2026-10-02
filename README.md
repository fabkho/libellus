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
pnpm e2e                           # Playwright: iPhone viewport in WebKit, own server on :4327
supabase test db                   # pgTAP, from the repo root
```

The Vitest suite reads the anon key from `supabase status` unless `SUPABASE_ANON_KEY` is set, reads
six-digit codes out of Mailpit, and tags its fixtures per run: it only ever deletes what its own run
created.

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

### Local services

Studio at http://127.0.0.1:55323, the local mailbox (sign-in codes) at http://127.0.0.1:55324.

## Layout

```
web/          Nuxt 4 SPA + PWA — the reference app (rules: web/AGENTS.md)
  app/data/     framework-free repositories and the Supabase client factory
  i18n/locales/ en.json, every string the UI shows
  tests/        Vitest data-layer suite against the local stack
  e2e/          Playwright flows, iPhone viewport in WebKit
scripts/      create-invite-code.sh, the owner's tool for minting invite codes
design/       tokens.json + the Style Dictionary build (Tailwind theme CSS, Swift)
supabase/     config (ports 553xx, email template), migrations, seed, pgTAP tests
docs/         DESIGN.md (design guideline), MOTION.md (motion), parity.md (per-screen behaviour),
              agents/ (how agents use the issue tracker)
SPEC.md       condensed spec; CONTEXT.md the domain glossary
```

CI (`.github/workflows/ci.yml`) runs on every pull request: pgTAP and the Vitest data layer against a
local stack, `nuxt generate`, and the generated-tokens check.

# Developing Libellus

How to run, test and change Libellus on your machine. What it is and how the owner's instance is set
up: [README](../README.md) and [SETUP.md](SETUP.md). Rules for code changes:
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
finish with a rating and a review, counted on Home and under Finished). CI runs them
in a release (`release.yml`, before the deploy), on a pull request labelled `full-e2e` and by hand (`e2e.yml`), against a fresh local stack, with one retry, sharded (docs/TESTING.md, "CI: what runs when"); a failed
run uploads one merged HTML report with the traces (artifact `playwright-report`; open it with
`pnpm exec playwright show-report`). Locally a failure is not
retried, so a flaky flow is seen.

What a desktop browser cannot show — the system bars, the browser's toolbar, the real keyboard — is
checked on a real Android emulator running Chrome: `web/e2e/android/smoke.ts`, not part of CI; how to
set it up and run it is in [`docs/TESTING.md`](TESTING.md).

`pnpm build` (or `pnpm generate`) runs `nuxt generate`; `.output/public` (also linked as `dist`) is
what Cloudflare Pages serves, service worker and manifest included.

### Performance (`web/perf`)

`pnpm perf` measures the production build the way a phone meets it (Slow 4G and a 4x CPU in Chromium,
WebKit as it is, cold and warm starts, tab switches, a Book, the search palette, the Profile) against a
library of the owner's size; `pnpm perf:bundle` reads what the build ships. It runs on a stack of its own
(ports 55671–55679) and one listener on :3101, never the shared one. How to run it, what it fakes, and
the Android and iOS device sessions: [`web/perf/README.md`](../web/perf/README.md); what it found:
[`docs/perf/`](perf/).

### Regal, the owner's shelf (optional)

Regal is the owner's 3D bookshelf, a Nuxt layer in its own repository (fabkho/regal). It is opt-in: without
`LIBELLUS_REGAL=1` the app builds, runs and tests without it, the shelf's places stay empty.
CI builds both ways. With access to it:

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

### Emails

The sign-in code's mail (`supabase/templates/magic_link.html`) wears the same tokens, but a mail
client is not a browser, so the file is **generated**: `design/emails/` holds the shell every Libellus
mail shares (`shell.mjs`: wordmark, card, footer, the light colours inlined, the dark-mode block, the
type and spacing from `tokens.json`) and what each mail says (`magic_link.mjs`). `design/emails.mjs`
writes the result, and CI fails when it differs from the committed file, as it does for the tokens.

```sh
cd design && pnpm emails            # rewrites supabase/templates/*.html from tokens.json and design/emails/
pnpm emails:check                   # fails if a committed template is stale (CI runs it)
cd ../web && pnpm email:preview     # renders each template with a sample code and screenshots it,
                                    # phone and desktop width, light and dark → web/.email-preview/ (gitignored)
```

Edit the shell or a mail's copy, never the HTML. The build also checks the mail: 4.5:1 for every
text colour in both schemes, no image, font, link or script to fetch, a `lang`, a `<title>`, the
dark block, under 20 KB (Gmail clips at about 102 KB), and what the mail's file says it must or must
not contain (`{{ .Token }}` yes, `{{ .ConfirmationURL }}` no). The preview shows Chromium's
rendering and its `prefers-color-scheme: dark`, the way Apple Mail applies it; Gmail's and Outlook's
own engines are not here (Mailpit's *Checks* tab, at http://127.0.0.1:55324, scores a received mail
against the clients' CSS support).

**The waitlist invite** (`design/emails/invite.mjs`) is the second mail on the shell. The
`waitlist-invite` edge function sends it, not Supabase Auth, so it says `format = 'module'`: the
generator writes `supabase/functions/waitlist-invite/invite_mail.generated.mjs` (the HTML and a
plain-text part, `text()`, as strings) for the function to import, with its own placeholders
(`{{ .Code }}`, `{{ .ExpiresOn }}`, `{{ .SignUpUrl }}`) that the function fills in, HTML-escaped, and
an optional block (`<!--[link]-->…<!--[/link]-->`, the Sign up button) it drops without a site URL.
Its code is nine characters with a dash, so it passes `kit.code` a smaller size to stay on one line at
phone width; `kit.button` is the app's primary button as a link. The preview shows it with and without
the link.

**Another email** reuses the shell the same way: add `design/emails/<name>.mjs` exporting
`output` (where the file goes), `build(kit)` (`kit.render({ title, preheader, content, footer })`,
with `kit.eyebrow`, `kit.paragraph`, `kit.code` for the card's inside, and `kit.x(paintClasses, css)`
for anything of your own: a paint class is a colour role, inlined for light and overridden in the
dark block, so there is no colour to type), optionally `sample` (what the preview puts in for each
template variable), `requires`, `forbids` and `allowLinks` (the lint refuses links by default).
List it in `design/emails.mjs`, run `pnpm emails`. A new component (a button, a link style) goes
into `shell.mjs` next to `code`, with its colours as paint classes.

Supabase's local Auth reads the templates when the stack starts, so after changing one run
`supabase stop && supabase start` and request a code to see it in the local mailbox.

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

Studio at http://127.0.0.1:55323, the local mailbox (sign-in codes, in the designed mail) at http://127.0.0.1:55324.

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
design/       tokens.json + the Style Dictionary build (Tailwind theme CSS, Swift); emails/ + emails.mjs, the mail shell and
              the generated supabase/templates
supabase/     config (ports 553xx, email template), migrations, seed, pgTAP tests, edge functions
docs/         SETUP.md, DEVELOPMENT.md (this), TESTING.md, DESIGN.md (design guideline),
              MOTION.md (motion), parity.md (per-screen behaviour), covers.md, OWNER.md (the owner's
              instance only), agents/ (how agents use the issue tracker)
SPEC.md       condensed spec; CONTEXT.md the domain glossary
```

CI (`.github/workflows/ci.yml`) runs on pull requests, for the paths they change: pgTAP and the Vitest data layer
against a local stack, `nuxt generate`, and the generated-tokens and generated-emails checks. A push to `main` runs
the same checks; docs-only changes run nothing. The Playwright flows run in the release run, or on a pull request
labelled `full-e2e` (docs/TESTING.md, "CI: what runs when").

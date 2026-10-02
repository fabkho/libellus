# Web app — rules for agents

Nuxt 4 SPA (`ssr: false`), Vue 3 `<script setup>`, TypeScript, Tailwind v4, Pinia, `@nuxtjs/i18n`.
This app is the reference for every platform (SPEC.md): what it does is what a native port will copy,
so keep its behaviour explicit and its layers clean. Domain words: `../CONTEXT.md`.

## Commands (from `web/`)
- `pnpm dev` — http://localhost:3020. Needs `.env` (copy `.env.example`) and `supabase start` in the
  repo root (the libellus stack, ports 553xx).
- `pnpm test` — Vitest data-layer suite against the local stack. No mocks.
- `pnpm e2e` — Playwright, iPhone viewport, WebKit, its own server on :4327.
- `pnpm build` / `pnpm generate` — `nuxt generate` to `.output/public`.
- No full typechecks (`nuxi typecheck`, `tsc --noEmit`) unless asked. Run the targeted test instead.
- Never read `.env`. Pass `NUXT_PUBLIC_*` as exported env vars when a command needs them.

## Architecture
- **Page → Pinia store → repository in `app/data/` → client.** Pages and components render state and
  forward actions; stores hold view state and call repositories; repositories hold all data access
  and the client-side domain rules.
- `app/data/` is framework-free TypeScript: no Vue, no Nuxt, no auto-imports. Repositories receive the
  Supabase client (`createSupabaseClient`, handed out by `useBackend()`) and anything else they talk to
  (`fetch` for search) as arguments, so Vitest drives them in plain Node and a native port
  reimplements them 1:1.
- No Supabase calls in pages, components or stores — only through a repository.
- Rules live in the database (constraints, triggers, RPC, RLS), never only in the client. Every
  multi-row change is one RPC, so a native client calls the same function.

## UI
- Mobile first: tab bar, bottom sheets, 44px touch targets (`--size-touch`), `env(safe-area-inset-*)`
  through the `screen-inset` utility. Designed for the phone; on wider screens the same layout sits in
  a centred column and must still look finished. No separate desktop layouts in v1.
- Colours, spacing, radii, type: only Tailwind utilities from the generated theme (`bg-surface`,
  `px-md`, `rounded-md`, `text-body`, `text-ink-muted`). Never hex values, raw colours or arbitrary
  px in components. Tokens come from `design/tokens.json` (`cd design && pnpm tokens`); never edit
  `tokens.generated.css`.
- Every interactive element (and every element a test reads) gets `data-testid="<screen>.<element>"`
  (`start.title`, `search.query`, `book.finish`). It is the native accessibility identifier too, so
  name it for what it is, not how it looks.
- All copy goes through the message file `i18n/locales/en.json` (`t('home.empty')` / `$t(...)`):
  labels, errors, placeholders, `aria-label`s, the document title. No hard-coded strings in
  templates or stores. Keys are `<screen>.<thing>`.

## Testing seams
- Database rules: pgTAP in `../supabase/tests/`, acting as a real signed-in member.
- Data layer: Vitest in `tests/`, through the repositories against the local stack. Fixtures come from
  `tests/support/stack.ts` and carry the run tag (`uniqueEmail`), so a run only cleans up its own data.
- Search: recorded responses through the injectable `fetch`; never call live external APIs in tests.
- User flows: Playwright in `e2e/`, found by `getByTestId`, copy compared against `en.json`.
- No component snapshots, no tests of internal state shapes.

## Definition of done for a screen
1. Works against the local stack on a phone viewport.
2. Data behaviour covered in `tests/` where it touches Supabase.
3. A Playwright flow in `e2e/`.
4. Entry in `../docs/parity.md`: states, actions, copy keys, test IDs, the Playwright flow.

## Gotchas
- Tailwind v4 only rescans sources when CSS changes. After adding classes in a component, run
  `touch app/assets/css/main.css` or the new utilities are missing in dev.
- pnpm 11+ fails an install on dependency build scripts nobody approved (`ERR_PNPM_IGNORED_BUILDS`).
  Approvals live in the committed `pnpm-workspace.yaml` (`allowBuilds`; pnpm reads it only there, not
  from `package.json`). When a new dependency needs one, `pnpm add` writes a stub
  (`<pkg>: set this to true or false`): decide `true` or `false`, never commit the stub as is.
  Local and CI both use pnpm 12.
- Install packages with `pnpm add <pkg>@latest`.
- The local stack is libellus' own (`project_id = "libellus"`, ports 553xx). Never `supabase stop
  --all` and never reset another project's database.
- `web/dist` is a symlink to `.output/public` created by `nuxt generate`.

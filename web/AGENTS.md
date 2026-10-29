# Web app — rules for agents

Nuxt 4 SPA (`ssr: false`), Vue 3 `<script setup>`, TypeScript, Tailwind v4, Pinia, `@nuxtjs/i18n`.
This app is the reference for every platform (SPEC.md): what it does is what a native port will copy,
so keep its behaviour explicit and its layers clean. Domain words: `../CONTEXT.md`.

## Commands (from `web/`)
- `pnpm dev` — http://localhost:3020. Needs `.env` (copy `.env.example`) and `supabase start` in the
  repo root (the libellus stack, ports 553xx).
- `pnpm test` — Vitest data-layer suite against the local stack. No mocks.
- `pnpm e2e` — Playwright, iPhone viewport, WebKit, Reduce Motion on, on the static build served
  like Pages (`e2e/build.ts` + `e2e/serve.mjs`, :4327). `LIBELLUS_E2E_DEV=1` runs it on `nuxt dev`.
- `pnpm build` / `pnpm generate` — `nuxt generate` to `.output/public`.
- `pnpm perf` — the client performance harness (production build, throttled Chromium and WebKit, scripted
  journeys, a table): `perf/README.md`; findings in `../docs/perf/`. Needs its own throwaway stack, never the shared one.
- **The shared UI base** (fabkho/ui, a Nuxt layer; `@fabkho/ui` pinned to a tag in `package.json`, never a branch) is
  the app's UI kit. Its components, props, slots, states and accessibility are documented in Storybook
  (https://fabkho.github.io/ui/) and its README (`node_modules/@fabkho/ui/README.md`). Look there before writing a
  component. The app takes from the base everything with the base's name; nothing of the app replaces it
  (`tests/ui-layer-shadow.test.ts`; the allow-list of intended overrides, `tests/ui-layer-overrides.test.ts`, is empty).
  - `UI_LAYER=/path/to/ui-checkout` points the app at a local checkout (`ui.config.ts`; `#layers/ui`, which `main.css`
    imports its stylesheet by, and the Vitest alias follow it).
  - `ui.config.ts` says which of the base's plugins run (`touch-active`, `stranded-viewport`) and why `no-focus-zoom`
    is held.
  - App-set values live in `app/app.config.ts`: `ui.text` (words set from the messages by `plugins/ui-text.ts`; a word
    the base adds needs a line in `utils/uiText.ts`, `tests/ui-text.test.ts`; a variable it reads needs a token,
    `tests/ui-layer.test.ts`), `ui.icons` (BetterReads' own drawings of `people`, `heart`, `external`), `ui.cover`
    (sources and artwork) and `ui.ambient.grain: 'inline'` (the grain as an inline SVG, not a `background-image`, which
    Chrome counts as the LCP element: `../docs/perf/client-1-startup.md` F-12).
  - Cover helpers, motion and cover-tilt utils, keyboard, haptics, hide-on-scroll and swipe-down come from the base
    (`#layers/ui/app/utils/motion`, so the app's flights and a leaning cover share one `addMover` list). Do not copy them.
  - Bottom chrome of the app's own (reader bars, toasts, import status) subtracts `--viewport-pan` from its `bottom`
    (`stranded-viewport`, `tests/viewport-pan.test.ts`); use `float-bottom` or `screen-bottom` for a new one.
  - A link that flies a cover (`UiPressLink` to a book page) gets the flight from the app: `v-on="flightOf(path)"`
    (`composables/useBookFlight.ts`).
- **Portable by default** (rules: the base README): a component that could ever be generic is written so it moves to
  the base by copying the file. A presentational component holds no app state (no `~/stores`, Pinia, Supabase or i18n
  calls: data and copy come in by props, slots or `ui.text`); pure helpers are fine, `~/utils` and `~/composables` that touch app
  state stay in the app; role names, not domain names; tokens only; one component, one file.
- **Regal** (the owner's shelf, #23; `regal.config.ts`), a Nuxt layer from the private repo
  fabkho/regal, is opt-in: `LIBELLUS_REGAL=1` plus `REGAL_LAYER=/path/to/regal-checkout` or
  `GIGET_AUTH=<a GitHub token that can read it>` (CI and Cloudflare Pages have the secret) and
  `NUXT_PUBLIC_REGAL_LIBRARY_SRC` (the published library file). Without the flag `dev`, `e2e` and
  `build` run without it: `ShelfStage`/`ShelfRow` resolve to `app/regal/Absent.vue`, nobody is the
  shelf's owner. With it, a missing layer or file stops `dev`/`generate`.
  Regal stays in its own chunks (`regal-reel`: the reel of "You both read", three.js and what they draw with, which a friend's page fetches alone, and the feed and People fetch ahead on idle; `regal`: only the shelf's Stack, Row and Bookcase), loaded only by `LazyShelfStage`, `LazyShelfRow` and `LazyFriendsBothReadReel` and never precached; the
  build fails if the entry ever imports it.
  The ebook reader (`components/reader`, foliate-js, DOMPurify) is the `ebook-reader*` chunks, also never
  precached (`globIgnores`): `data/reader/prefetch.ts` says when they are fetched ahead (a member with an
  ebook on this device, online, no Save-Data), a CacheFirst rule keeps them. Keep the group's modules apart
  from the two files imported dynamically (nuxt.config.ts says why), and a prefetch trigger behind `prefetchReader`.
- **Mobile first: VoiceOver, touch and gestures before desktop/keyboard** (every swipe, drag and long press has a single-tap alternative; text at 200 % reflows).
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
  `tokens.generated.css`. Tailwind's default palette, radii, shadows and type scale are switched off.
- The design system is direction D "Night Reader": `../docs/DESIGN.md` (token roles, type,
  components, the theme rule) and `../docs/MOTION.md`. Build screens from the base components in
  `app/components/ui/` (`UiButton`, `UiSheet`, `UiCover`, `UiStars`, `UiRow`, …; the base's, except the domain ones: see above) and the shell in
  `app/components/shell/`. Every token has a light and a dark value, so a component never branches
  on the theme and never uses `dark:` variants. Book titles are `book-title` (serif); dates and
  figures `figures` (mono).
- Accessibility (`../docs/ACCESSIBILITY.md`): WCAG 2.2 AA in both themes. Text only in the text
  tokens (`ink`, `inkMuted`, `inkFaint`, `accentInk`, `error`; never `inkGhost`), a name from
  `en.json` on every icon button, a cover `decorative` where its title is beside it, one `h1` a
  page, a polite status for what comes and goes. A screen or sheet on a critical path (below) gets an
  `expectAccessible` scan in `e2e/a11y.spec.ts`, in one theme, dark (the design's own room); colours
  come from tokens that `../docs/ACCESSIBILITY.md` already checks in both themes. `pnpm dev` shows
  axe's findings in the DevTools' Nuxt a11y tab.
- Every interactive element (and every element a test reads) gets `data-testid="<screen>.<element>"`
  (`start.title`, `search.query`, `book.finish`). It is the native accessibility identifier too, so
  name it for what it is, not how it looks.
- Offline (#15): every action that writes is disabled and says "Offline" while `useOnline()` is false
  (`<UiButton :offline="!online">`, or `:disabled` plus `common.offline` on other controls), and its
  repository refuses it anyway (`{ online: isOnline }`, error `offline`). A new write gets both.
- All copy goes through the message file `i18n/locales/en.json` (`t('home.empty')` / `$t(...)`):
  labels, errors, placeholders, `aria-label`s, the document title. No hard-coded strings in
  templates or stores. Keys are `<screen>.<thing>`.
- Two languages, English and German (issue #257, `docs/i18n/README.md`): a new string is a key in `en.json`
  and gets its German with `pnpm i18n:translate` (it translates only the keys `de.json` lacks; read the
  diff, commit both files and `.i18n-kit.lock.json`). The parity test fails on a missing or extra key or a
  changed `{placeholder}`, `|` form or `@:link`. German is up to half as long again: a label must still fit
  at 360 px (`LIBELLUS_E2E_GERMAN=1 pnpm exec playwright test e2e/i18n` shows what does not). Dates, numbers
  and relative times go through `Intl` with the active locale (`utils/intl.ts`), never a hard-coded
  English format; the order and punctuation around them are copy (`{day}. {month}` in German). The app
  language is chosen by `utils/locale.ts` (the phone's, or the member's choice on the Profile): never read
  `navigator.language` for what is shown.

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
3. A Playwright flow in `e2e/` only for a critical path: getting in (sign up with an invite code, the
   six-digit code, sign in, sign out); the core loop (search → add → start → update progress →
   finish); offline (the app opens offline on its kept Library, changes made offline sync later);
   what leaves the app (the public reading page, a Book card, the waitlist form); deleting the
   account; and, when it lands, the social loop. Everything else is tested where it is cheapest:
   rules in pgTAP (`../supabase/tests/`), logic in Vitest (`tests/`: pure functions, repositories
   against the local stack). Motion and visual polish are not tested end to end.
4. Entry in `../docs/parity.md`: states, actions, copy keys, test IDs, the Playwright flow.

## Gotchas
- Realtime: the app's Supabase client is built with `@supabase/realtime-js` aliased to a stub (`app/data/realtimeStub.ts`, bundle size). The import job's live feed
  (`data/importJobFeed.ts`) is the one place that loads the real client, as `import('#realtime-client')` (`realtime.config.ts`: its own `realtime` chunk, not precached), only while
  a job of hers is live. A new Realtime use goes through that door, never through `client.channel()` (the stub throws); keep it lazy and off the entry.
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

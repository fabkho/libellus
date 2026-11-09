# Web app — rules for agents

Nuxt 4 SPA (`ssr: false`), Vue 3 `<script setup>`, TypeScript, Tailwind v4, Pinia, `@nuxtjs/i18n`.
This app is the reference for every platform (SPEC.md): what it does is what a native port will copy,
so keep its behaviour explicit and its layers clean. Domain words: `../CONTEXT.md`.

## Commands (from `web/`)
- `pnpm dev` — http://localhost:3020. Needs `.env` (copy `.env.example`) and `supabase start` in the
  repo root (the libellus stack, ports 553xx).
- `pnpm test` — Vitest data-layer suite against the local stack. No mocks.
- `pnpm schema:snapshot` — regenerates `../supabase/schema-snapshot/`, the current definition of every
  database object, from the local stack (up and migrated; one catalog query, about 1 s). Run it after a
  migration and commit the result with it: CI fails on a stale snapshot. The files there are generated,
  read-only, one per object; never edit one by hand (`../docs/TESTING.md`, "The schema snapshot").
- **Never edit an applied migration** (`../supabase/migrations/`): `supabase db push` has recorded its version
  and never reads the file again, so the edit reaches the local and CI stacks only and production keeps the old
  definition. Write a new migration that corrects it; `ci.yml` fails a pull request that does anything but add
  a file there.
- `pnpm e2e` — Playwright, iPhone viewport, WebKit, Reduce Motion on, on the static build served
  like Pages (`e2e/build.ts` + `e2e/serve.mjs`, :4327). `LIBELLUS_E2E_DEV=1` runs it on `nuxt dev`.
- `pnpm build` / `pnpm generate` — `nuxt generate` to `.output/public`.
- `pnpm perf` — the client performance harness (production build, throttled Chromium and WebKit, scripted
  journeys, a table): `perf/README.md`; findings in `../docs/perf/`. Needs its own throwaway stack, never the shared one.
- Sentry (`plugins/sentry.client.ts`, `utils/sentry*.ts`, `utils/uiFrozen.ts`): off without `NUXT_PUBLIC_SENTRY_DSN`; its SDK stays in the lazy `sentry.<hash>.js` chunk, out of the precache. Anything new that can reach an event goes through `scrubEvent` and, if it adds data, into the privacy notice (docs/OPERATIONS.md, "Sentry").
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
    the base adds needs a line in `utils/uiText.ts` (and its blank, `{count}` or `{name}`, a name in `UI_TEXT_BLANKS`: vue-i18n turns a blank it is
    given no value for into nothing), `tests/ui-text.test.ts`; a variable it reads needs a token,
    `tests/ui-layer.test.ts`), `ui.icons` (BetterReads' own drawings of `people`, `heart`, `external`), `ui.cover`
    (sources and artwork) and `ui.ambient.grain: 'inline'` (the grain as an inline SVG, not a `background-image`, which
    Chrome counts as the LCP element: `../docs/perf/client-1-startup.md` F-12).
  - Cover helpers, motion and cover-tilt utils, keyboard, haptics, hide-on-scroll and swipe-down come from the base
    (`#layers/ui/app/utils/motion`, so the app's flights and a leaning cover share one `addMover` list). Do not copy them.
  - Bottom chrome of the app's own (reader bars, toasts, import status) subtracts `--viewport-pan` from its `bottom`
    (`stranded-viewport`, `tests/viewport-pan.test.ts`); use `float-bottom` or `screen-bottom` for a new one.
  - A link that flies a cover (`UiPressLink` to a book page) gets the flight from the app: `v-on="flightOf(path)"`
    (`composables/useBookFlight.ts`).
  - A link to a Book page that may open a Book the device has not read yet (a friend's tile, a work of a series) hands the
    page what the card shows on the touch-down: `@press="books.prefetch(book.id, book)"`, or `rememberPreview(key, ...)`
    (`utils/bookPreview.ts`), so the page's hero is drawn in the first frame and the rest waits in placeholders of its size
    (docs/MOTION.md, "A book opens at once"). A Book in her Library needs none.
- **The shared chat package** (fabkho/chat, a Nuxt layer of chat logic; `@fabkho/chat` pinned to a tag in `package.json`,
  never a branch; its README: `node_modules/@fabkho/chat/README.md`) is the send queue, threads and chapters, the chapter
  veil, photo and GIF helpers and a Realtime core, framework-free behind an adapter. Taken in `chat.config.ts`
  (`extends`, the last layer; `CHAT_LAYER=/path/to/chat-checkout` points at a local checkout, and `#layers/chat`, which
  the Vitest alias follows, too); `tests/chat-layer.test.ts` keeps it registered once and the app's names the app's.
  - Its rules: **no words** (it returns codes and state; the app's components word them in the message files), **no app
    imports** (nothing of `~`, stores or `#imports` goes in; the app's side stays in `app/`), **no Supabase and no
    `@supabase/realtime-js`**: the app provides the adapter (`ChatAdapter`, `RealtimeLike`) in `app/data/`, and the
    Realtime client it gives is the lazy `import('#realtime-client')` door below, never the stub. A fix to the layer is
    a release of fabkho/chat and a bump here (`docs/DEVELOPMENT.md`, "The package bumps"), not an edit under `node_modules`.
  - Its first user is the buddy read (`data/buddyReads.ts`, `data/buddyLive.ts`, `stores/buddyRead.ts`): the store is imported only by
    buddy read screens, which `retain()` the live channel (the real client loads lazily through the store's
    `import('#realtime-client')`; Home and the Book page read `my_buddy_reads()` through the small store `stores/buddyInvites.ts` instead), and
    `tests/buddy-read-entry.test.ts` keeps the big store, the live module and the chat layer out of the entry, Home and the Book page. A refusal code is worded under `buddyRead.error.<code>`.
    The screens: `pages/together/[id]/index.vue` (the room) and `[section].vue` (a thread: the base's chat screen over the store; the room's own
    thread is the segment `room`), `components/together/*`, `utils/buddyRoom.ts`, `utils/buddyThread.ts` (the veil, in the view model) and
    `utils/buddyRoute.ts`. A page's `validate` is the address only (an address that is not a read id is the app's 404).
  - **Voice messages** (`data/buddyVoice.ts`, the voice calls of `data/buddyReads.ts`, the store's `sendVoice` and `voiceUrl`, `utils/buddyThread.ts` for the bubble): the recording and the
    sound are the base's (`UiComposer` `voiceMaxMs`, `UiVoiceBubble`, `@fabkho/ui/pure/voice`); the sound is an object in the private bucket `buddy-voice` and **nothing is signed or fetched
    when a thread loads**: the page takes the play button's press first (`voicePress`, capture phase on the thread's root) and asks `voiceUrl` for a URL of five minutes. The recorder and the
    player are in the thread page's lazy chunk, never the entry (`perf:bundle`). A deleted message's sound is removed by the Edge Function `buddy-voice-sweep` (docs/OPERATIONS.md, "Voice messages").
  - **Voice notes in Notes** (`data/noteVoice.ts`, the voice calls of `data/notes.ts`, the store's `sendVoice` and `voiceUrl`): **only for her own private notes**. The microphone is passed to the composer
    (`voiceMaxMs`) only at Only me (and only when she is not answering somebody else's note); at Friends or Everyone it is not offered, and the database refuses a voice note at any other level (`voice_private_only`).
    The sound is an object in the private bucket `note-voice` that only its author can read; the thread JSON carries the object's name to its author alone; **nothing is signed or fetched when a chapter loads**
    (the page's `voicePress`, as a buddy read's). Never add a path that shows a voice note, its count, its length or its name to anyone else: every read goes through `private.can_see_note` / `visible_notes`.
  - `entry-guard.config.ts` fails a production build if any chunk the entry loads statically holds
    `@supabase/realtime-js` (the stub is fine; `tests/entry-guard.test.ts`).
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
- **Buddy reads are for every member**: no build flag, no Profile switch, no route middleware (they had both for the first release; 1.34 removed them,
  with the turn-off confirm, `docs/parity.md`). What protects a member is in the rooms: leave (with the choice to delete her messages), a Host removing a
  member, block, report, delete account, and the rule that a co-member sees a Section only. Keep the entry lean: the chat layer, the big store
  (`stores/buddyRead.ts`) and the Realtime client are lazy chunks loaded by a room, never by Home, a Book page or Friends.
  - `stores/buddyInvites.ts` is the small door the shell, Home, a Book page and Friends use: her `my_buddy_reads()` list (invitations and reads), the repository
    loaded by a dynamic `import()`, nothing asked while signed out. The lamp dot, *Reading together* on Home and the Book page's action read it; a room's screen
    uses the big store.
  - The entry points: **the Book page's action** (`components/together/BookRow.vue`, in the action area of `pages/book/[key].vue` on every Book, in her Library or
    not: Read together, Open the buddy read, or disabled for a Manual book), Home's *Reading together* card and a Currently reading card's ⋯ menu
    (`components/home/{Together,TogetherMenu}.vue`). The setup sheet (`components/together/SetupSheet.vue`) is built when she presses an action, not with the page,
    and adds a Book that is not in her Library as Currently reading when she presses Start (`stores/library.ts` `addReading`). View models: `utils/buddyEntry.ts`;
    `tests/buddy-entry.test.ts` pins where they sit. Home reads the list on focus (`onMounted` and `onActivated`, no Realtime).
  - The link `/t/<token>` needs the sign-in (`utils/publicPath.ts` is untouched) and is kept through it by `utils/pendingBuddyRead.ts`; an open link shows the join card.
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

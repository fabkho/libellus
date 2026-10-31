# The new logo: Lamp over the page

The owner picked option 6 of the logo rounds in PR #448 (branch `design/logo-options`): an open book
with the lamp rising behind it like the sun, in a dusk-plum room. 1 (Bookmark B) and 25 (Night window)
stay in `design/logo-options/` as a backlog. The owner loved the animation and wants all three
follow-ups done:

1. **Apply the mark**: the app's icons, favicon, shortcuts and the docs that describe them.
2. **The launch takeover**: Android's static splash comes alive in the page's first paint.
3. **The way in**: the mark rises above the wordmark on sign in, sign up and verify.

Everything the work needs is already drawn: read `design/logo-options/README.md`, then
`design/logo-options/6-lamp-over-page/` (the sources, `sheet.png`, `motion/`), and open
`motion/index.html` in a browser (also shared as https://share.onorca.dev/a/YKx9kZ73TtYc). The
sources are generated: `marks.mjs` (geometry), `build.mjs` (SVGs, sheets), `animate.mjs` (motion);
their headers say how to run them (Playwright, opentype.js and the Fontsource faces in a temp folder,
`LOGO_DEPS=…`).

## Order and branches

Three PRs, in this order, each small enough to review on its own:

| PR | Branch | Base | Depends on |
| --- | --- | --- | --- |
| A · Apply the mark | `feat/logo-lamp` | `design/logo-options` until #448 is merged, then `main` | #448 (its sources) |
| B · Launch takeover | `feat/launch-takeover` | A | A (the icon it takes over from) |
| C · The way in | `feat/way-in-lamp` | A | A; independent of B |

**First ask the owner (through the coordinator) whether #448 may be merged** (it only adds
`design/logo-options/` and this plan). A worker never merges, never triggers CI by hand, never
releases. If #448 stays open, base A on `design/logo-options` and say so in A's body.

Rules for every PR: the conventions in `CONTRIBUTING.md`, `docs/DESIGN.md`, `docs/MOTION.md`
(tokens only: no duration or curve is written by hand), `docs/ACCESSIBILITY.md`; i18n through the
message files; targeted checks only (no full `nuxi typecheck`); screenshots of light and dark at a
phone width in every PR body; dev servers on the port the dispatch gives.

## A · Apply the mark (`feat/logo-lamp`)

### Icons

- Copy `design/logo-options/6-lamp-over-page/{icon,monochrome,favicon}.svg` over
  `design/icons/app/{icon,monochrome,favicon}.svg`. `icon.svg` is the adaptive/maskable source (108 dp,
  mark inside the 66 dp safe zone). Also add `icon-ios.svg` (the mark at ~60 % of the tile, for
  `apple-touch-icon` and the `any` icons): check what `web/scripts/render-icons.mjs` renders from which
  source and give `any` and `apple-touch-icon` the iOS framing if it reads better at 180/192 px (compare
  both in a screenshot; the current script uses `icon.svg` for all of them).
- **Shortcut icons** (`design/icons/app/shortcuts/{search,progress,library}.svg`, 96 px, the manifest's
  long-press shortcuts): redraw them in the plum room (`#3c3251 → #211b2e`, the lamp's glow) with marks
  from the new vocabulary, inside the 66 dp safe zone:
  Search = a magnifier whose lens holds the rising lamp (half disc);
  Update progress = the open book with the lamp half risen;
  Library = the open book alone, or two books, which ever reads at 96 px.
  Cream `#f1e3c8` and amber `#efb768` as in the icon. Show all three on a home-screen long-press mock
  in the PR (the contact-sheet code in `design/logo-options/build.mjs` can be reused).
- Run `cd web && node scripts/render-icons.mjs` (needs `pnpm install` in `web/`), and bump `iconVersion`
  in `web/nuxt.config.ts` (2 → 3) so every icon URL changes.
- Check the result where it is used: the manifest icons (Chrome's install dialog), the maskable icon
  in a circle and a squircle, the monochrome icon tinted, the favicon at 16/32 px in a tab, the
  apple-touch-icon. `docs/TESTING.md` has the Android emulator: install the PWA there once and
  screenshot the launcher, the themed icon and the launch screen (the screenshots are wanted for B too).

### Manifest and splash

- `background_color` / `theme_color` stay `surface.dark` (`#0e0c0a`): the splash on Android 12+ shows
  the icon in a circle on that colour, and the plum icon reads well on it (see
  `motion/handover.gif`). Rewrite the comment above them (it still talks about "the ribbons icon on
  dark red").

### Words that describe the old icon

Update every place that still describes Two ribbons:

- `design/icons/app/README.md`: rewrite for Lamp over the page (what it is, which file becomes which
  PNG, the shortcuts), and point to `design/logo-options/` for the round and the backlog.
- `docs/DESIGN.md` (Themes, the app icon paragraph): the mark, the plum room, why it is one icon for
  both themes, the files.
- `web/scripts/render-icons.mjs` header comment.
- `docs/parity.md` (the shortcuts line): the new shortcut marks.
- `web/nuxt.config.ts` manifest comment (above).

### README and email

- **README**: put the lock-up at the top, above the title or in place of it, as a `<picture>` with
  `wordmark-dark.svg` for `prefers-color-scheme: dark` and `wordmark-light.svg` otherwise (copy them to
  `docs/images/`). Keep `hero.jpg` (it shows the app, not the icon).
- **Email header** (`design/emails/shell.mjs`, generated through `pnpm emails`): today it is the text
  wordmark only. Mail clients don't show SVG, so a mark needs a PNG served by the instance with fixed
  width/height and alt text. **Ask the owner** before adding it; the default is to leave the email
  as it is and say so in the PR.

### Done when

The installed app, the browser tab and the shortcuts show the new mark in both themes; the CI checks
for tokens and emails pass unchanged; the PR body has the screenshots (launcher, long-press shortcuts,
themed icon, tab favicon at 1× and 2×, Android launch screen).

## B · The launch takeover (`feat/launch-takeover`)

What and why: Android draws an installed PWA's launch screen itself (manifest `background_color` +
icon); it cannot animate. The page can take over from it: its first paint draws **the same frame**,
so the handover is invisible, then the lamp's glow swells out of the icon into the room and the app
fades in. The reference is `motion/handover.gif` and the phone on `motion/index.html`.

### Build

- The first-paint frame lives in the static HTML so it shows before any JavaScript: Nuxt 4 with
  `ssr: false` renders `app/spa-loading-template.html` into the page until the app mounts (check the
  Nuxt 4 docs for `spaLoadingTemplate`; the file path is relative to `srcDir`). Inline: the night room
  (`surface.dark`), the icon as a circle (the maskable icon's central 72 dp, as Android 12+ crops it),
  centred, and a glow layer. No images to fetch: inline SVG.
- Size and place must match Android's splash. **Measure on the emulator** (`docs/TESTING.md`,
  `e2e/android/`): launch the installed PWA, screenshot the splash, measure the icon's diameter and
  centre in CSS px for the emulator's width, and match. Android 12+ draws the icon centred at a fixed
  size; older Android shows icon + name, which the frame can only approximate (leave it).
- The swell: the glow's opacity over `wave` on the `wave` curve; then the frame leaves over `exit`
  and the app arrives over `standard`. Read durations from the tokens (`--duration-*`, `durationToken`
  in the UI base's `utils/motion.ts`; MOTION.md explains the unit trap).
- **It never waits for the animation.** The app mounts as fast as it does today; when it is ready the
  frame leaves, cutting the swell short if need be. Measure LCP/CLS before and after (`docs/perf/`,
  docs/TESTING.md's CLS section): no regression.
- Only on a cold start of the installed app: `matchMedia('(display-mode: standalone)')`. In a browser
  tab the template is the plain background it is today (or nothing): decide from what the app shows
  now before mount, and keep the theme boot script's choice (a light-theme member sees the dark
  splash from Android, then the takeover in the dark room, then her light app: that is today's
  behaviour too, see the manifest comment).
- Reduce Motion: no swell; the frame crossfades to the app.

### Test

- A unit test for the decision (standalone + cold start + reduced motion → which path) if it lives in
  a util.
- A flow or emulator script that checks the frame is gone after mount and nothing is left in the DOM.
- The emulator recording (or a frame strip) of a real launch in the PR body, light and dark member.

### Docs

- `docs/MOTION.md`: a named motion "Launch takeover" with its tokens and rules.
- `docs/DESIGN.md`: one paragraph in Themes next to the splash.

## C · The way in (`feat/way-in-lamp`)

What: on sign in, sign up and verify (`web/app/components/auth/Frame.vue`, "a shelf in the dark with
a lamp over it, the wordmark…"), the mark rises above the wordmark, like `motion/mark-animated-*.svg`:
the pages arrive over `gentle` on `standard`, the lamp rises behind them over `wave` on `standard`,
its glow swells over `wave` on `wave`; the wordmark is there from the first frame (it must not wait,
it is the screen's text).

### Build

- An inline SVG component (not an `<img>`), so it takes the theme's colours from CSS variables
  (`--color-ink` for the pages, `--color-accent` for the lamp, the existing `--color-lamp-glow` for
  the glow) and animates with token durations/curves in CSS. Geometry from
  `design/logo-options/6-lamp-over-page/motion/mark-animated-dark.svg` (viewBox `6 22 88 72`, the
  pages' path, the lamp's path and its `sky` clip).
- Placement: centred above the wordmark, about the wordmark's cap height × 2 tall; check it against
  the lamp glow the frame already draws behind the wordmark (`Frame.vue` style block, "The lamp's
  glow behind the wordmark") so there are not two lights; the mark's glow may replace or join it.
- It plays once per visit to the way in, not again on sign in → sign up → verify (the frame is three
  mounts of the same wall; `wallWarm` shows the pattern for state that outlives a mount).
- Reduce Motion: the mark is there at once, static.
- `aria-hidden="true"` (the wordmark is the name; the mark is decoration).
- Check LCP on a phone (docs/perf: the way in's LCP is the wordmark/form; the mark must not become it).

### Test

- The flows that use `*.brand` (`data-testid`) still pass; a check that the mark is present and
  hidden from assistive technology.
- Screenshots: light and dark, 390 px and desktop, mid-animation and at rest.

### Docs

- `docs/MOTION.md`: a named motion "The lamp rising" (way in), with tokens.
- `docs/DESIGN.md` if the way in's description changes.

## Open questions for the owner

1. May #448 be merged first (design sources + this plan only)?
2. Email header: add the mark (a PNG served by the instance) or keep the text wordmark?
3. README: lock-up above the title, or replacing the `# BetterReads` heading?

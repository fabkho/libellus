# The new logo: Lamp over the page

The owner picked option 6 of the logo rounds in PR #448 (branch `design/logo-options`): an open book
with the lamp rising behind it like the sun, in a dusk-plum room. 1 (Bookmark B) and 25 (Night window)
stay in `design/logo-options/` as a backlog. The owner loved the animation and wants all three
follow-ups done:

1. **Apply the mark**: the app's icons, favicon, shortcuts and the docs that describe them.
2. **The first-paint frame**: built (#459), then dropped — Android's own frame stays (B).
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
| B · ~~The first-paint frame~~ | — | — | dropped, see B |
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

## B · The first-paint frame — dropped

Android draws a standalone app's first frame itself, from the manifest (`background_color` and the
icon), and cannot animate it. #459 answered that with a page that reproduced the frame and then
swelled the lamp's glow into the app. It was built, installed on the emulator and dropped: Android's
own frame is the frame the owner wants, and a second one is something extra between the tap and the
books. #461 reverts it and fixes what it was papering over — `any` is now the mark alone and the
maskable's room is the splash colour, so Android's launch screen shows the mark on the night room
with no tile edge (`docs/DESIGN.md`, `design/icons/app/README.md`).

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

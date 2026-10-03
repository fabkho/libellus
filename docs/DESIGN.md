# Libellus — Design Guideline

Libellus wears direction **D "Night Reader"**, picked in the design round (#4) and ported in #5.
The prototype stays viewable on branch `proto/round-1` (`/prototype?d=d`, Room: Night / Day), and
its binding decisions are in `web/app/components/proto/directions/d/DECISIONS.md` there. This file
is the guideline for everything built after it: what the design wants, the tokens it is made of,
the components and when to use them. Motion has its own file, [MOTION.md](MOTION.md).

## Principles

1. **A reading lamp in a dark room.** Warm near-black (or warm paper by day), and a single warm
   light: the lamp amber. The chrome stays quiet so the covers are what glows.
2. **The covers carry the colour.** Chrome is ink and hairlines. Colour comes from the books: a
   cover's glow on its card and page, its cloth on a Placeholder cover. The accent is for the one
   thing that is lit right now (the current tab's dot, the focused field, the sheet's action, a
   caret, the stars), never for decoration.
3. **Small, precise type.** Geist for the interface, tabular Geist Mono for figures, dates and the
   small uppercase eyebrows, Newsreader for book titles and the wordmark. Titles are serif, always.
4. **Hairlines, not boxes.** Edges are half-pixel rings and dividers inset under the text; cards
   are a slightly raised surface, not an outline.
5. **Floating chrome over the content.** The tab bar is a small glass capsule over a fade; search
   is a palette over the page, never a page; sheets rise over a scrim. The page you were on stays
   where it is.
6. **Two rooms, one design.** Light and dark are the same screens with two sets of values. Nothing
   is designed for one theme only.

## Themes

Light is D's *Day*, dark is D's *Night*. There is no third ("Dim") theme.

- The stored preference is `null | 'light' | 'dark'` on the device (local storage key
  `libellus-theme`, never in Supabase). `null`, the default, follows the phone's appearance.
- The switch in the avatar menu shows two states only, Light and Dark ("Dark mode", on or off).
  Its **first tap stores the opposite of what is showing**; every later tap flips. There is no
  "Match the phone" option and no way back to `null` from the interface.
- The rule is code in `web/app/utils/theme.ts` (framework-free, `web/tests/theme.test.ts`); the
  store is `stores/theme.ts`.
- Applied before the first paint: an inline script at the top of `<head>` (from `themeBootScript`)
  puts a stored theme on `<html data-theme>` before any CSS or JS loads, so the app never flashes
  the other theme. With no preference there is no attribute and `prefers-color-scheme` decides.
- The browser chrome and the installed app's status bar follow it: the static HTML has one
  `<meta name="theme-color">` per `prefers-color-scheme` (the theme's `surface`), a chosen theme
  overwrites both, and `apple-mobile-web-app-status-bar-style` is `default` so iOS tints the status
  bar from it. The manifest's splash colour is the light surface (manifests have no media queries).
- The app icon is the start of the wordmark, "li" in Newsreader italic in the dark theme's ink, in the
  night room, the dot of the i the lamp: the accent with its glow. One icon for both themes (an icon
  is an object on the home screen, like a cover). Drawn from the tokens and the shipped font by
  `web/scripts/render-icons.mjs` (192 and 512 `any`, a 512 `maskable` with the mark inside the safe
  zone, the 180 apple-touch-icon, the favicon).
- The preference is a setting of the device, not of the member: signing out keeps it, so the way
  in looks the way the member left it.

How it works in CSS: `design/build.mjs` writes the light values into Tailwind's `@theme` (on
`:root`) and the dark values into `[data-theme='dark']` and into `@media (prefers-color-scheme:
dark) { :root:not([data-theme]) }`. Every utility reads the variable, so one class (`bg-surface`,
`text-ink-muted`, `shadow-float`) is right in both themes. A component never branches on the theme.

## Tokens

One source, `design/tokens.json`; `cd design && pnpm tokens` writes
`web/app/assets/css/tokens.generated.css` (Tailwind v4 theme) and
`design/generated/Tokens.generated.swift` (SwiftUI, colours as light/dark dynamic colours, themed
numbers as `Themed<CGFloat>`). Never edit the generated files; CI runs `pnpm tokens:check`. A token
that differs between themes has `{ "light": …, "dark": … }` as its value. Tailwind's own default
palette, radii, shadows, type scale and easings are switched off, so only tokens exist.

### Colour roles

| Role | Utility | Light (Day) | Dark (Night) | Use |
|---|---|---|---|---|
| surface | `bg-surface` | `#f4f0e9` | `#0e0c0a` | The room: page background |
| surfaceRaised | `bg-surface-raised` | `#fbf9f5` | `#171512` | Cards, the search palette, the avatar menu |
| surfaceSheet | `bg-surface-sheet` | `#fbf9f5` | `#1b1815` | Bottom sheets |
| surfaceStage | `bg-surface-stage` | `#1a1714` | `#000` | Behind a page that steps back |
| glass | `glass` utility | paper 78 % | room 72 % | Floating chrome, always blurred |
| fill / fillStrong | `bg-fill`, `bg-fill-strong` | ink 5 % / 8.5 % | cream 5.5 % / 10 % | Grouped rows, the avatar, code cells / quiet buttons, pressed rows |
| hairline / hairlineStrong | `border-hairline`, `edge-faint` / `edge` | ink 10 % / 17 % | cream 8.5 % / 16 % | Dividers, card edges / chrome edges, outlines |
| ink | `text-ink`, `bg-ink` | `#1c1915` | `#eee7dc` | Text, icons, the primary button |
| inkMuted | `text-ink-muted` | 64 % | 64 % | Secondary text |
| inkFaint | `text-ink-faint` | 45 % | 42 % | Authors, meta, eyebrows, inactive tabs |
| inkGhost | `text-ink-ghost` | 20 % | 20 % | Placeholders, chevrons, the grabber |
| onInk | `text-on-ink` | `#f8f5ef` | `#0e0c0a` | Text on the primary button |
| accent | `text-accent`, `border-accent` | `#b8782a` | `#efb768` | The lamp (sparingly, see principle 2) |
| accentSoft | `bg-accent-soft` | 12 % | 14 % | Focus halos, the selected cell |
| lampLight / lampCone / lampGlow | (scoped CSS) | | | The light pool and cone of the empty-state lamp; the glow behind the wordmark |
| star / starTrack | `text-star`, `text-star-track` | accent / ink 20 % | | Rating stars |
| success | `text-success` | `#4f7a3c` | `#a3c48e` | Confirmations |
| error / errorSoft | `text-error`, `bg-error-soft` | `#c2452a` | `#ec8063` | Errors, destructive actions |
| scrim | `bg-scrim` | warm black 38 % | black 50 % | Behind a sheet |
| veil | `bg-veil` | paper 55 % | room 55 % | Over the blurred page behind the search palette |
| cloth1–6, clothInk | (Cover) | same in both | | Placeholder covers: a cover is an object, not chrome |

### Type

Families: `font-sans` (Geist 300/400/500/600), `font-mono` (Geist Mono 400/500), `font-serif`
(Newsreader 500, 400 italic). Latin subsets via Fontsource, only these weights (~118 KiB of woff2
in the precache). Each `text-*` utility sets size, line height, tracking and (where given) weight.

| Token | Size / line | Tracking | Weight | Use |
|---|---|---|---|---|
| `text-wordmark` | 54 / 54 | −0.02em | 400 | "libellus", serif italic, lowercase |
| `text-figure` | 44 / 44 | −0.04em | 300 | A large count (Read in <year>) |
| `text-large-title` | 28 / 34 | −0.03em | 500 | A tab's title (Library) |
| `text-title` | 24 / 27 | −0.025em | 500 | Home's title under its date |
| `text-headline` | 24 / 29 | −0.01em | 500 | Serif: empty-state titles, book detail title |
| `text-book-title` | 21 / 24 | −0.01em | 500 | Serif: a book on a card |
| `text-input` | 19 / 24 | −0.015em | — | What the member types in a form |
| `text-callout` | 17 / 22 | −0.015em | — | The search query; serif: a book in a list or sheet |
| `text-body-large` | 16 / 22 | −0.01em | — | Large buttons, the search prompt |
| `text-body` | 15 / 20 | −0.005em | — | The default |
| `text-subhead` | 14.5 / 21 | −0.005em | — | Empty-state text, medium buttons |
| `text-caption` | 13 / 18 | 0 | — | Authors, hints, small buttons |
| `text-footnote` | 12.5 / 16 | 0 | — | Field labels, errors |
| `text-meta` | 11 / 14 | 0 | — | Mono meta lines, avatar initials, a rating value |
| `text-eyebrow` | 10.5 / 12 | 0.12em | 500 | Use the `eyebrow` utility: mono, uppercase, faint |

Helpers in `main.css`: `book-title` (serif, medium, optical sizes) for every book title,
`figures` (mono, tabular) for dates, counts and ratings, `eyebrow` for section labels.

### Space, radius, size

- Space: `xxs` 2, `xs` 4, `sm` 8, `ms` 12, `inset` 14 (inside rows and cards), `md` 16, `ml` 20,
  `lg` 24, `xl` 32, `xxl` 48, `xxxl` 64; `screen` 20 is a screen's side padding. For padding,
  margin and gap (`px-screen`, `gap-ms`). Widths and heights take a size token
  (`h-(--size-row)`), never a spacing name.
- Radius: covers `cover-sm` 2.5 / `cover` 3.5 / `cover-lg` 5 by size, `sm` 8, `md` 14 (groups,
  code cells), `field` 18 (search field, avatar menu), `lg` 20 (cards), `xl` 24 (search palette),
  `sheet` 30, `pill`.
- Size: `touch` 44 (smallest target), `maxContent` 480 (the column on wide screens), `tabBar` 52,
  `tab` 62, `row` 48, `query` 56, `button` 50/40/32, `avatar` 32, `menu` 272, cover widths
  `coverXs` 30 · `coverSm` 40 · `coverMd` 72 · `coverLg` 82 · `coverXl` 140, stars 12/16/24 (display) and
  `starInput` 44 (the rating control, one star per fingertip) with its `ratingThumb` 24.
- Stroke: `hairline` 0.5 (edges), `rule` 1 (a field's underline), `focus` 2, icons 1.5 / 1.7.

### Depth

- Shadows (`shadow-*`, one value per theme: warm and light on paper, deep in the dark): `raised`,
  `cover`, `float` (tab bar), `button` (primary), `palette` (search palette, avatar menu), `sheet`.
- Edges: `edge` (strong hairline ring) and `edge-faint` draw a half-pixel ring inside the box and
  compose with a shadow.
- Blur: `glass` 22 (tab bar, avatar menu), `chrome` 18 (round buttons), `veil` 7 (the page behind
  search), `halo` 26 (a cover's halo). Opacity of a cover's light: `--opacity-glow` (1 dark, 0.5
  light), `--opacity-halo`.

## Layout and chrome

- **Phone first.** Every screen is designed at 393 × 852. On a wide screen the same layout sits in
  a centred column of `maxContent` with hairlines left and right; the tab bar and the search
  palette stay centred on it. No desktop layouts.
- **Safe areas** through utilities only: `screen-inset` (a whole screen), `safe-top`,
  `safe-bottom`, `safe-x`, `float-bottom` (floating chrome just above the home indicator) and
  `clear-tab-bar` (room under a tab's content).
- **Tab header** (`ShellHeader`): the page title on the left — under a mono date eyebrow on Home
  ("Friday · 2 Oct", `text-title`), on its own elsewhere (`text-large-title`) — and the avatar on
  the right.
- **Tab bar** (`ShellTabBar`): a glass capsule of three icons (Home, Library, Search) over a fade
  to the surface. The current tab is full ink with a bolder stroke and a lamp dot; the others are
  faint. Search is not a page: it opens the search palette, and the capsule itself turns into it
  and back (MOTION.md, Search morph).
- **Search palette** (`ShellSearchOverlay`): over the page, which stays put behind it, blurred
  and veiled. The query row is at the bottom (Home and Library at its left, the current one lit;
  Cancel replaces them while the keyboard is up), results go above it with the best match next to
  the query. Closed by Cancel, a tap on the page behind, a swipe down or Escape. It sits right
  above the keyboard. Its slot holds `SearchResults` (#6): one list, never naming where a result
  came from (one field, one list; at most one quiet loading state), each row a cover, the serif
  title, the author, the year in mono and a round + (or the Status, if the Book is in the Library).
- **Pushed screens** (the book page): in the tab layout with `pushed: true`, so the tab pages stay
  alive underneath; no header, the page draws `UiTopBar` (back) over its cover's light
  (`UiAmbient`, `UiCover` `glow`). The tab bar and search stay, so search works from every page.
- **Avatar menu** (`ShellAvatarMenu`): no profile screen. A small raised menu under the avatar with
  the account address, the Dark mode switch and Sign out.
- **The way in** (`AuthFrame`): a tilted wall of cloth Placeholder covers behind a veil, the lamp
  glow, the serif wordmark and tagline, the screen's eyebrow, its form and the link to the other
  screen at the bottom.

## Components

Base components live in `web/app/components/ui/` (`<UiButton>`, …), the app frame in `shell/` and
`auth/`. They use tokens only, take their copy from the caller or `en.json`, and pass
`data-testid` (and other attributes) through to their interactive element.

| Component | When |
|---|---|
| `UiButton` | Every button that is a pill. `tone`: `primary` (the one lit action of a screen: ink fill), `secondary` (hairline outline), `quiet` (translucent fill; actions on cards like Finish), `plain` (text only), `danger` (destructive). `size`: `lg` 50 (sheets, forms; usually `block`), `md` 40, `sm` 32 (on cards). `to` makes it a link. The touch target never drops below 44 px. `offline` (#15): an action that writes while the device has no connection stays in place, disabled, and reads "Offline" with the offline icon instead of its label. |
| `UiRoundButton`, `UiTopBar` | Glass round buttons for chrome floating over a cover (back, more) on pushed screens such as book detail. |
| `UiProgress` | How far through a Book (#39): a hairline bar, the lamp colour (`accent`) for what is read on a faint rule (`hairlineStrong`), `stroke.focus` thick, growing over `standard`. `fraction` 0–1; `label` and `valueText` for assistive tech. The words beside it ("p. 212 of 480", "45 %") are the caller's, in `figures`. |
| `UiIcon` | The icon set: 24-unit grid, hairline round strokes, `currentColor`. `bold` for the active tab. Names: home, library, search, back, plus, more, close, check, grip, chevron, down, calendar, lock, mail, repeat, slash, stack, globe, pencil, flag, arrow, sun, moon, signOut, offline (a cloud struck through: an action that cannot write now). Decorative; the control carries the label. New icons are drawn on the same grid. |
| `UiAvatar` | The member's initials (`utils/initials.ts`) in mono in a hairline ring. |
| `UiCover` | Every cover. 2:3, `object-fit: cover`, token widths (`size` xs–xl). Shows the thumbhash (or the dominant colour) while loading and fades the image in; spine crease and hairline edge; `glow` adds the lamp light (a blurred copy, or a pool in the precomputed `colors` until there is an image). No image or a broken one → the Placeholder cover (cloth by title, title and author set in type). `eager` for the first covers on screen. |
| `UiAmbient` | The light a cover throws onto its card (`shape="card"`) or page (`shape="page"`), from the cover's precomputed colours. Currently reading cards, book detail. |
| `UiStars` | A Rating, display only: quarter-filled stars plus the exact mono value ("3.75"). `quarters` 1–20 or null (five empty stars, no value). Sizes sm/md/lg (and `input`, for the rating control). |
| `UiRatingInput` | Setting a Rating (D's finish sheet): the value large in the accent (or "Not rated"), five `input` stars, a rail of quarter notches with a thumb. Drag snaps to the nearest quarter, a tap sets the whole star, Clear or a drag off the first star empties it. A `slider` for the keyboard (arrows a quarter, Page Up/Down a star, Home/End) and assistive tech. `v-model` quarters or null; `testid` on the slider, `<testid>.clear`, `<testid>.value`. Geometry in `utils/rating.ts` (`ratingX`, `quartersAt`, `wholeStarsAt`). Marked `data-no-swipe`, so a sheet never takes a drag across it for a swipe down. |
| `UiDateRow` | A day in a `UiRowGroup`: calendar icon, label, the day in words ("Today · 3 Oct", via `useDays`), chevron; an invisible native `<input type="date">` covers the row, so a tap opens the platform's picker. `v-model` `YYYY-MM-DD`; `min`/`max`; `invalid` turns the value error-coloured. |
| `UiTextArea` | A few lines of the member's own words (a review): a filled box with label and hint, the text in the serif italic, an accent ring while focused, growing with the text. |
| `UiBookLine` | The book a sheet is about: small cover, serif title, author. First thing in a book's sheet. |
| `UiRowGroup` + `UiRow` | Grouped rows (forms in sheets, settings-like lists): label, value or placeholder, optional icon, chevron, mono value; `as="button"` or `to` when tappable. |
| `UiSheet` | Every bottom sheet (Add, Finish, Abandon, Manual book, Collection picker). Grabber, a **text Cancel at the top left**, the title, the action at the right in the accent. Scrim, swipe down, Escape; respects the home indicator. `testid` names it, Cancel and the action are `<testid>.cancel` / `.action`. |
| `UiField` | A text field: small label, input-size text, one rule that lights in the accent while focused and turns error-coloured with its error line under it. |
| `UiEmptyState` | A screen with nothing in it yet: the lamp over an empty shelf, a serif title, a sentence, and (slot) the one way forward. |
| `UiSearchPrompt` | The search palette at rest inside an empty state; opens the real search overlay. |
| `UiPressLink` | Every link into a book page (search results, Library rows). Starts on touch-down: preloads the route and emits `press` (start loading the data); a mouse press navigates at once, a finger on its tap, since a touch-down may become a scroll. |
| `CodeInput` | The six-digit code: one real input, six drawn cells. |

Utilities that go with them: `utils/cover.ts` (`clothOf`, `glowOf`, `thumbhashDataUrl`, `coverSrc`
— the image size to load for a cover size, from Apple's stored large URL), `utils/preload.ts`
(`preloadImage`, the first covers of a list),
`utils/rating.ts` (`ratingText`, `starFills`), `utils/books.ts` (`formatAuthors`),
`utils/dates.ts`, all framework-free and tested in `web/tests/cover-and-rating.test.ts`.

Writing a component: Tailwind utilities from the generated theme first; where a utility cannot say
it (gradients, masks, container units), scoped CSS reads the token variables (`var(--color-…)`,
`var(--spacing-…)`), never raw colours or one-off sizes. After adding classes, `touch
web/app/assets/css/main.css` so Tailwind rescans.

## Copy tone

Short, warm, plain. The interface talks like a friend who keeps your books, not like software:
"Nothing on the shelf yet", "The books you read, kept quietly.", "We'll email you a six-digit
code. No password." Sentences end with a full stop; labels and buttons don't. Every string is a key
in `web/i18n/locales/en.json`.

## Accessibility

- 44 px targets everywhere (`--size-touch`), also behind drawn controls smaller than that.
- Icons are `aria-hidden`; their buttons have labels (`aria-label` from the message file, or
  visually hidden text, as the tabs do).
- Contrast: body text is `ink` or `inkMuted` on `surface`; `inkFaint` is for secondary meta only,
  `inkGhost` never for text that must be read.
- Focus is visible (`:focus-visible` draws a 2 px accent outline).
- Reduce Motion is honoured (MOTION.md).

## Don'ts

- No hex values, raw colours or one-off pixel values in components; no Tailwind default palette.
- No colour for decoration: the accent marks what is lit, the covers bring the rest.
- No sans-serif book titles, no round ✕ on sheets, no search page, no profile screen.
- No theme-specific components or `dark:` variants: a role has a value per theme.
- No prototype code: nothing in production imports `components/proto/` (it does not exist on
  `main`).

## Runner-ups

Kept on branch `proto/round-1` (`web/app/components/proto/directions/<key>/`, view with
`/prototype?d=<key>`), in case a later round wants to borrow from them.

- **A "Books"** (`directions/a`, dark variant `directions/a-dark`): Apple Books on iOS 26, done
  calmer. Cover-first on warm matte paper, covers in their real proportions carrying the colour,
  book detail on a field mixed from the cover's palette; only the chrome floats as frosted glass —
  a capsule tab bar with a detached search circle, round buttons, the search field at the bottom.
  Serif for everything you read, Inter for everything you tap, one accent for the one action.
- **C "Shelf"** (`directions/c`): books as objects. The Library is a bookcase of spines in each
  cover's colour, thick for long books, with typed call-number stickers for dates and a mustard dot
  for the Rating; the current book has a bookmark, finishing fills in its library card with a red
  date stamp. Tactile and playful, a little bouncy; search and lists stay plain.
- **C1 "Shelf, calmer"** (`directions/c1`): C's bookcase moved towards A and D — flat paper, light
  oak, a soft serif and Inter, one ember accent, hairline cards and the floating glass tab bar, with
  light and dark as two sets of the same tokens (the way D's themes now work). Liked, but too
  playful for the final pick.

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
- The switch in the Profile's account rows shows two states only, Light and Dark ("Dark mode", on or off).
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
- The app icon is two bookmark ribbons (the "li" of the wordmark as two ribbons, the dot of the i the
  lamp: the accent with its glow) in a warm leather-red room (#86). One icon for both themes (an icon
  is an object on the home screen, like a cover). Sources: `design/icons/app/{icon,monochrome,favicon}.svg`;
  `web/scripts/render-icons.mjs` renders 192 and 512 `any`, a 512 `maskable` (the mark inside the 66 dp
  safe zone of the 108 dp canvas; Chrome themes an installed app from it, Chromium 40277264), a 512
  alpha-only `monochrome` (themed icons), the 180 apple-touch-icon, `favicon.svg` and `favicon.ico`.
  Icon URLs carry `?v=<iconVersion>` (`nuxt.config.ts`): bump it when the icons change.
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
| surfaceRaised | `bg-surface-raised` | `#fbf9f5` | `#171512` | Cards, the search palette, the Profile's hero ring |
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
  code cells), `field` 18 (search field), `lg` 20 (cards), `xl` 24 (search palette),
  `sheet` 30, `pill`.
- Size: `touch` 44 (smallest target), `maxContent` 480 (the column on wide screens), `tabBar` 62,
  `tab` 72, `tabIcon` 26, `row` 48, `query` 62 (as tall as the capsule it grows out of), `fadeAbove` 64 (the tab bar's fade reaches this far over the capsule, from the screen edge), `button` 50/40/32, `avatar` 32, `menu` 272, cover widths
  `coverXs` 30 · `coverSm` 40 · `coverMd` 72 · `coverLg` 82 · `coverXl` 140, stars 12/16/24 (display) and
  `starInput` 44 (the rating control, one star per fingertip) with its `ratingThumb` 24.
- Stroke: `hairline` 0.5 (edges), `rule` 1 (a field's underline), `focus` 2, icons 1.5 / 1.7.

### Depth

- Shadows (`shadow-*`, one value per theme: warm and light on paper, deep in the dark): `raised`,
  `cover`, `float` (tab bar), `button` (primary), `palette` (search palette), `sheet`.
- Edges: `edge` (strong hairline ring) and `edge-faint` draw a half-pixel ring inside the box and
  compose with a shadow.
- Blur: `glass` 22 (tab bar), `chrome` 18 (round buttons), `veil` 7 (the page behind
  search), `halo` 26 (a cover's halo). Opacity of a cover's light: `--opacity-glow` (1 dark, 0.5
  light), `--opacity-halo`.

## Layout and chrome

- **Phone first.** Every screen is designed at 393 × 852. On a wide screen the same layout sits in
  a centred column of `maxContent` with hairlines left and right; the tab bar and the search
  palette stay centred on it. No desktop layouts.
- **Safe areas** through utilities only: `screen-inset` (a whole screen), `bar-top` (a bar's
  44 pt controls row starts under the status bar, and at least `barTop` 8 off the top edge where the
  device reports no inset — every browser tab — so it never touches the browser's toolbar; the
  installed iOS app's 59 pt inset wins there), `safe-bottom`, `safe-x`, `float-bottom` (floating chrome `floatAbove` 16 above the bottom inset, as Material 3 floats its
  toolbar: Android's navigation fills its inset, so nothing may reach into it — 40 off the edge in
  Chrome with gesture navigation, 16 above three-button navigation; on iOS only, `tabBarDrop` 13
  into the home-indicator inset: 21 pt off the screen edge on a Face ID iPhone, as iOS 26 places
  its tab bar, `ms` off the edge without one) and
  `clear-tab-bar` (room under a tab's content). `main.css` reads the insets once into
  `--safe-area-*`; nothing else uses `env()`.
- **Tab header** (`ShellHeader`), iOS's Large Title bar: under the safe area a 44 pt controls
  row with only the avatar at the trailing edge, then the title block `bar` (10) below it and
  `bar` above the page — a mono date eyebrow over the greeting on Home ("Friday · 2 Oct",
  `text-title`), the large title elsewhere (`text-large-title`). Pushed screens with a large
  title (Collections, a Collection, Import) put it on the same row, `bar` under their top bar.
- **Tab bar** (`ShellTabBar`): a glass capsule of three icons (Home, Library, Search) over a fade
  to the surface, at iOS 26's proportions: 62 tall, 72 per tab (224 wide), 26 px icons, 21 pt off
  the screen edge. The current tab is full ink with a bolder stroke and a lamp dot; the others are
  faint. Search is not a page: it opens the search palette, and the capsule itself turns into it
  and back (MOTION.md, Search morph).
- **Search palette** (`ShellSearchOverlay`): over the page, which stays put behind it, blurred
  and veiled. The query row is at the bottom (Home and Library at its left, the current one lit;
  Cancel replaces them while the keyboard is up), results go above it with the best match next to
  the query. Closed by Cancel, a tap on the page behind, a swipe down or Escape. It sits right
  above the keyboard. Its slot holds `SearchResults` (#6): one list, never naming where a result
  came from (one field, one list; at most one quiet loading state), each row a cover, the serif
  title, the author, the year in mono and a round + (or the Status, if the Book is in the Library).
- **Tab places**: each tab keeps its place, as iOS tabs do. Home and Library open where they were
  left (back and forward use the browser's saved place), and the tab already showing, tapped
  again, scrolls back to its top.
- **Pushed screens** (the book page): in the tab layout with `pushed: true`, so the tab pages stay
  alive underneath; no header, the page draws `UiTopBar` (back) over its cover's light
  (`UiAmbient`, `UiCover` `glow`). The tab bar and search stay, so search works from every page.
  The top bar is pinned under the safe area (centred on the column on a wide screen) and the
  page scrolls under its glass buttons: an installed app has no edge swipe back.
- **Profile** (`pages/profile/index.vue`, issue #78; design round #78, direction D): the avatar in
  every tab's header opens it, a pushed screen lit like a book page (the favourite cover of the
  year in view). B's hero (the initials in a `coverMd` ring, the name, "Reading here since …",
  the Library in one mono line), then A's year pills (All first, the default) over the four
  figures between hairlines, the books by month or by year as columns (the lit one in the lamp
  colour; a column opens its books in a sheet, or its year), the reading days as a five-week
  calendar of dots, the ratings as one bar per whole star (a row opens the books rated so), the
  records, the authors read more than once (a fan of covers and tally marks), the years in review
  as cards, and the account at the end (address, Name, Dark mode, Import books, Sign out).
  **Figures and covers, never sentences**: the owner turned down text summaries ("You read on 15
  of the last 21 days…"). No goals and no streaks: the reading days say which days and how much,
  never a run to keep.
- **Year in review** (`pages/profile/[year].vue`): pushed from the Profile, lit by the year's
  favourite. The year large (twice `figure`), the four figures, the months as rows of covers with
  their count (an empty month is a dash), the favourite on a lit card, ratings, records, authors,
  and the years either side (they replace the page, so Back is the Profile). For the owner only, a
  card under the months with that year's Books as Regal's 3D row, starting at January.
- **Your shelf** (`pages/profile/shelf.vue`, #23; the owner's account only, nothing anywhere for
  anyone else): Regal's 3D Stack of the published library file, the one the portfolio shows. A
  pushed screen that fills the column (`immersive`: the tab bar steps away) in the **night room in
  either theme**: the page carries `data-theme="dark"`, so every token takes its Night value inside
  it, and the status bar takes the room's colour while it is open. A bookcase is an object in a
  room, like a cover; the lamp-lit dark lets the Spines carry the colour (principle 2). The round
  back button and the title pinned, the count beside them in mono, the Stack below, its view
  reaching up behind the top bar so the pile starts above the middle. Regal's own parts (the tooltip
  and the Book's detail panel, a card, or on a phone a bottom sheet) wear D's tokens in the room's
  theme: `regal-themed` (`web/app/assets/css/regal-themed.css`, imported by `ShelfStage` and
  `ShelfRow` so it travels with the `regal` chunk) sets Regal's `--regal-*` tokens to D's roles
  (surface, raised surface, ink, muted and ghost ink, accent, hairline, the 14 px card radius, the
  raised shadow, Geist, Newsreader for the title, the eyebrow's tracking), and `theme="auto"` makes
  Regal follow the nearest `data-theme`.
  Any Regal component gets the same look with `class="regal-themed" theme="auto"`. The phone's sheet is
  the column's width with `--radius-sheet` corners, like `UiSheet`, and clears the gesture bar
  (`--safe-area-bottom`). Regal's own frame round the row's card is dropped (the Libellus card is the
  only edge; no token reaches it alone). The Book broken out on a phone is a quieter cousin of the
  app's sheets (`ShelfBookSheet`, through Regal's `#detail` slot): UiSheet's grabber and title row
  (a plain Done at the left puts the Book back, Back cover / Front cover at the right in the lamp
  colour; no pills), then the title in the book-title style, one mono line of facts (author, day,
  pages), the blurb in four lines and a trailing Goodreads link. Regal keeps the container.
  The Profile shows it as a section like the others ("Your shelf", the count, a quiet Show all only
  when there are more Books than its row holds) over a raised card filled edge to edge by Regal's
  row (`RegalBooksRow`, `regal-themed` in the app's theme): the Stack turned on its side, the newest
  80 Books standing Spines out, a sheet and the month between months. The year in review has the
  same card with that year's Books. The row scrolls sideways under the finger and never traps the
  page's scroll; a Book tapped breaks out over the whole screen, header and tab bar included, and
  Back lands it in the row again. While Regal loads, `ShelfPile` stands in: the Books as flat slabs
  in their Spines' colours, as thick as they are long (a pile on the shelf page, standing in a row
  in the cards), never a spinner or a shimmer.
- **Scroll bars**: where the platform draws them in the page (desktop browsers; phones lay their
  own over it), a thin ghost-ink thumb (`inkGhost`) on no track, in both themes (`color-scheme`
  follows the theme, so native parts — the date picker, autofill — do too); Safari, without
  `scrollbar-color`, gets the same thumb inset from the edge. Rows that scroll sideways (Up next,
  the Profile's year pills and year cards) show none: `scrollbar-none` (`main.css`).
- **Top scroll edge** (tabs layout): the installed app draws under a transparent status bar, so
  once something has scrolled under it a thin veil of the surface colour keeps the clock legible:
  solid behind the status bar (the top inset), fading to nothing `ms` below it. No blur, and it
  does not reach under a pushed screen's top bar; where the inset is 0 (a browser tab, the
  installed Android app) it is only that 12 px fade at the top edge. It never takes a tap. (#62:
  the first version — a blurred band down past the top bar's row — read too heavy.)
- **The way in** (`AuthFrame`): a tilted wall of cloth Placeholder covers behind a veil, the lamp
  glow, the serif wordmark and tagline, the screen's eyebrow, its form and the link to the other
  screen at the bottom.

## Components

Base components live in `web/app/components/ui/` (`<UiButton>`, …), the app frame in `shell/` and
`auth/`. They use tokens only, take their copy from the caller or `en.json`, and pass
`data-testid` (and other attributes) through to their interactive element.

| Component | When |
|---|---|
| `UiButton` | Every button that is a pill. `tone`: `primary` (the one lit action of a screen: ink fill), `secondary` (hairline outline), `quiet` (translucent fill; actions on cards like Finish), `plain` (text only), `danger` (destructive). `size`: `lg` 50 (sheets, forms; usually `block`), `md` 40, `sm` 32 (on cards). `to` makes it a link. The touch target never drops below 44 px. `offline` (#15): an action that cannot work without a connection (search, imports, Change edition, a new Collection; since #93 the other writes wait to sync instead) stays in place, disabled, and reads "Offline" with the offline icon instead of its label. |
| `UiRoundButton`, `UiTopBar` | Glass round buttons for chrome floating over a cover (back, more) on pushed screens such as book detail. |
| `UiProgress` | How far through a Book (#39): a hairline bar, the lamp colour (`accent`) for what is read on a faint rule (`hairlineStrong`), `stroke.focus` thick, growing over `standard`. `fraction` 0–1; `label` and `valueText` for assistive tech. The words beside it ("p. 212 of 480", "45 %") are the caller's, in `figures`. |
| `UiReveal` | Something that is not there until it has something to say (#79: the book page's figures, chart and reading log before progress was tracked). `show` opens its room and fades it in over `standard` (the content under it glides, no jump), closes over `exit`; Reduce Motion a short fade. Carries `data-moving` while moving. |
| `UiIcon` | The icon set: 24-unit grid, hairline round strokes, `currentColor`. `bold` for the active tab. Names: home, library, search, back, plus, more, close, check, grip, chevron, down, calendar, lock, mail, repeat, slash, stack, globe, pencil, flag, arrow, sun, moon, signOut, trash (a bin: deleting the account), offline (a cloud struck through: an action that cannot write now), sync (a cloud with an arrow up: changes waiting to sync, #93). Decorative; the control carries the label. New icons are drawn on the same grid. |
| `UiAvatar` | The member's initials (`utils/initials.ts`) in mono in a hairline ring. |
| `UiCover` | Every cover. 2:3, `object-fit: cover`, token widths (`size` xs–xl). Shows the thumbhash (or the dominant colour) while loading and fades the image in; spine crease and hairline edge; `glow` adds the lamp light (a blurred copy, or a pool in the precomputed `colors` until there is an image). No image or a broken one → the Placeholder cover (cloth by title, title and author set in type). `eager` for the first covers on screen. |
| `UiAmbient` | The light a cover throws onto its card (`shape="card"`) or page (`shape="page"`), from the cover's precomputed colours. Currently reading cards, book detail. |
| `UiStars` | A Rating, display only: quarter-filled stars plus the exact mono value ("3.75"). `quarters` 1–20 or null (five empty stars, no value). Sizes sm/md/lg (and `input`, for the rating control). |
| `UiRatingInput` | Setting a Rating (D's finish sheet): the value large in the accent (or "Not rated"), five `input` stars, a rail of quarter notches with a thumb. Drag snaps to the nearest quarter, a tap sets the whole star, Clear or a drag off the first star empties it. A `slider` for the keyboard (arrows a quarter, Page Up/Down a star, Home/End) and assistive tech. `v-model` quarters or null; `testid` on the slider, `<testid>.clear`, `<testid>.value`. Geometry in `utils/rating.ts` (`ratingX`, `quartersAt`, `wholeStarsAt`). Marked `data-no-swipe`, so a sheet never takes a drag across it for a swipe down. |
| `UiDateRow` | A day in a `UiRowGroup`: calendar icon, label, the day in words ("Today · 3 Oct", via `useDays`), chevron; an invisible native `<input type="date">` covers the row, so a tap opens the platform's picker. `v-model` `YYYY-MM-DD`; `min`/`max`; `invalid` turns the value error-coloured. |
| `UiTextArea` | A few lines of the member's own words (a review): a filled box with label and hint, the text in the serif italic, an accent ring while focused, growing with the text. |
| `UiBookLine` | The book a sheet is about: small cover, serif title, author. First thing in a book's sheet. |
| `UiRowGroup` + `UiRow` | Grouped rows (forms in sheets, settings-like lists): label, value or placeholder, optional icon, chevron, mono value; `as="button"` or `to` when tappable. |
| `UiSheet` | Every bottom sheet (Add, Finish, Abandon, Manual book, Collection picker). Grabber, a **text Cancel at the top left**, the title centred (a long one truncates, centred), the action at the right in the accent; a hairline under that row once the content scrolls. Geometry from a measured iOS 26 sheet (#62): grabber 36 × 5 (`size.grabber`, `size.grabberHeight`) 5 below the top edge (`space.grabber`), the title row 44 high starting `md` below the top edge (the title 38 down, the row's end 60 down), `md` to the content and `md` under it above the bottom inset (Material's least over Android's navigation), `ml` side margins like the screens (iOS 16/20 by width, Material 16–24); at its tallest it stops `sm` under the status bar (`--bar-top`). Not taken from iOS 26: the 38 pt corner radius (`sheet` stays 30, near Material's 28) and the floating, 8 pt inset partial-height sheet (Material sheets are attached). Scrim, swipe down, Escape, the system Back; respects the home indicator and rides on the iOS keyboard. While open the rest of the app is `inert` and does not scroll; focus goes in (to a field marked `data-autofocus`, if any) and back to the opener on close (`useModalLayer`). `testid` names it, Cancel and the action are `<testid>.cancel` / `.action`, the title `<testid>.sheetTitle`. |
| `UiListMotion` | A list whose items come and go in place (Home's cards, the Library's lists): a leaving item fades while its room closes, a new one opens its room and fades in. Pair with `useSettled` so the change waits for the sheet that made it. |
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
- No sans-serif book titles, no round ✕ on sheets, no search page, no text summaries of the reading.
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

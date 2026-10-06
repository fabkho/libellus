# Accessibility

Libellus aims at WCAG 2.2 AA on the web app, in both themes, on a phone first. This file is what was
checked, the rules the code follows, how to check a change, and what is still missing. The design's
side of it (tokens, focus, motion) is in [DESIGN.md](DESIGN.md) and [MOTION.md](MOTION.md).

## What was checked (the audit)

Every screen and state in light and dark at 412 × 915 (a Pixel 9 in CSS pixels): sign in, sign up,
the code; Home (Reading card, Want to read row, the Read in tally and its sheet); the Library (the
three segments, the filters, Collections); the search palette (resting, typing, results); a Book in
every status with its options, Start, Finish (the rating), DNF, Update progress (the wheel), Change
edition and Add sheets, the Goodreads line and the links row; the Profile (figures, chart, reading
days, ratings, records, authors, year cards, Account, Book links, Ebook folder); a year in review;
the owner's shelf (the Profile's row, a Book taken out, `/profile/shelf`); the sync chip and sheet;
the tab bar that steps away.

How:

- **axe-core** (WCAG 2.2 A/AA and best practices) through Playwright on every one of those screens
  and sheets, both themes. Now a flow: `web/e2e/a11y.spec.ts` (and the shelf's in
  `web/e2e/shelf.spec.ts`).
- **The accessibility tree**: Playwright's ARIA snapshot of each screen, and on the Android emulator
  (`libellus-pixel`, Chrome) the node tree TalkBack reads (`uiautomator dump` with TalkBack on), through
  the core loop: search → Book → Add → Start → Update progress (the wheel) → Finish with a rating →
  the Profile.
- **The keyboard**: tab order, the segments, sheets (focus in, kept in, given back), Escape, the
  progress card's button after a save.
- **Text at 200 %** (the root font size doubled, as the phone's text size does), screenshots of each
  screen.
- **Touch targets**: every control's box, and the `::after` that grows the small ones to 44.

## Rules

**Names, roles, states.**
- Every icon is `aria-hidden`; its button has a name from `en.json` (`aria-label` or visually hidden
  text). Every string, labels and announcements included, goes through the message file.
- A control is the element it is: a `<button>` for an action, a link (`NuxtLink`, `UiPressLink`) for a
  place. Toggles say their state (`aria-pressed`: the year pills, the filters, Pages | Percent;
  `role="switch"`: Dark mode). Groups of choices are radios (the Add sheet's Status).
- The Library's Status segments are WAI-ARIA tabs: one Tab stop, the arrows and Home/End move and
  show, the list is the tab panel.
- Values a finger drags are sliders with `aria-valuenow/min/max` and an `aria-valuetext` in words:
  the rating (`UiRatingInput`, "3.75 of 5 stars") and the progress wheel (vertical, "p. 212 of 480"); the
  keys are the slider's (arrows, Page Up/Down, Home/End). On Android a slider is a SeekBar, which
  TalkBack turns with a swipe up or down. A drawn rating is `role="img"` named "3.75 of 5 stars".
- A cover is named by its title only where it stands alone (Want to read's row, a year's months);
  wherever the title is written beside it the cover is `decorative` (UiCover), so nothing is read
  twice.
- Text drawn in pieces (dots between facts, a count beside a year, a month's count) is given to
  assistive tech as one phrase: an `aria-label` on the heading or group, or a visually hidden string
  with the drawn pieces hidden.
- Something that comes and goes says so in a polite status: a progress save ("Progress saved, +24.
  Undo is beside it …"), the sync chip, search results (`aria-live` on the results), the shelf
  loading. Errors are `role="alert"`. Every navigation reads the new page title
  (`NuxtRouteAnnouncer`).
- Each page has one `h1` (the greeting, Library, the Book's title, the address on the Profile, the
  year, Your shelf) and `h2` sections. Landmarks: the header (`banner`), `main`, the tab bar
  (`navigation` "Main navigation"), a sheet (`dialog` named by its title).

**Sheets and focus.** `UiSheet` and `UiConfirm` are modal (`role="dialog"`, `aria-modal`, named by
their title): the rest of the app is `inert` while one is open, focus goes in (to `data-autofocus` if
there is one) and back to what opened it on close; Escape, the scrim, a swipe down and the system
Back close it. The scrim is `aria-hidden` (Cancel is the named way out). A control that turns into
another (Update → Undo → Finish on Home's card) is one element, so focus survives the change. Focus
is always visible: `:focus-visible` draws a 2 px `accentInk` outline. The tab bar that steps away on
scroll comes back as soon as focus enters it (#125).

**Contrast.** Every text token reaches 4.5:1 on every surface (`surface`, `surfaceRaised`,
`surfaceSheet`) and on a `fill` over it, in both themes:

| Token | Light (min–max) | Dark (min–max) | For |
|---|---|---|---|
| `ink` | 14.1–16.7 | 12.5–15.9 | Text |
| `inkMuted` | 6.6–7.3 | 7.5–8.9 | Secondary text |
| `inkFaint` | 4.5–4.8 | 4.9–5.5 | Meta, eyebrows, inactive tabs, placeholders: the faintest text |
| `accentInk` | 5.2–6.1 (4.6 on its own `accentSoft` wash over a fill) | 8.5–10.8 | The lamp as small text (the sheet's action, lit figures, the New pill) and the focus ring |
| `error` | 4.9–5.8 | 5.8–7.3 | Errors, destructive actions |
| `accent` | 2.9–3.5 | 8.5–10.8 | Dots, rules, carets, stars, figures at large size (3:1) only |
| `inkGhost` | 1.5 | 1.7–1.8 | Chevrons, separators, the grabber, disabled text: never text that is read |

Meaningful icons use `inkFaint` or stronger (3:1 and more). Opacity on text (a quieted count) is
checked like a token. `design/tokens.json` carries these values; a new text colour is checked
against all six backgrounds before it lands.

**Targets.** 44 × 44 pt at least (`--size-touch`); a control drawn smaller (32 pt pills, an 11 px
link, the search field's clear button) gets the rest from an invisible `::after`. The rows and the
segments may grow taller with large text; nothing has a fixed height that would clip its own text.

**Motion.** `prefers-reduced-motion` is honoured everywhere (MOTION.md, "Reduce Motion"): the
morphs, flights and slides become a short fade or nothing, the wheel's coasts finish at once, the
shimmer stops, the tab bar stays.

**Language.** `<html lang="en">`; the static shell has a `<title>` before the app sets its own.

## Checking a change

- **While developing**: `pnpm dev` loads two of Nuxt's own DevTools modules (dev only; not in
  `nuxt generate`, not in the Playwright run): **Nuxt a11y** (`@nuxt/a11y`, axe-core on every page as
  you go, violations by impact, click one to highlight the elements; also logged to the console) and
  **Nuxt Hints** (`@nuxt/hints`, web vitals, third-party scripts, an HTML check). Open the DevTools
  (Shift + Option + D) and their tabs.
- **The flow**: `cd web && pnpm exec playwright test e2e/a11y.spec.ts` (and, with Regal,
  `LIBELLUS_REGAL=1 REGAL_LAYER=… pnpm exec playwright test e2e/shelf.spec.ts`). It fails on any
  serious or critical axe violation and prints the moderate and minor ones. A new screen or sheet
  gets a scan there (`expectAccessible(page, '<where>')` from `e2e/support.ts`), in both themes.
  A violation that cannot be fixed in Libellus goes in `ALLOWED` in `e2e/support.ts` with its reason
  — never a rule switched off for a whole page.
- **The keyboard and the screen reader** are not covered by axe: the second flow in `a11y.spec.ts`
  checks the segments, a sheet's focus and the progress card. For TalkBack, see docs/TESTING.md
  (the emulator) and turn it on with
  `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService`
  (`adb shell settings delete secure enabled_accessibility_services` turns it off). `adb shell
  uiautomator dump` shows the tree TalkBack reads.

## Known gaps

- **Regal's row and Stack** (the owner's shelf) are accessible since fabkho/regal#79: the row's
  scroller is a `region`, both render their own hidden Book list (`accessible-list`, one button for
  each Book), a Book taken out is a `role="dialog"` (modal when the row breaks out; named "{title}
  details" because Libellus' `BookSheet` fills its `#detail` slot) and stars are read as text.
  What is left of Regal's DOM: a Book taken out is a card moved to `<body>`, outside any landmark
  (axe `region`, moderate), and the row's cover-flip is Regal's own.
- **The reader** (#131, merged during this audit, left alone here): its sepia room's text tokens are
  below 4.5:1 (`inkMuted` 4.0, `inkFaint` 2.6, `accent` as text 3.5 on the sepia surfaces), and its
  chrome and sheets (`components/reader/*`) still set text in `inkGhost` and the plain accent; it has
  no a11y flow yet. `accentInk` already has a sepia value (#7f4d14, 5.2:1) for when it moves over.
- **TalkBack by hand.** The emulator pass read the tree TalkBack gets and checked it on every step of
  the core loop, but gestures injected through adb are not taken as TalkBack gestures, so swiping
  through a screen and turning the wheel with TalkBack were not done by a person. Worth one manual
  pass on a phone; VoiceOver on iOS was not tried.
- **Text at 200 %**: titles, authors and meta lines are cut with an ellipsis at every size (a design
  choice: rows stay one line); with large text more of them are cut. The full text is in the
  accessible name. The Profile's figures can overflow their cell (a "29.2K" loses its last
  character) at 200 %.
- **A year in review's covers** are 40 × 60 with a 4 px gap: 44 apart, but each cover's own box is
  40 wide.
- **Placeholders** are now `inkFaint` (4.5:1); the date row's empty state and the rating's "Optional"
  too. Disabled controls stay `inkGhost` (WCAG exempts them).

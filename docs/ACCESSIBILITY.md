# Accessibility

BetterReads aims at WCAG 2.2 AA on the web app, in both themes, on a phone first. This file is what was
checked, the rules the code follows, how to check a change, and what is still missing. The design's
side of it (tokens, focus, motion) is in [DESIGN.md](DESIGN.md) and [MOTION.md](MOTION.md).

## What was checked (the audit)

Every screen and state in light and dark at 412 × 915 (a Pixel 9 in CSS pixels): sign in, sign up,
the code; Home (Reading card, Want to read row, the Read in tally and its sheet); the Library (the
three segments, the filters, Collections); the search palette (resting, typing, results); a Book in
every status with its options, Start, Finish (the rating), DNF, Update progress (the wheel), Change
edition and Add sheets, the Goodreads line and the links row; the Profile (figures, chart, reading
days, ratings, records, authors, year cards, Account, Book links); a year in review;
the owner's shelf (the Profile's row, a Book taken out, `/profile/shelf`); the sync chip and sheet;
the tab bar that steps away.

How:

- **axe-core** (WCAG 2.2 A/AA and best practices) through Playwright on every one of those screens
  and sheets, both themes, when they were audited. Now a flow, **dark and light** (each screen is scanned in the
  dark room and then in the light one), for the screens on the critical paths (docs/TESTING.md, "Which flows"): `web/e2e/a11y.spec.ts`; the public reading page, its
  Book cards, a dead link, the Share sheet and the Book's Share sheet (#171) in
  `web/e2e/reading-page.spec.ts`, with the waitlist form in its states.
  The privacy notice (and the imprint, once it is on: `/privacy`, `/imprint`), in English and German, in both themes, in
  `web/e2e/legal.spec.ts`; each text carries its own `lang`, so a screen reader reads the German in German.
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
  twice. In the social screens (feed, Home's friends, a member's finished Books) that is one link per
  Book: the cover's link is `aria-hidden` and out of the tab order, the title is the Book's link. A member's row
  that opens a sheet (Home's friends rows, the feed's batch rows) has one button for the row, named by its sentence
  ("Ida: started Piranesi, 2 days ago"; the fan is `aria-hidden`), stretched over the row (`stretched`, main.css);
  her avatar and her name are separate, above it: the name is the link to her page, the avatar's link is
  `aria-hidden` and out of the tab order (a pointer's second way to the same place), so nothing is nested and her
  page has one link per row. The focus ring is drawn on the stretched box. A row of one openable read is that Book's
  link instead.
- A follow request's buttons say whose it is (`Accept {name}`, `Decline {name}`, `Unblock {name}`), and the
  lamp dot on the header's avatar is `aria-hidden` (the avatar's label says a request waits).
- Text drawn in pieces (dots between facts, a count beside a year, a month's count) is given to
  assistive tech as one phrase: an `aria-label` on the heading or group, or a visually hidden string
  with the drawn pieces hidden.
- A name starts with what is drawn on the control, word for word (WCAG 2.5.3, label in name): a voice
  user says what she sees. So the header's and the Profile's avatar say her initials ("Profile: FK"), a
  chart's column is its count and its label before the words they abbreviate ("8 · ’26 — 2026"), the
  Home tally and a Reviews card say their count and their words in the order they are drawn, and the
  reader's place is the "10 % · 108 left" it shows before "Go to a page". The pieces that stand side by
  side carry a real space between them in the document (a `{{ ' ' }}`, or a space in the text a row is
  given, which a flex or grid container renders as nothing): axe compares the name with the drawn text
  as it runs together, so pieces with no text between them are one word to it ("Read in 20261",
  "Science fiction67"), which no name contains.
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
A sheet whose body is only text (What's new) makes that text one Tab stop (`tabindex="0"`, a named
`region`): once it outgrows the sheet it scrolls, and a scroll region the keyboard cannot reach is axe's
`scrollable-region-focusable`. Whatever fades in over `standard` carries `data-moving` while it does
(sheets, `UiReveal`, the Profile's page under its hero), so a flow waits for it (`untilStill`) and a
scan never reads half-faded colours.

**Progress on an earlier day** (the Update progress sheet's day switch and the Reading log; docs/parity.md,
*Progress on an earlier day*; `DayPills.vue`, `ProgressLog.vue`, `ProgressSheet.vue`). The patterns, for the next
control of the kind:
- **A group of choices that is not a radio set is a `role="group"` of buttons with `aria-pressed`** (the Pages | Percent
  pattern): the day pills Today · Yesterday · Pick a day…, the group named "Day". Drawn 32 pt, each pill has a 44 pt box
  from an invisible `::after` (`--size-touch`); the row wraps at 200 % text, it never shrinks or scrolls. The lit pill
  is `bg-ink text-on-ink`: the state is also in `aria-pressed`, never colour alone.
- **A native control laid over a drawn one**: the third pill is an `<input type="date">` stretched over the pill's whole
  44 pt box and invisible (`opacity: 0`, so it stays focusable and the platform's picker opens from a tap), with its own
  name: "Pick a day", and once a day is picked "Pick a day, Fri 30 Oct", so the drawn words are inside it (WCAG 2.5.3).
  The input is invisible, so the **pill draws the focus ring** (`:has(:focus-visible)`, 2 px `accentInk`). `min` and
  `max` are the read's start and today: the platform's picker enforces them, the app puts a day outside back, and the
  database checks again. Desktop browsers open their picker only from their icon, so a click calls `showPicker()`.
- **A changed state of a dialog is announced by a polite status, not by the title**: a dialog's title is read once, when it
  opens, so choosing a day (the title becomes "Progress on Fri 30 Oct") is said by a visually hidden
  `role="status"` / `aria-live="polite"` line ("Progress on Fri 30 Oct, between p. 170 and p. 188."), and the wheel's own
  value text follows. **The effect line** ("Adds Fri 30 Oct. Sat then reads +10, not +18.") is a polite live region that
  is always in the DOM and whose text comes and goes (`UiReveal` opens its room); a region added with its text is not
  announced. Focus stays on the pill she chose.
- **A log row is one button**, a plain `UiRow as="button"` with the chevron, 48 px tall. Its name is **what the row shows, word for word, then the action**: "Sat +18 p. 188. Edit"
  (the plan's "Sat, +18 pages, ends at page 188. Edit" failed axe's `label-content-name-mismatch`); the pieces drawn
  side by side have a real space between them (see "A name starts with what is drawn"). A day that went back reads
  "−6" with its minus (not colour alone, not "+-6"). **Add day** and **See all N** follow the same rule ("Add day to
  the reading log", "See all 20 days of the reading log"; the pill is drawn 32 pt with a 44 pt box and `aria-haspopup="dialog"`
  where it opens one).
- **Focus returns to what opened the sheet**: the tapped **row** or **Add day** (a pointer's tap does not focus a button in
  every browser, so the log focuses it on tap, otherwise the sheet has nothing to give focus back to). When a Remove has
  taken the row away, focus goes to **Add day**, else to the first row, never to the page. **See all** opens the older
  rows in place (no second dialog over the sheet a row opens) and gives focus to the first new row, since the pill that
  was pressed is gone.
- **A destructive confirm says what it does to the number she cares about** (`UiConfirm`, `removeDay`: "Your progress goes
  back to p. 188.") and offers **Keep it** in Cancel's place; an error stays inside it (`role="alert"`) and the same button tries again.

**Contrast.** Every text token reaches 4.5:1 on every surface (`surface`, `surfaceRaised`,
`surfaceSheet`) and on a `fill` over it, in light, dark and the reader's sepia room:

| Token | Light (min–max) | Dark (min–max) | Sepia (min–max) | For |
|---|---|---|---|---|
| `ink` | 14.1–16.7 | 12.5–15.9 | 10.0–11.9 | Text |
| `inkMuted` | 6.6–7.3 | 7.5–8.9 | 6.2–7.0 | Secondary text |
| `inkFaint` | 4.5–4.8 | 4.9–5.5 | 4.6–5.0 | Meta, eyebrows, inactive tabs, placeholders: the faintest text |
| `accentInk` | 5.2–6.1 (4.6 on its own `accentSoft` wash over a fill) | 8.5–10.8 | 5.2–6.2 | The lamp as small text (the sheet's action, lit figures, the New pill, the reader's Set here and Translate links) and the focus ring |
| `error` | 4.9–5.8 | 5.8–7.3 | 4.7–5.6 | Errors, destructive actions |
| `accent` | 2.9–3.5 | 8.5–10.8 | 3.5–4.1 | Dots, rules, carets, stars, figures at large size (3:1) only |
| `inkGhost` | 1.5 | 1.7–1.8 | 1.5 | Chevrons, separators, the grabber, disabled text: never text that is read |

Meaningful icons use `inkFaint` or stronger (3:1 and more). Opacity on text (a quieted count) is
checked like a token. `design/tokens.json` carries these values; a new text colour is checked
against all six backgrounds (three surfaces, bare and under a fill) in each room before it lands.

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
- **The flow**: `cd web && pnpm exec playwright test e2e/a11y.spec.ts`. It fails on any
  serious or critical axe violation and prints the moderate and minor ones. A new screen or sheet on a
  critical path gets a scan there (`expectAccessible(page, '<where>')` from `e2e/support.ts`), which scans
  the dark colour scheme and the light one. The reader is scanned in its three rooms (sepia, light, dark) in
  `e2e/reader.spec.ts` (it needs Chromium), with its assistive buttons: the controls and the page turns
  without a tap in the middle or a swipe (WCAG 2.5.1).
  **Voice messages** in a buddy read's thread: the microphone's hold-to-record, slide-up-to-lock and slide-left-to-cancel (WCAG 2.5.1, 2.5.7)
  always have a single-pointer alternative: a tap, Enter or Space on the microphone (and VoiceOver's or Switch Control's activation) records
  hands-free in the panel with ✕ and Send as ordinary 44 px buttons; the microphone's description names both ways (`uiText.chat.voice.recordHint`) and
  locking, discarding and a too-short hold are announced politely (`e2e/buddy-voice-hold.spec.ts`).
  A violation that cannot be fixed in BetterReads goes in `ALLOWED` in `e2e/support.ts` with its reason
  — never a rule switched off for a whole page.
- **The keyboard and the screen reader** are not covered by axe: the second flow in `a11y.spec.ts`
  checks the segments, a sheet's focus and the progress card. For TalkBack, see docs/TESTING.md
  (the emulator) and turn it on with
  `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService`
  (`adb shell settings delete secure enabled_accessibility_services` turns it off). `adb shell
  uiautomator dump` shows the tree TalkBack reads.

## Known gaps

- **The native date input of the day pills** (*Progress on an earlier day*): axe reads the input and its name in every
  state (`e2e/progress-earlier-day.spec.ts`, `@full`); the platform's own picker (iOS's wheel, Android's calendar) and
  VoiceOver or TalkBack on it were not tried in this change. A day that already has an entry cannot be marked in the picker
  (the platform has no way to); the range line and the effect line say what a day does instead.
- **The icon column on a friend's Book row** (social v2a: *Want to read* and the heart, `icon-action` in `main.css`,
  `RowActions`): the owner chose a narrow column at the row's right edge, centred on the cover, over text-sized
  controls on the line (which could not have a 44 px box without covering the title or the stars). Each icon is drawn at
  24 × 24 px (`--size-target`, WCAG 2.2 AA 2.5.8) with a touch box (`--size-touch`, the app's own 44 px rule) centred
  on it sideways. The two icons are a close pair, 4 px apart (the drawn heart is 18 px), and their boxes split at the midpoint
  between them and reach outward, the bookmark's up and the heart's down, so they never overlap each other; each is
  44 px wide and, with room (Home's card, the feed; a heart alone in the Readers rows is centred), 44 px tall. On a member's Recently finished row, whose cover is small (`sm`, 60 px tall) and whose height the column must not
  grow, the boxes stop at the row's own edge (the 8 px padding above and below it), so they are 38 px tall (44 px wide):
  the boxes of two rows meet at the border and never overlap, and a tap near a title or the stars is not theirs. The
  name is hidden text (the icon is drawn), and the heart keeps one constant name with `aria-pressed`. Busy and Offline
  are `aria-disabled`, not `disabled`, so focus stays; the focus ring is the app's (2 px `accentInk`). The heart's count
  hangs right under the icon, inside its box where the box is tall enough, and is part of the heart's name.
- **Regal's row and Stack** (the owner's shelf) are accessible since fabkho/regal#79: the row's
  scroller is a `region`, both render their own hidden Book list (`accessible-list`, one button for
  each Book), a Book taken out is a `role="dialog"` (modal when the row breaks out; named "{title}
  details" because BetterReads' `BookSheet` fills its `#detail` slot) and stars are read as text.
  What is left of Regal's DOM: a Book taken out is a card moved to `<body>`, outside any landmark
  (axe `region`, moderate), and the row's cover-flip is Regal's own.
- **You both read** (a member's profile; `components/friends/BothRead*.vue`). The slideshow moves by itself, so
  it has a pause control (WCAG 2.2.2): Regal's round button (our words `member.bothReadPause` / `member.bothReadPlay`),
  present while the 3D plays and in Manual (then it reads Play), with Regal's own keyboard hint (`member.bothReadKeys`); a swipe, a tap or a key also
  stops it (Manual), and with Reduce Motion nothing moves at all (the poster). The canvas is not the way in for a
  screen reader: Regal's own list is off (`accessible-list` false) and the section's own list stands in the page
  instead, always, hidden from the eye until "Show as a list" (`aria-expanded`): one link for each Book, read out
  as "Title by Author. Lena: 4.50. You: 5.00." (the ratings only where shown). The poster's neighbours are buttons
  ("2 of 12: Title"), its front Book a link to the Book's page; the pills are images named by the rating sentence
  and their avatars decorative; a polite live line says "3 of 12" when the front Book changes. A Book taken out
  is Regal's dialog with Libellus' content (Show back, Put back, Open book; Escape and the system Back close it,
  Regal owns that Back entry). The figures line is plain text; its link opens the widest disagreement's Book.
- **The reading page** (#171) is read by strangers, signed out, often in a messenger's in-app
  browser: one `h1` (her name, or "This page isn't here"), each section a `section` named by its
  `h2`, every cover row a list of links (a cover with its title beside it is decorative; a shelf's
  covers alone carry the title), the month row as labelled figures rather than buttons there is
  nothing to open, the viewer's own theme. Its waitlist form is a `section` named by its `h2` with a
  real `<label>` on the field (autocomplete `email`, the email keyboard), an address that is not one said
  under the field (`aria-invalid` and `aria-describedby`), a refusal as `role=alert`, "You're on the list"
  as a polite status that takes the form's place, and a honeypot field hidden from assistive tech and out
  of the tab order. The owner's Waitlist page names every trash button with the address it deletes and
  asks before deleting.
- **The reader** (#131) was scanned in its three rooms (the page and its
  chrome, Aa, Contents, search, the selection's bubble, Translate and Define) in the printed style,
  once by hand and by a flow since removed (docs/TESTING.md, "Which flows");
  the Classic style's bars and the scroll style's use the same tokens and are not scanned apart.
  Not done by hand: VoiceOver or TalkBack through a book (the page text is the book's own markup,
  inside a frame).
- **TalkBack by hand.** The emulator pass read the tree TalkBack gets and checked it on every step of
  the core loop, but gestures injected through adb are not taken as TalkBack gestures, so swiping
  through a screen and turning the wheel with TalkBack were not done by a person. Worth one manual
  pass on a phone; VoiceOver on iOS was not tried.
- **Text at 200 %** (the rule is in DESIGN.md, Text size; checked by hand, no flow): the
  Profile's figures scale down to fit their cell, and a Book's title in a row takes a second line from
  117 % text on a 412 px phone. Authors and meta lines are still cut with an ellipsis (a design choice:
  one line each; the full text is in the accessible name), and so are a date row's value ("Today · 6") and
  the Profile's name; those would need rows that stack. A sheet's title now wraps between Cancel and its
  action (fabkho/ui#24), the Home card's lines wrap, the progress wheel's rows and the Add sheet's status
  rows grow with the text instead of drawing over each other. The wrap follows the browser's
  default font size (Android's text size, a browser's own setting or zoom); iOS Dynamic Type does not
  change `rem` for a web page, so nothing moves there. On a wide screen the OS text size alone does
  not narrow the viewport in `rem` enough to trigger it (browser zoom does).
- **A year in review's covers** are 40 × 60 with a 4 px gap: 44 apart, but each cover's own box is
  40 wide.
- **Placeholders** are now `inkFaint` (4.5:1); the date row's empty state and the rating's "Optional"
  too. Disabled controls stay `inkGhost` (WCAG exempts them).

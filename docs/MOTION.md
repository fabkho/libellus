# Libellus — Motion Language

Motion in D is quiet: things arrive softly and leave quickly, nothing bounces, nothing moves for
its own sake. Every duration and curve is a token in `design/tokens.json` (`duration.*`,
`easing.*`), exposed as `--duration-*` and Tailwind's `ease-*`; no other value is written anywhere.

## Laws

1. **Arrive slow, leave fast.** Entrances use `standard` or `sheet` easing at their duration;
   exits use `exit` easing and a shorter duration. A morph is not an exit: the search palette
   turns back into the tab bar on the curve it came with, only quicker, and lands softly.
2. **Move only what changed.** A sheet slides, the page under it does not; the tab dot fades, the
   tab bar stays.
3. **Follow the finger.** Anything that can be swiped follows the drag 1:1 and either lets go
   (dismiss) or springs back with its own enter curve.
4. **State before motion.** With Reduce Motion, every transition finishes at once; the state still
   changes.

## Tokens

| Token | ms | Easing | Used for |
|---|---|---|---|
| `instant` | 100 | `standard` | Press feedback: a button scales to 0.97 |
| `quick` | 150 | `standard` | Small state changes: a tab lighting up, the switch, a field's rule, code cells |
| `standard` | 250 | `standard` | Crossfades, a cover fading in over its thumbhash, a Profile column growing, the push to a book |
| `exit` | 200 | `exit` | Anything small leaving; back from a book (on the `standard` curve) |
| `sheet` | 380 | `sheet` | A sheet rising, its scrim fading in |
| `sheetExit` | 260 | `exit` | A sheet falling away |
| `overlay` | 340 | `standard` | The tab bar turning into the search palette, the veil fading in |
| `overlayExit` | 240 | `standard` | The palette turning back into the tab bar, the veil fading out |
| `keyboard` | 250 | `keyboard` | The palette riding up and down with the iOS keyboard |
| `caret` | 1100 | steps | One blink of a drawn caret (the code input) |
| `wave` | 1600 | `wave` | One swell of the Profile's loading wave, repeating while the record loads |

| Easing | Curve | Character |
|---|---|---|
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | Fast out of the gate, long soft landing |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | Accelerates away |
| `sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | The iOS sheet curve |
| `keyboard` | `cubic-bezier(0.1, 0.76, 0.55, 0.9)` | Close to the iOS keyboard's own spring (curve 7, nominally 0.25 s) |
| `wave` | `cubic-bezier(0.45, 0, 0.55, 1)` | An even swell up and down, for a loop with no edge to catch the eye |

Swift gets the same values (`Tokens.Duration`, `Tokens.Easing` as `TimingCurve`).

Code that animates with the Web Animations API reads the durations back from the CSS variables
(`durationToken`, `utils/motion.ts`) in either unit: the source writes milliseconds, but the built
stylesheet is minified to the shortest form (`--duration-standard: .25s`). Read as a bare number that
was a quarter of a millisecond, and every such motion jumped to its end in the built app while the
dev server showed it running (`tests/motion.test.ts`, `e2e/book-flight-built.spec.ts`).

## Named motions

- **Press.** Buttons scale to 0.97 over `instant`; no colour flash. Rows darken to `fillStrong`
  while pressed. Safari on iOS applies `:active` only under a touch listener: one passive no-op
  `touchstart` on the document does it (`plugins/touch-active.client.ts`).
- **Tab.** The new tab's icon goes full ink and its lamp dot fades in over `quick`; the old one
  recedes. The page itself swaps without a transition (tabs are places, not a sequence), at the
  place it was left. The tab already showing, tapped again, scrolls smoothly to its top (at once
  with Reduce Motion).
- **Push to the Profile** (#78). Tapping the avatar in a tab's header grows it into the Profile's
  ring over `standard`, as a cover flies into a book's hero: the Profile fades in as the tab fades
  out (one's opacity the other's complement) and rises `md` into place; the tab bar does not move,
  the Profile's pinned top bar only fades in. Back (the round button or the system's) plays it the
  other way over `exit` on the `standard` curve: the ring shrinks into the avatar, the Profile fades
  out and sinks `md`, the tab fades in at its place. Into a tab whose avatar is scrolled out of
  view, the ring leaves with the Profile instead of flying off the screen. A Back the browser
  animates itself (iOS Safari's edge swipe) gets nothing on top; Reduce Motion, or a browser
  without the View Transitions API, just changes the page. Unlike the cover's flight (a FLIP of
  its own, interruptible), this one is the browser's View Transitions API
  (`plugins/profile-transition.client.ts`, the names in `main.css`): one ring between two fixed
  places needs nothing more, and a second Back mid-way simply completes it.
- **Profile** (#78). The year pills
  change the figures in place; the columns grow or shrink to their new height over `standard`
  (at once with Reduce Motion). Flipping the theme in the account rows crossfades nothing — the
  colours change at once, the switch's knob slides over `quick`.
- **Month rows** (a year in review). The Books of each month are a row of small covers
  (`ProfileMonthBooks`). When the page opens they slide in from the right, one after another, as
  Books pushed onto a shelf: each cover goes from 56 px to the right of its place and from invisible
  to 0 and full over `sheet` with the `sheet` curve, the covers of a row 40 ms apart (240 ms at most)
  and the rows 40 ms apart from the top (500 ms at most). `transform` and `opacity` only, no layout.
  A row below the fold waits and does it, once, as it scrolls into view (`IntersectionObserver`);
  rows that come into view together run top to bottom. Only the page's first open: a year switched to
  opens a fresh page and plays it; the page showing again or its data reloading does not. Covers
  stay tappable throughout. Reduce Motion: no animation, the covers stand at rest. Regal's row has no
  entrance of its own; this takes the stagger (40 ms a step, 500 ms budget) from the cascade of
  Regal's pile (`staggerIn`, `utils/stack/shuffle.ts`) and D's `sheet` token for the landing. The
  numbers live in `utils/monthIntro.ts`.
- **Loading** (the Profile and a year in review). The page stands in its final shape from the
  first frame, so nothing under it moves when the reading record lands: every section that will
  be there is there, at its height, its labels and frames real (the eyebrows, All lit, the grid's
  hairlines, the chart's height, the calendar's weeks up to today — today already lit — the star
  rows, the year cards) and a quiet placeholder in the `fillStrong` colour (`skeleton`,
  `main.css`) wherever a figure, a cover or a line of text will be. The placeholders breathe in
  one slow wave (`wave`: brighter, then back, over `wave` on the `wave` curve), each a little
  behind the one before, so the wave travels across a row of figures, down the star rows,
  corner to corner across the calendar; the chart's bars rise and fall in it the same way
  (`transform` alone). When the record comes, the figures, lines and covers arrive in place:
  they fade in and rise the last `xs` over `standard` (`arrive`, `useArrival`); each bar grows
  from where the wave left it to its own height over `standard` (Web Animations from the measured
  height), the calendar's dots grow and tint into their days, the rating bars fill. A section
  the record turns out not to have (Reading days without days kept, Ratings with nothing rated,
  Records, Authors, the year in review's favourite) was guessed present — a member who reads has
  it — and closes like a `Reveal`, over `exit`, taking its space with it, so the page below
  glides up instead of jumping. A year in review's month rows hold a cover's placeholder
  each and, when the record comes, open as in Month rows. Guesses where the record can't be known before it comes: the Profile
  under All has four years and four authors, a year in review a cover in every month (none in the
  months still to come). A member whose Library (as this device holds it) has nothing finished
  gets no placeholders: the empty state opens in once the record says so. The device keeps the
  last record (`stats` in the device's copy), so only the first visit on a device shows any of
  this: the next opens with the figures and refreshes them where they stand.
- **Sheet.** Rises from below the screen edge (`translateY(100%)` → 0) over `sheet` with the
  `sheet` curve; the scrim fades in alongside. Leaves over `sheetExit` with `exit`. Swipe down on
  it: it follows the finger, and closes when dragged more than 80 px or flicked faster than
  0.5 px/ms, otherwise it settles back (`web/app/composables/useSwipeDown.ts`).
- **A sheet comes back.** A sheet that leads to a Book page (Home's *Read in 2026*, the Profile's and a
  year in review's rows of Books) is open again when the member returns from that Book by Back (the
  system's or the page's own), and it comes back as if it had simply stayed open under the Book page:
  at its resting place, with its scrim full, its list scrolled where it was, and none of the sheet's
  own motion — nothing rises, the scrim does not fade in, and it is there from the page's first frame
  (`restore` on `UiSheet`, which turns its enter transitions off for that one opening; the page keeps
  what was open and puts it back: `composables/useSheetRestore.ts`). What plays is the page's: the
  cover flies back over the sheet (the flying layer goes above it, `data-over-sheet`) and lands on its
  row in the sheet. A fresh opening (the tally tapped again) rises as always, and the way out is
  unchanged. Reduce Motion: as for every sheet, nothing moves either way (`e2e/sheet-restore.spec.ts`).
- **Reveal.** Something that was not there until it had something to say (the book page's figures,
  chart and reading log before any progress was tracked, `UiReveal`) opens its room and fades in over
  `standard`, so what sits under it glides down instead of jumping; it closes over `exit`. Clipped only
  while it moves. With Reduce Motion a short fade over `quick`, no travel. The room carries
  `data-moving` while it moves.
- **Search morph.** As iOS 26 and Apple Books do it, the tab bar's capsule turns into the search
  palette (`overlay`, `standard`) and back (`overlayExit`, `standard`):
  - the capsule widens into the palette: its outline grows from the capsule's to the palette's
    and its glass becomes the palette's raised surface, which covers it early on;
  - Search's icon flies from the capsule to the front of the query row (from the tab bar's 26 px
    to the row's 19 px, from faint to lamp), pulling the query in behind it; Home and Library stay put in the
    capsule, which stays where it is under the veil until the palette has covered it. Cancel
    fades in at the row's end (Home and Library come back into the row once the keyboard is
    down);
  - the page behind blurs and dims (the veil fades in);
  - the results area (whatever the overlay's slot holds: the list, or a single quiet loading
    hint; there is no source strip) unrolls upwards as the outline's top edge rises, fading in
    until 70 % of the way;
  - the shadow grows out of the capsule's and fades in;
  - the capsule's Home and Library fade out before the flying icon reaches them, and on the way
    back return only once it has passed, so the icon never crosses a visible tab.

  Closing — Cancel, a tap on the page behind, a swipe down, Escape, or going to another page —
  plays the same keyframes back to front, landing softly on the capsule; the tab bar takes over
  at the very end, pixel for pixel. The morph can be turned around at any point (Search tapped
  again while it closes, the page tapped while it opens): the new direction starts from the
  progress already on screen. Swipe down follows the finger 1:1 and lets go or settles back as
  on a sheet; letting go far enough runs the close from there.

  The keyboard: once the query has it, the palette sits `--spacing-sm` above it, moved there by a
  transform over `keyboard` with the `keyboard` curve as soon as the visual viewport reports the
  new height. In the installed app (and in Safari with its toolbar collapsed) that happens as the
  keyboard starts to rise, so the palette rises with it; with Safari's toolbar expanded WebKit
  reports it only at the end (WebKit bug 265578), and the palette follows after.
- **Push to a book.** Tapping a book wherever it shows its cover — Home's reading card (its cover or
  its title) and Want to read, a Library row or card, a search result, a Collection's row — flies that
  cover from where it is on screen into the book page's hero over `standard`. The book page fades in
  as the page left fades out (one's opacity the other's complement, so the two never both read at
  full strength), and its content from the hero down rises `md` into place; its pinned top bar and
  its light (the ambient glow, the cover's own halo) only fade in, they do not fly. The cover in the
  air is the one that was tapped, showing exactly what it showed (its image, its thumbhash, or the
  cloth); laid out at the hero's size, it lands on the hero's pixels. The tapped image is sized for
  its row, so it is never shown blown up: the hero's own image (asked for when the finger went down)
  is laid over it in the air as soon as it is decoded — from the first frame when it is in, faded in
  over `quick` when it arrives on the way — and until then the row's image fades to the thumbhash
  under it as the cover grows past its own pixels. A Placeholder hero's cloth, with its type, fades
  in over the tapped cloth on the way. A cover that lands with the hero's image stays on the hero —
  in its sheet, so it scrolls and fades with the page — until the hero's own image is decoded and
  has faded in, so it never shows twice; one that lands without it (a slow network) lands on its
  thumbhash, and the hero's image fades in there. A cover's image (and the halo made of it) fades in only once it
  is decoded, and the halo cross-fades with the pool of colour it replaces. A Placeholder flies as
  cloth and gains its title on the way. The tab bar does not move; the search palette, when the tap
  was on a result, turns back into the tab bar under the flying cover as it does for any navigation.

  The hand-off is the same on every device, however slow: from the tap until the flight starts, a
  still copy of the page being left stands in for the live page, so the frame in which the router
  has drawn the new page but the flight has not started never shows it bare; and the flight's first
  frame shows where it starts, held still until it is on screen (a busy first frame would otherwise
  show the cover half way there — on `standard` the first 50 ms are half the travel).

  Back — the back button or the browser's — plays it the other way over `exit` (on the `standard`
  curve, landing softly): the hero flies back into its row, the book page fades out and sinks `md`,
  and the list fades in exactly where it was (same scroll, same tab place: the flight never moves
  the page). The cover is as sharp on the way back as on the way out: the hero's own image flies the
  whole way, never cross-faded with the row's small one (blown up on the way it would be a blur), and
  it hands over to the row only once landed on it: it stays there, in the row's sheet, until the
  row's own image is decoded and showing (the row was off the document while the book page was open, so a
  browser may have dropped what it had decoded; a row opened before its image came has only its
  thumbhash), then fades out over `quick` at the same size. A cover that left without the hero's
  image on screen flies the row's, which goes to its thumbhash while the cover is larger than it
  holds sharply, as on the way out. Only into the page it came from, and only if its row is on screen: a row scrolled away,
  a book opened from search (the palette is gone), or a list still loading → the cover leaves with
  its page in a cross-fade. A Back the browser animates itself (iOS Safari's edge swipe) gets no
  flight on top of its own. Tabs and links from the book page are new places: no flight.

  Interruptible like the search morph: Back tapped while the cover is still flying in turns it
  around from the point on screen, and the same book tapped again while it flies back sends it in
  again from there; anything else lands the running flight at once. If the book page has not drawn
  its hero when the flight starts, the cover waits for it (a frame or so, at most `standard`), then
  fades where it is.
- **Tab bar away.** On every page (Home, Library, the Profile, a book, Collections, a Collection, Import) the tab bar
  slides down past the screen edge and fade out while the member scrolls down, and
  come back on a short scroll up — away over `exit` with the `exit` curve, back over `standard` —
  by `transform` and `opacity` alone, so the page under it is never laid out again. The scroll counts
  as intent only once it has gone 10 px in one direction from where it last turned
  (`utils/hideOnScroll.ts`), and the bar is always there at the top and at the very end of the page.
  It is never away while search opens, is open or closes, while a sheet or
  confirmation is on screen, while a field has the keyboard, or with Reduce Motion on, and focus
  moving into it (a screen reader's, a keyboard's) brings it back: search opened with the bar away puts
  it in its resting place first, with no transition, and the morph grows out of it there. A change
  of page (Back included) brings it back on the way. A screen that fills the room (`immersive`:
  Your shelf, #23) has it away for as long as it shows, the same slide.
- **Your shelf** (#23). The shelf page's loading pile: its slabs settle in one after another, `standard`
  each, a third of `instant` apart, from `sm` above; then they hold still (no shimmer, no breathing),
  and once Regal's Stack has the Library and has drawn, it fades in over `standard` and the slabs fade
  out over the same, in place. The cards' row (the Profile's, a year in review's, Home's *Read in*
  sheet) has no stand-in and no fade of ours: the owner's screens warm it on idle, and the card, which
  keeps its size, is its plain surface until the row has drawn the Spines in view; then Regal's intro
  plays, the Stack's turned for a row (each Book pops in a little to the right of its place and slides
  home, cascading from the left, the newest last, 0.7 s; the month sheets, dates, focus label and scroll
  bar fade in as they settle), once per mount and not at all with Reduce Motion, where the row simply
  shows. The row mounts as its card comes into view (its top edge in the upper three quarters of it), so
  the intro is seen where it plays. The 3D itself moves as Regal decides (the Stack's scroll and flick,
  the row's sideways scroll with the Books tipping towards you as they pass the middle, a Book coming
  out and turning, a Book breaking out of the row to the middle of the screen and landing back where it
  was shown): Regal's own motion, which honours Reduce Motion itself.
- **Change edition.** The book page stays the same page (and where it was scrolled) when its entry
  changes to another edition: the old cover, title, author and facts (and what the Book is about)
  lie over the new ones, and once the Change edition sheet has fallen away and the new cover's
  image is decoded (at most twice `sheet`, then the new cover shows what it has and fades its image
  in itself) the old ones fade out as the new ones fade in, over `standard` — the cover cross-fades
  in place, the 2:3 box being the same — and the light in the room turns from the old cover's
  colours to the new one's (the colours themselves animate: a fading light would draw its grain on
  its own). The content below (status, actions, history) is the entry's and does not change; if
  the new title takes more or fewer lines it slides from where it was to where it is now over
  `standard`. Interruptible: leaving the page or another change ends it at
  once, the new edition in place. Reduce Motion: the cross-fade alone, nothing slides.
- **A list changes.** Finish, Abandon or Start moves a Book from one list to another: the list on
  screen holds still until the sheet has fallen away (`useSettled`), then the card or row that
  leaves fades over `exit` while its room closes over `standard`, so the ones after it slide up and
  the page shortens as smoothly; one that arrives opens its room and fades in over `standard`
  (`UiListMotion`). A change made on another screen (a Start on the book page) plays when the list
  is back on screen. Interruptible: an item reverses from the height it has. A list never moves
  items it measured off the page (a kept-alive tab in the background re-rendering): coming back to a
  tab shows its list in place (`e2e/library-return.spec.ts`).
- **Tally mark.** A finish adds a mark to Home's tally: it fades in at full lamp with its glow and
  settles to the others' strength over twice `sheet`. Only a mark added to a count already on
  screen lights up.
- **Sheet on the keyboard.** A sheet whose field has the iOS keyboard rides up on it like the search
  palette, over `keyboard` with the `keyboard` curve, and its focused field scrolls into view.
- **Hover.** With a mouse (only where the device hovers), rows and menu items take the `fill`,
  pills deepen by it, the lit button lets a little of the room through. No transition beyond the
  existing ones.
- **Cover.** The image fades in over its thumbhash or colour over `standard` once decoded; no
  zoom, no slide.
- **Search results.** A new answer replaces the list in place, best match at the bottom; while a
  newer query is on its way the old list dims to 60 % over `standard` instead of emptying. The far
  end of the list fades out under a mask, and the note at that end is padded by the fade's height
  so it rests below it.
- **Search loading.** Before the first answer a little book riffles its pages (five, hinged at the
  spine, flipping over and back) over one quiet line, "Looking through the shelves…", and a
  lamp-coloured hairline sweeps left to right along the edge above the query. It shows nothing for
  the typing pause plus `quick` (an answer that comes straight back shows no loading at all), then
  fades in over `standard`; the loops run on `caret` times a fixed factor, the pages staggered by
  `instant`. The palette glides to the height it needs over `standard` (it grows from the query
  upwards, and only once the state shows), the state fades out over `exit` where it stood, and
  the first five results rise `sm` and fade in over `standard`, 50 ms apart. With Reduce Motion
  the book rests half fanned, the hairline is not drawn and the height just changes.
- **Caret.** The lamp caret in the code input blinks in steps over `caret`, like a text caret.
- **Reader** (#131 phase 2, `components/reader/`). *Read now* flies the book page's cover to where
  the book's own first page will be (a copy in a fixed layer, `transform` and `clip-path` only,
  `utils/readerFlight.ts`), the room fades to the reader's own over `standard` beneath it, and the
  copy hands off to the page; Back flies it home the same way. The printed page turns with a short
  dip: the page fades out over `instant` (`exit`) and the next one fades in over `standard`, no
  slide; the classic style slides the page under the finger (foliate-js's own paginator). A turn
  asked for while the page still settles is made right after, never lost. A tap in the middle
  floats the capsule (or the classic bars) in over `standard` and out over `exit`; the page
  slider grows out of the capsule. Search in a book is the app's palette and morph (see *How the
  search morph is built*), out of the capsule or the bottom bar; its only loading sign is the
  lamp hairline above the query, from the first keystroke until the answer is in. Sheets are the
  app's. Android's Back puts the chrome away, then closes the book.

## How the search morph is built

`web/app/components/shell/SearchOverlay.vue`, with `TabBar.vue` and `useSearchChrome` saying who
draws the chrome (`tabs`, `morph`, `palette`). The palette is laid out at its open size from the
first frame and never changes size; what moves is

- a `clip-path: inset(… round …)` on the palette's body, from the capsule's outline to its own —
  the widening and the unrolling, with no width or height animated and nothing laid out again;
- `transform` and `opacity`: the Search icon's flight (a FLIP from the tab bar's icon), the
  query, the shadow (scaled from the capsule's box, since a clip cannot hold a shadow), the veil;
- `color` on the one small icon.

Everything is one Web Animations timeline per direction (`element.animate`, keyframes measured
when a direction starts, `fill: both`), cancelled once it has landed, so nothing keeps a layer or
a `will-change` while the palette sits open. An interruption reads the progress on screen
(`getComputedTiming().progress`), finds the time at which the other direction's curve shows the
same progress (`timeAt` in `web/app/utils/motion.ts`) and starts there. Durations and curves are
read from the token variables, so the script carries no numbers of its own.

Why not the View Transitions API: Safari has same-document view transitions (18+), but they
animate snapshots — the old and the new state as flat images, stretched into each other — while
the page waits underneath. They cannot be turned around halfway (a new transition skips the
running one to its end), cannot be driven by a finger, cannot follow the keyboard while they
run, and the stretched snapshot of a pill into a panel smears icons and text. A FLIP with WAAPI
keeps live elements, is interruptible by construction, and runs in every WebKit the app
supports. Why not animating width and height: every frame would lay the palette and its results
out again, the first thing to drop frames on a phone; `clip-path` repaints the palette only.

## How the push to a book is built

`web/app/composables/useBookFlight.ts` with its two layers in `components/shell/BookFlight.vue`
(mounted once in the tabs layout), the arithmetic in `web/app/utils/flight.ts` and the page copy in
`web/app/utils/snapshot.ts`. The router swaps pages at once (the tab pages are kept alive off the
document), so the page being left is copied while it is still there — in the tap (`UiPressLink`
hands the flight the link it was tapped on) or, for Back, in the router's `beforeEach` — into a fixed
layer under the chrome. Only what is on screen is copied in full; everything off screen becomes an
empty box of its size, so a long Library costs a screenful of nodes. The flight starts when the
router has drawn the new page and resolves where to scroll it: that place is applied first, the
boxes are measured there, and the animations start in the same frame, before it is painted. The
router then scrolls to the same place; its scroll behaviour (`app/router.options.ts`,
`utils/tabPlaces.ts`) is unchanged.

The flying cover is a copy of the tapped cover's sheet (`[data-cover]` in `UiCover`) in a box laid
out at the hero's size, drawn at the row's by a FLIP transform (`translate` then `scale`, origin top
left), so it is moved by `transform` alone and `will-change` lives only on that box while it flies.
The live covers at both ends hold their place unseen (`data-flight-hidden`) while the copy stands in
for them. Everything else is `opacity` (the pages) and `translateY` (the rise and the sink).

On Back the copy carries the hero's own image over the row's (`pop`), opaque for the whole flight. Once
landed (`land`, only for a flight that ran its course, not one cut short) `handOff` moves it into the
row's sheet, as `hold` does into the hero, until the row's image is decoded (`decode()`) and showing,
and then fades it out over `quick`. Back-to-front keyframes keep their `offset`s turned round
(`oriented`), or `animate` throws.

Each part — the cover's travel, the book page, the list — is a channel whose value says how far
towards the book page it shows. All of them are Web Animations (`fill: both`) cancelled once landed;
an interruption reads each channel's value off the screen (`getComputedTiming().progress`) and starts
the new direction's animation at the time its curve shows the same value (`startAt`, built on
`timeAt` in `web/app/utils/motion.ts`), exactly as the search morph turns around.

Not the View Transitions API, for the reasons above: a flight turned around mid-air, a page that keeps
its scroll and its live state, and covers that land on their own pixels need live elements.

## Reduce Motion

`prefers-reduced-motion: reduce` sets every transition and animation to 1 ms in
`web/app/assets/css/main.css`, so sheets, menus and the keyboard lift appear and disappear in
place and the caret stops blinking. Nothing depends on an animation finishing. The search morph
is one exception, as iOS does it: nothing travels or grows, the palette and the veil
cross-fade over the tab bar in place over `standard` (Web Animations, which the CSS rule does
not touch). The push to a book is another: no cover flies and nothing rises, the book page and the
page left cross-fade in place over `standard`, both ways. Change edition is the third: the old
edition's hero cross-fades into the new one over `standard`, and the content below takes its new
place at once. The tab bar away does not hide at all: a bar that pops in and out in place
is more motion than one that stays. The month rows of a year in review do not open: their covers
stand at rest at once. Your shelf: the pile is there at once and the 3D replaces it
without a fade. The Profile's loading: the placeholders stand still (no wave; the chart's bars at
half their wave), and the figures replace them at once. The reader: no cover flies (the reader
cross-fades in and out in place), the printed page turns at once, and its search palette
cross-fades like the app's.

## Non-motions

No parallax, no bouncing or overshoot, no skeleton shimmer elsewhere (thumbhashes and the search
palette's one quiet loading hint say "loading"; the Profile's loading wave is the one exception, the
owner's wish, because its figures take a moment to come and the page must not move when they do),
no page transitions between tabs, no animated theme change.

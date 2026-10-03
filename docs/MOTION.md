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
| `standard` | 250 | `standard` | Crossfades, a cover fading in over its thumbhash, the avatar menu opening |
| `exit` | 200 | `exit` | The avatar menu closing; anything small leaving |
| `sheet` | 380 | `sheet` | A sheet rising, its scrim fading in |
| `sheetExit` | 260 | `exit` | A sheet falling away |
| `overlay` | 340 | `standard` | The tab bar turning into the search palette, the veil fading in |
| `overlayExit` | 240 | `standard` | The palette turning back into the tab bar, the veil fading out |
| `keyboard` | 250 | `keyboard` | The palette riding up and down with the iOS keyboard |
| `caret` | 1100 | steps | One blink of a drawn caret (the code input) |

| Easing | Curve | Character |
|---|---|---|
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | Fast out of the gate, long soft landing |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | Accelerates away |
| `sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | The iOS sheet curve |
| `keyboard` | `cubic-bezier(0.1, 0.76, 0.55, 0.9)` | Close to the iOS keyboard's own spring (curve 7, nominally 0.25 s) |

Swift gets the same values (`Tokens.Duration`, `Tokens.Easing` as `TimingCurve`).

## Named motions

- **Press.** Buttons scale to 0.97 over `instant`; no colour flash. Rows darken to `fillStrong`
  while pressed.
- **Tab.** The new tab's icon goes full ink and its lamp dot fades in over `quick`; the old one
  recedes. The page itself swaps without a transition (tabs are places, not a sequence).
- **Avatar menu.** Opens from its top-right corner: fade plus a 0.96 → 1 scale and a 4 px drop,
  `standard`; closes the same way back, `exit`. Flipping the theme inside it crossfades nothing —
  the colours change at once, the switch's knob slides over `quick`.
- **Sheet.** Rises from below the screen edge (`translateY(100%)` → 0) over `sheet` with the
  `sheet` curve; the scrim fades in alongside. Leaves over `sheetExit` with `exit`. Swipe down on
  it: it follows the finger, and closes when dragged more than 80 px or flicked faster than
  0.5 px/ms, otherwise it settles back (`web/app/composables/useSwipeDown.ts`).
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
  - the shadow grows out of the capsule's and fades in.

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
- **A list changes.** Finish, Abandon or Start moves a Book from one list to another: the list on
  screen holds still until the sheet has fallen away (`useSettled`), then the card or row that
  leaves fades over `exit` while its room closes over `standard`, so the ones after it slide up and
  the page shortens as smoothly; one that arrives opens its room and fades in over `standard`
  (`UiListMotion`). A change made on another screen (a Start on the book page) plays when the list
  is back on screen. Interruptible: an item reverses from the height it has.
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
  newer query is on its way the old list dims to 60 % over `standard` instead of emptying. Before
  the first answer one still ghost row (no shimmer) stands in. The far end of the list fades out
  under a mask.
- **Caret.** The lamp caret in the code input blinks in steps over `caret`, like a text caret.

## Later

- **Push to book detail** and back. #6 ships the book page without a transition: it replaces the
  page at once (its navigation starts on touch-down and its data is asked for then, so it is
  usually complete when it appears), and back returns to the kept-alive page at its old scroll
  position. A push with `standard` and a pop with `exit`, with the cover travelling from the list
  into the hero, is still open.

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

## Reduce Motion

`prefers-reduced-motion: reduce` sets every transition and animation to 1 ms in
`web/app/assets/css/main.css`, so sheets, menus and the keyboard lift appear and disappear in
place and the caret stops blinking. Nothing depends on an animation finishing. The search morph
is the one exception, as iOS does it: nothing travels or grows, the palette and the veil
cross-fade over the tab bar in place over `standard` (Web Animations, which the CSS rule does
not touch).

## Non-motions

No parallax, no bouncing or overshoot, no skeleton shimmer (thumbhashes and the search palette's
one quiet loading hint say "loading"), no page transitions between tabs, no animated theme change.

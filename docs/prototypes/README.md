# Prototypes: the hero cover (A11) and the Collections empty state (A13)

Static pages, nothing of the app changes. Each file is self-contained (inline CSS and JS, the app's
own fonts inlined, no network, no build): open it in a browser, on a phone for the gestures. The
colours, type, spacing, radii, shadows, durations and curves are the app's tokens, copied verbatim from
`web/app/assets/css/tokens.generated.css` (light and dark), and the utilities they use (`edge`,
`figures`, `eyebrow`, `book-title`, Reduce Motion) from `web/app/assets/css/main.css`. Everything
drawn with a dashed lamp-coloured border and mono type is prototype chrome (switches, notes), not
design. `index.html` links all six. Phone-size screenshots (390 × 844, at 2×) are in `shots/`; `shots/a11-answers.png` shows the answers panel as it opens on a page.

| Card | File | Variant |
|---|---|---|
| A11 | [a11-a-tilt.html](a11-a-tilt.html) | A · Tilt, no glint |
| A11 | [a11-b-tilt-glint.html](a11-b-tilt-glint.html) | B · Tilt + glint |
| A11 | [a11-c-glint.html](a11-c-glint.html) | C · Glint only, the cover never moves |
| A13 | [a13-a-glyph.html](a13-a-glyph.html) | (a) Glyph tile |
| A13 | [a13-b-bookends.html](a13-b-bookends.html) | (b) Bookends |
| A13 | [a13-c-cloth.html](a13-c-cloth.html) | (c) Cloth board |

---

## A11 · An interactive cover on the Book page hero

The Book page hero only (not a year in review, not the shelf): the cover in its lamp light, the
title under it, as `pages/book/[key].vue` draws it. Each page is a working prototype: press and drag
the cover. Its switches: **Reduce Motion** (simulated), **Dark**, **Placeholder cover**,
**touch-action** `pan-y` / `none`, **DeviceOrientation** (asks for permission on iOS), **▶ push: fly
in** (a stand-in for the cover's flight from a row into the hero, with the page's rise), **◀ Back with
the cover held** (a finger holds the cover's corner while Back is pressed), **ungated** (switches the
gate below off, to see the bug) and **measured box** (draws what `heroBoxOf()` would measure against
the cover's layout box, live). The status line shows the gate, whether the cover has a layer of its
own, and the last pointer event. The four answers are on each page too, under "The four answers".

**A · Tilt.** The cover leans under the finger (at most 8° at its edge, `perspective(700px)
rotateX/Y`): the touched side gives way, as a card pressed by a finger. It leans in over `instant`
(the Press duration) at the touch, follows the finger after that, and on release comes back to flat
over `standard` on the `standard` curve. The halo and the light pool behind the cover stay where they
are. [screenshot](shots/a11-a-tilt.png)

**B · Tilt + glint.** As A, plus a spot of the lamp's light (`lampGlow`: white on paper, amber in the
dark) on the leaning cover, under the finger; it fades in over `instant` and out over `exit` on the
`exit` curve. The glint is a layer next to the sheet, outside `[data-cover]`, so a flight's copy of
the sheet never carries it. [screenshot](shots/a11-b-tilt-glint.png), [dark](shots/a11-b-tilt-glint-dark.png)

**C · Glint only.** The cover never moves. Only the lamp's spot follows the finger 1:1 across it
and fades out over `exit` when the finger lifts. [screenshot](shots/a11-c-glint.png)

### 1 · Tap, drag, scroll on a phone

All three use `touch-action: pan-y` on the cover. A finger that starts on the cover and moves
vertically scrolls the page: the browser takes the pan, sends `pointercancel`, and the cover lets go
as on a release (springs back, or the glint fades). A move that starts sideways keeps the pointer,
and after that both axes follow the finger. A tap leans the cover towards the touched point over
`instant` and lets go on release. The hero cover has no tap action, so a tap does nothing else; if
it ever gets one (opening the cover large), a tap is "no more than 10 px of travel, under 300 ms".
A long press must not open the image's own menu: `-webkit-touch-callout: none`, `draggable="false"`
on the image (on a desktop an image drag also cancels the pointer). `touch-action: none` (a switch
on the pages) would make the cover a 140 × 210 dead zone for scrolling at the very top of the page,
where a scroll usually starts: rejected.

### 2 · Reduce Motion

Reduce Motion means nothing moves (docs/MOTION.md, Laws 4 and Reduce Motion): the interaction is
off in all three. No lean, no glint, no DeviceOrientation; the cover is a static picture and the page
scrolls from it like from anything else (`touch-action: auto`). It is not shortened to 1 ms as CSS
transitions are: a lean that jumps into place is still motion. The push is the cross-fade it already
is with Reduce Motion (▶ with the switch on).

### 3 · During the cover's flight

The push to a book aims at the hero: `aim()` measures the hero cover (or the loading page's
`data-flight-stand-in`) with `heroBoxOf()` (`useBookFlight.ts` ~271, used at ~648), which is
`getBoundingClientRect()` less `lifted()`: the page's rise, `m42` of the hero section's transform,
and nothing else. Back (`pop`, ~481) measures the hero the same way and copies it with
`coverCopy()`. A lean on the cover (A, B) changes the drawn box: a leaned 140 × 210 cover measures
about 1.5 px off its layout box at the most lean (see [measured box](shots/a11-a-tilt-measured-box.png)), and an
inline transform on the sheet would be cloned into the copy. The copy then starts or lands off the
cover's pixels, and the hand-over shows a jump. "ungated" on the pages shows both: ◀ starts the copy
from the leaned box; leaning the hero while it flies in (it is hidden, but still takes the pointer)
shows the lean appear at the landing.

**The gate:** `interactive = landed && !moving()`.

- *Armed* in `afterMotion()` (`utils/motion.ts`) once the flight has handed over: no
  `data-flight-hidden` on the hero, no `hold`/`keep` copy over it, `moving()` false. A press before
  that does nothing (and is not remembered).
- *Dropped* synchronously at the first sign of a departure, before anything is measured: the
  router's `beforeEach` that `pop` runs in (Back, the system's Back, iOS's edge swipe), Read now's
  reader flight (`utils/readerFlight.ts` measures the hero cover with `getBoundingClientRect()` too), and Change edition's cross-fade.
  Dropping cancels the gesture, the spring-back and the glint's fade, and removes the transform at
  once, with no animation (a flight is about to measure). The way to wire it: the cover registers
  itself as a mover (`addMover`) only while a gesture or its spring-back runs, and listens for a
  `flight:depart` the flight would emit before `heroBoxOf()`.
- C needs the gate only so no light moves under a copy in the air: nothing it draws changes the
  box or the copy, so dropping it is a fade to 0 with nothing to put back.

### 4 · Cost on a mid-range phone

- One write per frame (`transform` on the cover, `transform` and `opacity` on the glint),
  batched in `requestAnimationFrame`; no layout read per frame (the cover's box is read once, at the
  press). No layout, no repaint per frame: the moving parts have a layer of their own and are only
  composited.
- `will-change` policy: set at the press (so the first move does not pay for the promotion),
  removed when the spring-back or the fade has finished, as the flight keeps `will-change` only on
  the flying box. Nothing keeps a layer while the page sits.
- The spring-back and the fade are Web Animations, so the compositor runs them. The drag itself is
  driven from pointer events on the main thread, like the sheet's swipe and every finger-follow in
  the app: a busy main thread makes it lag, never stutter after release.
- **A:** one layer, the cover's size (about 420 × 630 px at 3×, ~1 MB), rasterised once at the
  press, 3D-transformed after that.
- **B:** A's layer plus the glint's (180 × 180 px, ~1.2 MB at 3×) inside a rounded clip, which the
  compositor does with a mask. Dearest.
- **C:** one small layer (the glint), 2D only; the cover is never promoted or repainted.
  **Cheapest.**

### Against docs/MOTION.md

| | A · Tilt | B · Tilt + glint | C · Glint only |
|---|---|---|---|
| Follow the finger (1:1) | Bent: nothing travels, so "1:1" is the lean following the finger's place on the cover, not a distance. Springs back on its enter curve, no overshoot. | Bent, as A | Kept: the light sits under the finger |
| Nothing moves for its own sake | Kept, with DeviceOrientation off | Kept, as A | Kept |
| No parallax (non-motions) | Kept: one layer | **Bent**: glint and cover move at different rates, two layers sliding against each other | Kept: one layer, no depth |
| Arrive slow, leave fast | Leans in over `instant`, back over `standard` | Glint out over `exit` | Glint out over `exit` |
| Reduce Motion | Off | Off | Off |

DeviceOrientation (a switch on the pages) is not recommended for any of them: a cover that leans
while the phone is only being held moves for its own sake, keeps a layer and a listener alive for as
long as the page is open, and needs a permission prompt on iOS.

### Recommendation: A

Tilt without glint, `touch-action: pan-y`, pointer only, gated on landed, off with Reduce Motion. It
is what was asked for (a cover you can handle), costs one layer only while touched, and bends only
the letter of "Follow the finger"; the cover's own halo is already the lamp. B's glint adds a second
layer and the nearest thing to parallax the app has, for a little shine. C is the cheapest and bends
nothing, but it is a light on the cover, not a cover in the hand.

**Decision needed:** A, B or C; and whether the interaction is worth a gate in `useBookFlight.ts`
(the departure signal) at all.

---

## A13 · The Collections row: a real empty state

Today (`components/collections/LibraryLink.vue`) the row shows a fan of up to three covers when there
are Collections with covers; with none, `<span class="empty">`: a 30 px 2:3 hairline outline, the bare
rectangle. The count is blank until `collections.loaded`. Each page shows its variant in every state,
in the light and the dark room, today's bare rectangle for comparison, and an empty Library for the
only-if-any decision. Switches: **↻ replay the load** (loading, then each state; the fan fades in over
the art), **Reduce Motion**, **count at zero** (nothing / "0" / "None"), **empty Library**
(only-if-any or always there) and **Collections there** (0, or 1 that is empty).

**(a) Glyph tile.** A new `collections` glyph in the icon set's language (24 grid, `icon` stroke,
round caps): the fan itself in outline, a cover and the edges of two behind it. `clothInk` on a 40 px
`cloth4` square with the `sm` radius. Reads as an icon: "this is where Collections are".
[light and dark](shots/a13-a-glyph-full.png)

**(b) Bookends.** Line art in `inkFaint`, the empty state's own language (the lamp over a shelf): a
hairline upright and two thin spines leaning on it, on the shelf's rule. No fill, no colour.
[light and dark](shots/a13-b-bookends-full.png)

**(c) Cloth board.** A 40 px square of `cloth2` in the Placeholder cover's language (CONTEXT.md,
Placeholder cover; `UiCover`'s cloth): the spine crease and hairline edge, the inset rule at 35 %
`clothInk`, and for its mark an empty shelf, the mark's hairline as the shelf with one book on it
and the dashed outline of the next one leaning beside it (the empty state's "outline of the next
one"). An empty Collections row reads as an empty shelf. [light and dark](shots/a13-c-cloth-full.png)

### The states (all three variants)

| State | Art | Count |
|---|---|---|
| Loading (`collections.loaded` false) | the variant's art, as at none | blank |
| None | the variant's art | **"0"** |
| Some, with covers | the fan of up to three covers, as today | the number |
| Some, none with a cover (all empty; today a bare rectangle and "2") | the variant's art | the number |

No bare rectangle in any state. What moves: only when the list arrives with covers, the fan fades in
over the art and the art fades out, over `standard`, in place (a cover fading in); nothing travels or
resizes. If the list arrives with none, only the count appears. With Reduce Motion it is a swap. The
row keeps its accessible name ("Collections" and the count) and the art stays `aria-hidden`, as the
fan is. The device keeps a copy of the list (`data/deviceLibrary.ts`), so loading shows only on a
device's first visit.

### Decisions

**Count at zero: "0".** The Library's segment tabs show their counts in the same `figures` caption,
"0" included; a word ("None") reads as copy where every other row has a figure, and nothing reads as
still loading. "0" also keeps the accessible name a fact: "Collections 0".

**only-if-any: keep it.** In an empty Library the empty state has one way forward, the search prompt
(DESIGN.md, `UiEmptyState`); a way into Collections there would be a second door into an empty room.
Collections are made on the Collections page (reached through this row) or from a Book's "Add to
collection", and the first Book is what fills an empty Library; once there is one, the row is there. With a real empty state the row no longer looks broken wherever it does show (a
Library with Books; an empty Library that has Collections, all of them empty, since putting a Book
on a Collection adds it to the Library). Where it shows in an empty Library it is there in the first
frame from the device's copy; on a first visit it should open like a `Reveal` (over `standard`, the
empty state gliding down), not pop in as it does today.

### Recommendation: (c) Cloth board

A cover-shaped object in the slot where the covers sit, so none and some read as the same shelf,
empty or full, and the cloth carries the colour the way covers do (DESIGN.md: the covers carry the
colour, the chrome stays ink). (a) is a good icon, but a filled icon tile is a pattern the app has
nowhere else (an iOS Settings look); (b) is the lightest and closest to the empty state's drawing,
but at 45 px the faint line art on `fill` reads as "not loaded yet", especially on paper.

**Decision needed:** (a), (b) or (c); "0" at zero; keep only-if-any (and open the row like a Reveal
when it appears late in an empty Library).

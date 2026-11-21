/**
 * Whether the tab bar is on this screen at all, and whether it is there at once
 * (`components/shell/TabBar.vue`).
 *
 * A screen that fills the room (`immersive`: Your shelf, a Book's chapter of Notes, a buddy read's
 * thread) has the bar out of the way for as long as it shows. It used to slide away over the new
 * screen's content — the thread's composer, the shelf's first row — because the bar was still resting
 * where the page it came from left it, and `away` then animated it out over `exit`. Entered from a tab
 * that is a flash of the old chrome over the new page; entered from a reload it was never drawn, since
 * nothing had to change to put it away. The same screen entered twice therefore looked like two
 * different screens.
 *
 * So an `immersive` screen draws it away from its first frame, with no transition in either direction:
 * the bar belongs to the screen being left, and it leaves with it.
 *
 * Hiding it as the member reads down a page that keeps the bar (`scrolledAway`) is still that page's
 * slide, and it comes back on a short scroll up: same screen, same bar.
 */
export type BarOnScreen = {
  /** Out of the way. */
  away: boolean
  /** Where it is at once: no transition into or out of this screen. */
  still: boolean
}

/**
 * The bar on this screen: `immersive` (fills the room: away at once), `scrolledAway` (the page hid it),
 * `searchOpen` and `morphing` (the palette is taking it over: where it rests, with no transition, for
 * the morph to measure).
 */
export function barOnScreen({
  immersive,
  scrolledAway,
  searchOpen,
  morphing,
}: {
  immersive: boolean
  scrolledAway: boolean
  searchOpen: boolean
  morphing: boolean
}): BarOnScreen {
  if (immersive) return { away: true, still: true }
  return { away: scrolledAway, still: searchOpen || morphing }
}

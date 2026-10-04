/**
 * Whether the tab bar is out of the way while a pushed screen scrolls (issue
 * #82, composables/useHideOnScroll.ts): it slides away while the member reads
 * down, comes back on a short scroll up, and is always there at the top and at
 * the very end of the page. Pure, so the arithmetic is tested without a
 * browser (tests/hide-on-scroll.test.ts).
 *
 * The scroll is read as intent, not as every pixel: a direction counts only
 * once it has gone `INTENT_PX` from where it started (the turning point), so
 * a finger resting on the glass or a page settling by a few pixels never
 * toggles the bar.
 */

/** How far a scroll has to go in one direction before the bar follows it. */
export const INTENT_PX = 10

export type BarScroll = {
  /** The bar is out of the way. */
  hidden: boolean
  /** Where the current direction started: the last turning point. */
  anchor: number
  /** The scroll position seen last. */
  last: number
}

/** The bar showing, the page standing at `y`. */
export function barShown(y: number): BarScroll {
  return { hidden: false, anchor: y, last: y }
}

/**
 * The page moved by itself (the router putting it in its place, a jump the
 * member did not make): nothing to read from it, the next scroll counts from `y`.
 */
export function barHeld(state: BarScroll, y: number): BarScroll {
  return { hidden: state.hidden, anchor: y, last: y }
}

/**
 * The bar after the page scrolled to `y`, of `end` (the furthest it scrolls).
 * At the top (or above it, iOS's rubber band) and at the end of the page it
 * shows; otherwise it hides once the page has gone `intent` px down from the
 * last turning point and shows once it has gone `intent` px up. A move longer
 * than `jump` in one event is not a finger (an anchor link, a restored place):
 * it only moves the anchor.
 */
export function barAfterScroll(state: BarScroll, y: number, end: number, intent = INTENT_PX, jump = Infinity): BarScroll {
  if (y <= intent || y >= end - intent) return barShown(y)
  if (Math.abs(y - state.last) > jump) return barHeld(state, y)
  // Turned around: the new direction counts from where it turned.
  const turned = (y > state.last && state.last < state.anchor) || (y < state.last && state.last > state.anchor)
  const anchor = turned ? state.last : state.anchor
  const travelled = y - anchor
  const hidden = travelled > intent ? true : travelled < -intent ? false : state.hidden
  return { hidden, anchor, last: y }
}

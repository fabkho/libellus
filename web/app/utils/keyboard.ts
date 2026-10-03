/**
 * The geometry behind following the iOS keyboard (composables/useKeyboardInset.ts,
 * components/ui/Sheet.vue, components/shell/SearchOverlay.vue). Pure, so a native port copies it and the tests pin it.
 */

/**
 * How much of the window the keyboard covers: the part of the layout viewport
 * the visual viewport neither shows nor has scrolled past. 0 without a visual
 * viewport (or with the keyboard down).
 */
export function keyboardInsetOf(windowHeight: number, viewport: { height: number; offsetTop: number } | null): number {
  if (!viewport) return 0
  return Math.max(0, Math.round(windowHeight - viewport.height - viewport.offsetTop))
}

/**
 * How far a bottom sheet goes up to sit on the keyboard. The sheet's own
 * bottom padding is for the home indicator, which the keyboard covers too, so
 * that part may go behind it.
 */
export function sheetLift(keyboard: number, bottomPadding: number): number {
  return keyboard > 0 ? Math.max(0, keyboard - bottomPadding) : 0
}

/**
 * How far a scroller has to scroll (px, + down) so an element inside it shows
 * whole, with `margin` around it — the least that does, like
 * `scrollIntoView({ block: 'nearest' })` but for this one scroller only. An
 * element taller than the scroller lines up with its top.
 */
export function revealDelta(
  scroller: { top: number; bottom: number },
  element: { top: number; bottom: number },
  margin = 0,
): number {
  const above = element.top - margin - scroller.top
  const below = element.bottom + margin - scroller.bottom
  if (above < 0) return above
  if (below > 0) return Math.min(below, above)
  return 0
}

/**
 * How far up the search palette goes to sit `gap` above the keyboard, from its
 * resting `bottom` (what `float-bottom` gives it). Never down, and not at all
 * with the keyboard down.
 */
export function paletteLift(keyboard: number, gap: number, resting: number): number {
  return keyboard > 0 ? Math.max(0, keyboard + gap - resting) : 0
}

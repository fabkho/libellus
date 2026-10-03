/**
 * A Rating is stored as integer quarters, 1–20 (SPEC.md): 15 is three and a
 * half stars. Pure, so the star display and a native port agree on every
 * quarter; tests/rating.test.ts pins them.
 */

/** Quarters → "3.75": always two decimals, so values line up in a column. Empty when unrated. */
export function ratingText(quarters: number | null | undefined): string {
  return quarters == null ? '' : (quarters / 4).toFixed(2)
}

/**
 * How far each of the five stars is filled, 0–1 of the star's own width. A
 * quarter star shows a quarter of the shape, not a quarter of its square: the
 * star spans x 3.4–20.6 on its 24-unit grid (components/ui/Stars.vue), so a
 * partial fill is mapped onto that span.
 */
export function starFills(quarters: number | null | undefined): number[] {
  return [0, 1, 2, 3, 4].map((i) => {
    const filled = Math.min(1, Math.max(0, ((quarters ?? 0) - i * 4) / 4))
    return filled === 0 ? 0 : filled === 1 ? 1 : (3.4 + 17.2 * filled) / 24
  })
}

// ------------------------------------------------------- the rating control

/** Where the star shape sits on its 24-unit grid (Stars.vue): x 3.4 to 20.6. */
const SHAPE_START = 3.4
const SHAPE_WIDTH = 17.2
const GRID = 24

/** The most quarters a Rating has: five stars. */
export const MAX_QUARTERS = 20

/**
 * Where a Rating's fill ends along a row of five stars `size` wide with `gap`
 * between them, in the same units: the edge of the lamp-coloured part, so the
 * control's thumb and the notch of each quarter sit exactly where the stars
 * fill to. 0 quarters is the left edge of the first star's shape.
 */
export function ratingX(quarters: number, size: number, gap: number): number {
  if (quarters <= 0) return (SHAPE_START / GRID) * size
  const star = Math.ceil(quarters / 4) - 1
  const filled = (quarters - star * 4) / 4
  return star * (size + gap) + ((SHAPE_START + SHAPE_WIDTH * filled) / GRID) * size
}

/**
 * The Rating under a finger dragged to `x`: the nearest quarter notch, 0–20.
 * 0 is no Rating (dragged off the left of the first star).
 */
export function quartersAt(x: number, size: number, gap: number): number {
  let nearest = 0
  for (let quarters = 1; quarters <= MAX_QUARTERS; quarters++) {
    if (Math.abs(ratingX(quarters, size, gap) - x) < Math.abs(ratingX(nearest, size, gap) - x)) nearest = quarters
  }
  return nearest
}

/** The Rating of a tap at `x`: the whole star under the finger, filled (4, 8 … 20). */
export function wholeStarsAt(x: number, size: number, gap: number): number {
  const star = Math.min(4, Math.max(0, Math.floor((x + gap / 2) / (size + gap))))
  return (star + 1) * 4
}

/** One quarter more or less, from the keyboard (arrow keys); stays within 0–20. */
export function stepQuarters(quarters: number | null, step: number): number {
  return Math.min(MAX_QUARTERS, Math.max(0, (quarters ?? 0) + step))
}

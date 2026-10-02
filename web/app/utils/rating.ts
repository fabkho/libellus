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

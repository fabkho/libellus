/**
 * The month rows of a year in review open with their covers a little apart
 * and press together (docs/MOTION.md, Month rows). The arithmetic, apart from
 * the page so a test can hold it.
 *
 * Regal's row has no entrance of its own. What there is, and what this takes
 * its feel from, is the pile's cascade (`staggerIn`, utils/stack/shuffle.ts): a
 * stagger of at most 40 ms per step inside a 500 ms budget, every Book easing
 * into its place. Here a month row is a step, and the easing and duration are
 * D's own `sheet` token (the long soft landing, 380 ms, next to Regal's 250–450
 * ms settles).
 */

/** Regal's `MAX_STAGGER` and `STAGGER_BUDGET`, in ms. */
export const MAX_STAGGER = 40
export const STAGGER_BUDGET = 500

/**
 * How much wider the covers stand at the start: each is shifted right by this
 * share of its distance from the start of the row, so a cover three places in
 * is 0.25 × 3 pitches (about 33 px) from where it will rest and the gap
 * between neighbours grows from 4 px to about 15. Small enough that the row
 * never leaves its column.
 */
export const SPREAD = 0.25

/** The delay of the nth row that starts together: 40 ms a row, 500 ms for all. */
export function rowDelay(index: number, count: number): number {
  const step = count > 1 ? Math.min(MAX_STAGGER, STAGGER_BUDGET / (count - 1)) : 0
  return index * step
}

/**
 * Where each cover starts, as a shift (px) from its resting place. `lefts` are
 * the covers' resting distances from the start of the row, so the first cover
 * of every line, when a row wraps, stays where it is.
 */
export function startOffsets(lefts: readonly number[], spread = SPREAD): number[] {
  return lefts.map((left) => Math.round(left * spread * 100) / 100)
}

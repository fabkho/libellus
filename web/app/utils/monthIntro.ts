/**
 * The month rows of a year in review open with their covers sliding in from
 * the right, one after another, as Books pushed onto a shelf (docs/MOTION.md,
 * Month rows). The numbers, apart from the page so a test can hold them.
 *
 * Regal's row has no entrance of its own. What there is, and what this takes
 * its feel from, is the pile's cascade (`staggerIn`, utils/stack/shuffle.ts): a
 * stagger of at most 40 ms per step inside a 500 ms budget. Here a month row is
 * a step, and so is each cover within it. The easing and duration are D's own
 * `sheet` token (the long soft landing, 380 ms).
 */

/** Regal's `MAX_STAGGER` and `STAGGER_BUDGET`, in ms. */
export const MAX_STAGGER = 40
export const STAGGER_BUDGET = 500

/** How far to the right (px) a cover starts from its resting place. */
export const SLIDE = 56

/** The most a row's covers wait for each other in all (ms), so a long row still lands together. */
export const COVER_BUDGET = 240

/** The delay of the nth row that starts together: 40 ms a row, 500 ms for all. */
export function rowDelay(index: number, count: number): number {
  const step = count > 1 ? Math.min(MAX_STAGGER, STAGGER_BUDGET / (count - 1)) : 0
  return index * step
}

/** The delay of the nth cover of a row: 40 ms a cover, 240 ms for all. */
export function coverDelay(index: number): number {
  return Math.min(index * MAX_STAGGER, COVER_BUDGET)
}

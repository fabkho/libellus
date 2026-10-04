/**
 * The physics of the progress wheel (issue #68, `components/progress/Wheel.vue`),
 * framework-free so it is tested in plain Node and a native port can copy it
 * (where the platform's own picker does not already do it).
 *
 * The wheel is a drum of whole numbers. Its position is a float in rows: 0 is
 * the first number at the centre, 1 the next, and so on. A finger drags it 1:1
 * (a row's height of travel is one number); past either end it gives way less
 * and less (`rubberBand`). Let go fast and it flings on, slowing exponentially,
 * as iOS and Android lists do, and lands exactly on a number: the landing row
 * is picked first (`flingTarget`) and the decay is aimed at it (`decayAt`), so
 * there is no second snap after the coast.
 */

/** How far a fling coasts, in ms of its release speed (the distance is speed × this). */
export const FLING_MS = 650
/**
 * The decay's time constant, ms: about 95 % of the way after three of these. The coast starts
 * a little faster than the finger let go (`FLING_MS` / `DECAY_MS`), as touch lists amplify a flick.
 */
export const DECAY_MS = 325
/** Below this speed (rows per ms) a release is a placement, not a fling: it snaps to the nearest row. */
export const FLING_MIN_SPEED = 0.006
/** How long a release's speed is measured over, ms. */
export const VELOCITY_WINDOW_MS = 90
/** The most a drag past an end can show, in rows. */
export const RUBBER_MAX_ROWS = 1.2
/** A press that moved less than this (px) and lasted less than `TAP_MS` is a tap. */
export const TAP_SLOP_PX = 8
export const TAP_MS = 350

/** A drag past an end gives way less the further it goes (never more than `RUBBER_MAX_ROWS`). */
export function rubberBand(position: number, last: number): number {
  if (position >= 0 && position <= last) return position
  const over = position < 0 ? -position : position - last
  const shown = RUBBER_MAX_ROWS * (1 - 1 / (1 + over / (RUBBER_MAX_ROWS * 2)))
  return position < 0 ? -shown : last + shown
}

/** The row a release lands on: where its speed carries it, whole, within the drum. */
export function flingTarget(position: number, speed: number, last: number): number {
  const coast = Math.abs(speed) < FLING_MIN_SPEED ? 0 : speed * FLING_MS
  return Math.min(Math.max(Math.round(position + coast), 0), last)
}

/** The time constant when the drum only follows a value set elsewhere (− / +, typing, a key), ms: quick. */
export const FOLLOW_MS = 70

/**
 * Where a coast from `from` to `to` is after `elapsed` ms, slowing with the time
 * constant `tau`; exactly `to` once it is within a hair of it.
 */
export function decayAt(from: number, to: number, elapsed: number, tau = DECAY_MS): number {
  const left = (to - from) * Math.exp(-elapsed / tau)
  return Math.abs(left) < 0.004 ? to : to - left
}

/** The value a position shows: the nearest row, within the drum. */
export function valueAt(position: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(position) + min, min), max)
}

/**
 * The speed of a drag, in rows per ms, from its recent samples (time stamp in ms,
 * position in rows): the travel over the last `VELOCITY_WINDOW_MS`. A finger that
 * stopped before letting go has no speed left.
 */
export function releaseSpeed(samples: readonly { t: number; at: number }[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
  if (recent.length < 2) return 0
  const first = recent[0]!
  const last = recent.at(-1)!
  const span = last.t - first.t
  return span > 0 ? (last.at - first.at) / span : 0
}

/** Which row a tap hit, relative to the centre (0 is the centre row, −1 the one above). */
export function tappedRow(offsetFromCentre: number, row: number): number {
  return Math.round(offsetFromCentre / row)
}

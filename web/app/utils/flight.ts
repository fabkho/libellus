/**
 * The arithmetic of the cover's flight between a list and the book page
 * (docs/MOTION.md, Push to a book): boxes, the FLIP transform, and where a
 * flight starts when it takes over from one going the other way. No DOM, so
 * it is tested on its own (tests/flight.test.ts); the motion itself is in
 * composables/useBookFlight.ts.
 */
import { timeAt } from './motion'

/** An element's box on screen, in CSS pixels from the viewport's top left. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function boxOf(rect: { left: number; top: number; width: number; height: number }): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** A book page's address: where a cover flies to. */
export function isBookPath(path: string): boolean {
  return /^\/book\/[^/]+$/.test(path)
}

/**
 * The transform (with `transform-origin: 0 0`) that draws an element laid out
 * at `at` over `look` instead: the "invert" of a FLIP. Translate, then scale,
 * so both interpolate linearly and the box in between is `lerpBox`.
 */
export function transformFrom(at: Box, look: Box): string {
  const x = look.left - at.left
  const y = look.top - at.top
  const sx = at.width ? look.width / at.width : 1
  const sy = at.height ? look.height / at.height : 1
  return `translate(${round(x)}px, ${round(y)}px) scale(${round(sx, 4)}, ${round(sy, 4)})`
}

/** The box `t` (0–1) of the way from `a` to `b`. */
export function lerpBox(a: Box, b: Box, t: number): Box {
  const mix = (x: number, y: number) => x + (y - x) * t
  return { left: mix(a.left, b.left), top: mix(a.top, b.top), width: mix(a.width, b.width), height: mix(a.height, b.height) }
}

/** Some of the box is on screen (a box with no size never is). */
export function onScreen(box: Box, viewport: { width: number; height: number }): boolean {
  if (box.width <= 0 || box.height <= 0) return false
  return box.top + box.height > 0 && box.top < viewport.height && box.left + box.width > 0 && box.left < viewport.width
}

/**
 * A flight goes towards the book page (`book`: a push) or back to the list
 * (`list`: a pop). Each of its parts — the cover's travel, the book page's
 * fade and rise, the list's fade — is a channel whose value says how far
 * towards the book page it is shown: 0 is the list as it was, 1 the book page.
 */
export type Towards = 'book' | 'list'

export interface Channels {
  cover: number
  book: number
  list: number
}

export const AT_LIST: Channels = { cover: 0, book: 0, list: 0 }
export const AT_BOOK: Channels = { cover: 1, book: 1, list: 1 }

/**
 * Where (ms into it) an animation of `duration` on `easing` starts so that it
 * shows a channel's `value` on its first frame: from the beginning for a
 * flight starting at rest, from the point already on screen for one that
 * turns another around (the search morph's rule, utils/motion.ts `timeAt`).
 */
export function startAt(value: number, towards: Towards, easing: string, duration: number): number {
  const progress = towards === 'book' ? value : 1 - value
  if (progress <= 0) return 0
  if (progress >= 1) return duration
  return duration * timeAt(easing, progress)
}

/** A channel's value from its animation's eased progress (`null`: not running → at its end). */
export function valueOf(progress: number | null | undefined, towards: Towards): number {
  const p = progress ?? 1
  return towards === 'book' ? p : 1 - p
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

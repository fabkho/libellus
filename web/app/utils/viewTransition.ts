/**
 * Helpers for the one View Transition the app runs (the push to the Profile and
 * back, plugins/profile-transition.client.ts). Framework-free.
 */

import { addMover } from './motion'

let running: Promise<void> | null = null
addMover(() => running !== null)

/** Marks a transition as running until `finished` settles (skipped counts as settled). */
export function holdWhileTransitioning(finished: Promise<unknown>): void {
  const settled: Promise<void> = finished.then(
    () => {},
    () => {},
  )
  running = settled
  void settled.then(() => {
    if (running === settled) running = null
  })
}

/**
 * Resolves once no View Transition is running (at once when none is). Work that
 * would land on the main thread while one plays waits for it: a store
 * applying an answer that came in meanwhile, which re-renders the page under
 * the transition's snapshot and holds up its frames on a phone.
 */
export function afterTransition(): Promise<void> {
  return running ?? Promise.resolve()
}

/** The slice of a group's keyframe this reads (width, height and transform as computed strings). */
type GroupFrame = { width?: string | number | null; height?: string | number | null; transform?: string | null; easing?: string }

/**
 * Turns a `::view-transition-group` animation from width/height + transform into
 * transform alone: the group stays at its end size and is scaled from the start
 * size, so the compositor runs it and a busy main thread (the new page being
 * set up) cannot make it stutter. The browser's own keyframes animate width and
 * height, which runs layout on the main thread every frame. The snapshots in the
 * group are images at 100 % of its width, so they scale exactly as before: the
 * same pixels on every frame. A group that keeps its size gets scale 1, its
 * move unchanged. The scale works from the group's top left corner: the groups
 * need `transform-origin: 0 0` (main.css; set there, not in the keyframes, where
 * it would keep the animation off the compositor). Chrome's View Transitions
 * Toolkit (`optimizeGroupAnimations`) does the same. Returns false and leaves the animation alone when its
 * keyframes are not the browser's two.
 */
export function scaleInsteadOfResize(effect: { getKeyframes(): GroupFrame[]; setKeyframes(frames: Keyframe[] | PropertyIndexedKeyframes): void }): boolean {
  const frames = effect.getKeyframes()
  if (frames.length !== 2) return false
  const [from, to] = frames as [GroupFrame, GroupFrame]
  const px = (value: GroupFrame['width']) => (typeof value === 'number' ? value : Number.parseFloat(value ?? ''))
  const box = (frame: GroupFrame) => {
    // Safari 18 leaves out a transform that is `none`.
    const matrix = new DOMMatrixReadOnly(frame.transform && frame.transform !== 'none' ? frame.transform : undefined)
    return { width: px(frame.width), height: px(frame.height), left: matrix.e, top: matrix.f }
  }
  const before = box(from)
  const after = box(to)
  if (![before.width, before.height, after.width, after.height].every((n) => Number.isFinite(n) && n > 0)) return false
  effect.setKeyframes([
    {
      transform: `translate(${before.left}px, ${before.top}px) scale(${before.width / after.width}, ${before.height / after.height})`,
      easing: from.easing ?? 'linear',
    },
    { transform: `translate(${after.left}px, ${after.top}px) scale(1, 1)` },
  ])
  return true
}

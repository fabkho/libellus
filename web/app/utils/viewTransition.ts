/**
 * Helpers for the one View Transition the app runs (the push to the Profile and
 * back, plugins/profile-transition.client.ts). Framework-free.
 */

import { addMover } from '#layers/ui/app/utils/motion'

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

/**
 * Resolves once every photo inside `scopes` is decoded (a decode that fails counts: the picture is what it is),
 * or after `limitMs`, whichever comes first, so a transition's new state is not taken with a photo still arriving.
 * Never rejects; resolves at once with nothing to wait for.
 */
export function imagesDecoded(scopes: Iterable<ParentNode>, limitMs: number): Promise<void> {
  const decoding: Promise<unknown>[] = []
  for (const scope of scopes) for (const image of scope.querySelectorAll('img')) decoding.push(image.decode().catch(() => {}))
  if (decoding.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const limit = setTimeout(resolve, limitMs)
    void Promise.all(decoding).then(() => {
      clearTimeout(limit)
      resolve()
    })
  })
}

/**
 * Whether the browser animated the Back it just did (iOS Safari's edge swipe: `popstate.hasUAVisualTransition`).
 * The popstate only says so; the router's guards, where the transition starts, come later, and a popstate the
 * router never navigates for (a history entry a sheet owns) has no guard at all. So the answer is taken once, and
 * only while fresh: one that was never taken must not stand in for the next navigation (a tap on the avatar
 * would then get no animation).
 */
export function createBrowserAnimation(now: () => number = () => performance.now(), staleMs = 1500) {
  let at: number | null = null
  const fresh = () => at !== null && now() - at <= staleMs
  return {
    /** A popstate came, with the browser's answer. */
    noted(animated: boolean) {
      at = animated ? now() : null
    },
    /** Whether the browser animated the Back now going on, the answer kept (for a second reader that comes before `take`). */
    peek(): boolean {
      return fresh()
    },
    /** Whether the navigation now starting is the one the browser animated; asking uses the answer up. */
    take(): boolean {
      const animated = fresh()
      at = null
      return animated
    },
  }
}

/** A box in viewport coordinates (what `getBoundingClientRect` gives). */
export type Rect = { left: number; top: number; width: number; height: number }

/**
 * `rect` if it can stand for an element the member sees: finite, with a size, and at least partly in the
 * viewport; else null (an element that is not drawn, or scrolled away).
 */
export function usableRect(rect: Rect, viewport: { width: number; height: number }): Rect | null {
  const { left, top, width, height } = rect
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  if (left + width <= 0 || top + height <= 0 || left >= viewport.width || top >= viewport.height) return null
  return { left, top, width, height }
}

/** The first of `elements` that is drawn on screen now, measured (viewport coordinates); null if none. */
export function visibleRect(elements: Iterable<Element>, viewport: { width: number; height: number }): Rect | null {
  for (const element of elements) {
    const box = element.getBoundingClientRect()
    const rect = usableRect({ left: box.left, top: box.top, width: box.width, height: box.height }, viewport)
    if (rect) return rect
  }
  return null
}

/**
 * The keyframes of the ring's group from the two boxes we measured ourselves, not from the browser's (WebKit's
 * group position and keyframes have been wrong with a scrolled page, and `getKeyframes()` of them is not to be
 * trusted): the group is laid out at the new box's size at the viewport's top left, so it starts at the old box's
 * place, scaled up or down by one factor (old width over new: both are round, so uniform), and ends at the
 * new box's place at scale 1. Null when either box is missing (not drawn, off screen): the caller keeps the browser's.
 */
export function groupKeyframes(from: Rect | null, to: Rect | null, easing = 'linear'): Keyframe[] | null {
  if (!from || !to || from.width <= 0 || to.width <= 0) return null
  const scale = from.width / to.width
  return [
    { transform: `translate(${from.left}px, ${from.top}px) scale(${scale}, ${scale})`, easing },
    { transform: `translate(${to.left}px, ${to.top}px) scale(1, 1)` },
  ]
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

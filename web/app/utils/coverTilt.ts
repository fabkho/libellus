/**
 * The Book page's hero cover leans under the finger (docs/MOTION.md, Hero cover; prototype A11 in
 * docs/prototypes/). Framework-free: `useCoverTilt` attaches it to a UiCover.
 *
 * - The finger's surface is UiCover's root, which never moves; what leans is the sheet
 *   (`[data-cover]`, the image or cloth without its glow), so the lamp light behind stays put.
 * - The cover turns to the finger: the touched side comes up towards it, at most `TILT_MAX_DEG`
 *   at the cover's edge, as in prototype A11. The lean comes in over `instant` (the Press duration) on the `standard` curve,
 *   then follows the finger frame by frame; on release (or when the page takes the scroll:
 *   `pointercancel`) it comes back to flat over `standard`, a Web Animation the compositor runs.
 * - Cost: one `transform` write per frame, batched in `requestAnimationFrame`; the root's box is
 *   read once, at the press. The sheet has `will-change: transform` from the press until it is flat
 *   again, and not otherwise: no layer is kept while the page sits.
 * - It never leans while anything moves (`moving()`: the cover's flight, its hand-over, a View
 *   Transition) or while the sheet is hidden for a copy flying in its place, and not at all with
 *   Reduce Motion. Whatever is about to measure the hero (the flight's Back, a push from the book
 *   page, Read now, Change edition) calls `stillCovers()` first: every leaning cover is put back
 *   flat at once, with no animation, so the box measured is the cover's own.
 */
import { durationToken, easingToken, moving, prefersReducedMotion, progressAt } from './motion'

/** The most the cover leans, at its edge (degrees). */
export const TILT_MAX_DEG = 8
/** The distance the lean is seen from (px): close enough that the near edge grows a little. */
export const TILT_PERSPECTIVE = 700

export interface Lean {
  /** Around the horizontal axis (degrees): negative brings the top edge near. */
  x: number
  /** Around the vertical axis (degrees): negative brings the right edge near. */
  y: number
}

export const FLAT: Lean = { x: 0, y: 0 }

/** The lean for a finger at (`x`, `y`) over a cover drawn in `box`: the touched side comes up towards it; past the edge it leans no further. */
export function leanAt(box: { left: number; top: number; width: number; height: number }, x: number, y: number, max = TILT_MAX_DEG): Lean {
  if (!box.width || !box.height) return FLAT
  const clamp = (value: number) => Math.min(1, Math.max(-1, value))
  const across = clamp(((x - box.left) / box.width) * 2 - 1)
  const down = clamp(((y - box.top) / box.height) * 2 - 1)
  // `+ 0`: the middle of the cover is flat, never a negative zero.
  return { x: down * max + 0, y: -across * max + 0 }
}

/** The CSS transform that draws a lean. */
export function leanTransform(lean: Lean): string {
  return `perspective(${TILT_PERSPECTIVE}px) rotateX(${lean.x.toFixed(3)}deg) rotateY(${lean.y.toFixed(3)}deg)`
}

/** `from` on its way to `to`, `progress` (0–1) of the way. */
export function between(from: Lean, to: Lean, progress: number): Lean {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
}

/** Whether a press may lean the cover now. */
export function mayLean(state: { reduced: boolean; moving: boolean; hidden: boolean }): boolean {
  return !state.reduced && !state.moving && !state.hidden
}

/** The covers leaning now (pressed, or coming back to flat), each with what puts it back at once. */
const leaning = new Set<() => void>()

/** Puts every leaning cover back flat at once, with no animation: called before anything measures a hero cover. */
export function stillCovers() {
  for (const still of [...leaning]) still()
}

/** Attaches the lean to a UiCover's root; returns what detaches it (and puts the cover back). */
export function attachCoverTilt(root: HTMLElement): () => void {
  /** The finger down: its pointer, the cover's box and the lean's way in (read once, at the press). */
  let gesture: { id: number; box: DOMRect; from: Lean; target: Lean; start: number; ramp: number; curve: string } | null = null
  /** What the screen shows (while the finger is down; flat once it has let go). */
  let shown: Lean = FLAT
  let spring: { animation: Animation; from: Lean } | null = null
  let frame = 0

  const sheet = () => root.querySelector<HTMLElement>(':scope > [data-cover]')

  function draw(now: number) {
    frame = 0
    const target = sheet()
    if (!gesture || !target) return
    const time = (now - gesture.start) / gesture.ramp
    shown = between(gesture.from, gesture.target, progressAt(gesture.curve, time))
    target.style.transform = leanTransform(shown)
    if (time < 1) schedule()
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  /** The lean an interrupted spring-back shows now. */
  function springing(): Lean {
    if (!spring) return shown
    const progress = spring.animation.effect?.getComputedTiming().progress ?? 1
    return between(spring.from, FLAT, progress)
  }

  function still() {
    gesture = null
    cancelAnimationFrame(frame)
    frame = 0
    spring?.animation.cancel()
    spring = null
    shown = FLAT
    const target = sheet()
    if (target) {
      target.style.transform = ''
      target.style.willChange = ''
    }
    leaning.delete(still)
  }

  function press(event: PointerEvent) {
    if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return
    const target = sheet()
    const hidden = !target || target.hasAttribute('data-flight-hidden') || target.style.visibility === 'hidden'
    if (!mayLean({ reduced: prefersReducedMotion(), moving: moving(), hidden })) return
    const from = springing()
    spring?.animation.cancel()
    spring = null
    const box = root.getBoundingClientRect()
    const ramp = durationToken('instant') || 1
    const curve = easingToken('standard')
    gesture = { id: event.pointerId, box, from, target: leanAt(box, event.clientX, event.clientY), start: performance.now(), ramp, curve }
    shown = from
    target!.style.willChange = 'transform'
    target!.style.transform = leanTransform(from)
    leaning.add(still)
    // A mouse keeps the cover while it leaves it (a touch is captured by the browser already).
    try {
      root.setPointerCapture(event.pointerId)
    } catch {
      // The pointer is already gone.
    }
    schedule()
  }

  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return
    gesture.target = leanAt(gesture.box, event.clientX, event.clientY)
    schedule()
  }

  function release(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return
    gesture = null
    cancelAnimationFrame(frame)
    frame = 0
    const target = sheet()
    if (!target) return still()
    const from = shown
    shown = FLAT
    target.style.transform = ''
    const animation = target.animate([{ transform: leanTransform(from) }, { transform: leanTransform(FLAT) }], {
      duration: durationToken('standard'),
      easing: easingToken('standard'),
    })
    spring = { animation, from }
    animation.finished.then(
      () => {
        if (spring?.animation !== animation) return
        spring = null
        target.style.willChange = ''
        leaning.delete(still)
      },
      () => {},
    )
  }

  /** Android's long press opens the image's menu (and cancels the pointer): not while the cover can lean. */
  function menu(event: Event) {
    if (!prefersReducedMotion()) event.preventDefault()
  }

  root.addEventListener('pointerdown', press)
  root.addEventListener('pointermove', move)
  root.addEventListener('pointerup', release)
  root.addEventListener('pointercancel', release)
  root.addEventListener('lostpointercapture', release)
  root.addEventListener('contextmenu', menu)
  return () => {
    still()
    root.removeEventListener('pointerdown', press)
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerup', release)
    root.removeEventListener('pointercancel', release)
    root.removeEventListener('lostpointercapture', release)
    root.removeEventListener('contextmenu', menu)
  }
}

/**
 * Motion tokens for code that animates with the Web Animations API (the search
 * morph). The values are read back from the CSS variables tokens.generated.css
 * defines, so JavaScript never carries its own copy of a duration or a curve
 * (docs/MOTION.md, Tokens).
 */

function cssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * A CSS time (`250ms`, `.25s`) in milliseconds; 0 for anything else. The
 * tokens are written in milliseconds, but the production build's CSS minifier
 * (Lightning CSS) rewrites each time in its shortest form, so the shipped
 * stylesheet says `.25s`: read without its unit that was a quarter of a
 * millisecond, and every animation timed by a token finished in one frame.
 */
export function parseDuration(value: string): number {
  const match = /^(-?[\d.]+(?:e-?\d+)?)(ms|s)$/i.exec(value.trim())
  if (!match) return 0
  const amount = Number.parseFloat(match[1]!)
  if (!Number.isFinite(amount)) return 0
  return match[2]!.toLowerCase() === 's' ? amount * 1000 : amount
}

/** `--duration-<name>` in milliseconds (`overlay-exit` → 240), whichever unit the stylesheet writes it in. */
export function durationToken(name: string): number {
  return parseDuration(cssVariable(`--duration-${name}`))
}

/** `--ease-<name>` as a CSS timing function (`sheet` → `cubic-bezier(0.32, 0.72, 0, 1)`). */
export function easingToken(name: string): string {
  return cssVariable(`--ease-${name}`) || 'linear'
}

/** Reduce Motion is on: motion becomes a cross-fade (docs/MOTION.md, Reduce Motion). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** How many halvings `timeAt` takes: far below a frame on any duration. */
const BISECTION_STEPS = 24

/**
 * The time (0–1) at which a `cubic-bezier()` easing reaches `progress` (0–1):
 * the curve read backwards. An interrupted animation is replaced by one with
 * another curve or length that has to start where the old one was, so its
 * start time is looked up from the progress already shown. Assumes the curve
 * only ever goes forwards (no overshoot), true of every easing token.
 */
export function timeAt(easing: string, progress: number): number {
  const points = /cubic-bezier\(([^)]+)\)/.exec(easing)?.[1]?.split(',').map(Number)
  if (!points || points.length !== 4 || points.some(Number.isNaN)) return progress
  const [x1, y1, x2, y2] = points as [number, number, number, number]
  const bezier = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  let low = 0
  let high = 1
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2
    if (bezier(y1, y2, middle) < progress) low = middle
    else high = middle
  }
  return bezier(x1, x2, (low + high) / 2)
}

/**
 * How far (0–1) a `cubic-bezier()` easing has gone at `time` (0–1): the curve
 * read forwards, for a motion driven frame by frame from script (the hero
 * cover's lean as it presses in) rather than by the Web Animations API.
 */
export function progressAt(easing: string, time: number): number {
  const t = Math.min(1, Math.max(0, time))
  const points = /cubic-bezier\(([^)]+)\)/.exec(easing)?.[1]?.split(',').map(Number)
  if (!points || points.length !== 4 || points.some(Number.isNaN)) return t
  const [x1, y1, x2, y2] = points as [number, number, number, number]
  const bezier = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  let low = 0
  let high = 1
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2
    if (bezier(x1, x2, middle) < t) low = middle
    else high = middle
  }
  return bezier(y1, y2, (low + high) / 2)
}

// ------------------------------------------------------ waiting for motion

/** Things that move on their own clock (the cover's flight, the Profile's View Transition): each says whether it is moving now. */
const movers = new Set<() => boolean>()
/** The longest `afterMotion` waits (ms): a flight that never seems to end (a hero's image that never decodes) does not hold work back for good. */
const MOTION_PATIENCE = 1500

/** Registers something that moves (`afterMotion` waits for it); returns what unregisters it. */
export function addMover(moving: () => boolean): () => void {
  movers.add(moving)
  return () => movers.delete(moving)
}

/** Whether anything is moving now: a registered mover, or a page waiting to be placed (`data-moving` on the document, app/router.options.ts). */
export function moving(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-moving')) return true
  for (const mover of movers) if (mover()) return true
  return false
}

/**
 * Resolves once nothing moves (at once when nothing does), in a task of its
 * own after that frame. Main-thread work that can wait (a refreshed list
 * applied, a measurement) waits for it, so it does not land on a frame of the
 * cover's flight, its hand-off or a View Transition, which on a phone shows as
 * a hitch.
 */
export function afterMotion(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function' || !moving()) return Promise.resolve()
  const since = performance.now()
  return new Promise((resolve) => {
    const check = () => {
      if (moving() && performance.now() - since < MOTION_PATIENCE) requestAnimationFrame(check)
      else setTimeout(resolve, 0)
    }
    requestAnimationFrame(check)
  })
}

/**
 * A change that waits for the motion to end: `apply` is called with the value once nothing
 * moves (at once when nothing does), and a value that arrives while an earlier one still
 * waits replaces it, so only the newest is ever applied. For what arrives late and would
 * open its room under a cover in flight (the Book page's series line and Goodreads' rating
 * landing on the hero's rise), so the two never move at once.
 */
export function followAfterMotion<T>(apply: (value: T) => void): (value: T) => void {
  let latest = 0
  return (value) => {
    const mine = ++latest
    void afterMotion().then(() => {
      if (mine === latest) apply(value)
    })
  }
}

/**
 * Motion tokens for code that animates with the Web Animations API (the search
 * morph). The values are read back from the CSS variables tokens.generated.css
 * defines, so JavaScript never carries its own copy of a duration or a curve
 * (docs/MOTION.md, Tokens).
 */

function cssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** `--duration-<name>` in milliseconds (`overlay-exit` → 240). */
export function durationToken(name: string): number {
  return Number.parseFloat(cssVariable(`--duration-${name}`)) || 0
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

/**
 * „UI frozen“ watchdog (README „Sentry“): a timer that asks for a tick every second. While the main thread is
 * blocked the tick cannot run; when it runs again, a gap far above one second is how long the screen did not
 * react. Nothing else is measured, and nothing about her goes along (the plugin adds only the duration and the
 * route pattern).
 *
 * A gap is only a freeze when the main thread really was busy. The same gap shows up when the phone sleeps or the
 * installed app is suspended (timers stop, `performance.now()` keeps counting) and Android does not always fire
 * `visibilitychange` for that (production 1.30.2: „UI frozen for 227 s“ on a locked Android). So:
 *  - a hidden page, and any sleep signal since the last tick (`freeze`/`resume`, `pagehide`/`pageshow`, `blur`/`focus`,
 *    `visibilitychange`) resets the clock;
 *  - where the browser has long tasks / long animation frames (Chrome, Edge, Android), a gap counts only when long
 *    work covers at least half of it (`longWork`);
 *  - where it has not (iOS Safari, Firefox: `longWork` returns `undefined`) there is no proof, so the rule is
 *    time only: a gap above `MAX_PLAUSIBLE_MS` (60 s) is sleep, everything from 5 s up to that is reported.
 *
 * A silence is not proof of health: the project had no `UIFrozen` event in the 90 days to 2026-11, which is also what a
 * reporter that never fires looks like. So `sentryInit.ts` arms a development-only probe, `window.__uiFrozenProbe()`,
 * that sends one synthetic freeze through the same reporter the watch calls (docs/OPERATIONS.md, „Sentry“).
 */
export const FROZEN_MS = 5_000
export const WATCH_TICK_MS = 1_000
/** A block longer than this without proof of long work is sleep, not a freeze. */
export const MAX_PLAUSIBLE_MS = 60_000
/** Share of the gap that long tasks / frames must cover for a gap to count where they can be measured. */
export const MIN_COVERAGE = 0.5
/** Per page load, so one bad screen cannot flood the quota. */
export const MAX_REPORTS = 3

/**
 * The sentence an event carries for a block of `blockedMs` beyond the tick, so „UI frozen for 5 s“ is a five-second
 * block and never 1.001 s more.
 */
export function frozenMessage(blockedMs: number): string {
  return `UI frozen for ${Math.round(blockedMs / 1000)} s (more than ${FROZEN_MS / 1000} s)`
}

/**
 * What a freeze sends, as plain values: the level, the fingerprint, the tags, the extra and the exception's type and
 * message. Framework-free, so a test drives the reporter's own rule in plain Node (tests/sentry.test.ts) and the
 * development probe (`window.__uiFrozenProbe()`) sends exactly what a real freeze sends.
 *
 * Every value here is the one in the Sentry history (fingerprint `ui-frozen`): it must not change, or the issues stop
 * grouping and the old ones are lost.
 */
export interface FrozenEvent {
  level: 'warning'
  fingerprint: ['ui-frozen']
  tags: { 'ui.frozen': 'true'; route: string }
  extra: { blockedMs: number }
  exception: { type: 'UIFrozen'; value: string }
}

/** The event for a freeze of `blockedMs` beyond the tick, on `route` (the router's pattern, `/book/:id`). */
export function frozenEvent(blockedMs: number, route: string): FrozenEvent {
  return {
    level: 'warning',
    fingerprint: ['ui-frozen'],
    tags: { 'ui.frozen': 'true', route: route || 'unknown' },
    extra: { blockedMs },
    exception: { type: 'UIFrozen', value: frozenMessage(blockedMs) },
  }
}

export interface FrozenWatchEnv {
  now: () => number
  /** Calls `fn` about every `ms`; returns the stop. */
  every: (fn: () => void, ms: number) => () => void
  /**
   * Calls `fn` whenever the page may have slept or changed position: visibility, `freeze`/`resume`,
   * `pagehide`/`pageshow`, `blur`/`focus`; returns the stop.
   */
  onVisibility: (fn: () => void) => () => void
  isVisible: () => boolean
  /**
   * Milliseconds of long tasks / long animation frames overlapping [from, to], or `undefined` where the browser has
   * no such API (iOS Safari).
   */
  longWork?: (from: number, to: number) => number | undefined
}

/** Starts the watch; `report(ms)` fires for each freeze of at least `FROZEN_MS`. Returns the stop. */
export function watchFrozen(report: (blockedMs: number) => void, env: FrozenWatchEnv): () => void {
  let last = env.now()
  let reported = 0
  const reset = () => {
    last = env.now()
  }
  const stopVisibility = env.onVisibility(reset)
  const stopTimer = env.every(() => {
    const now = env.now()
    const gap = now - last
    last = now
    const blocked = gap - WATCH_TICK_MS
    if (!env.isVisible() || blocked < FROZEN_MS || reported >= MAX_REPORTS) return
    const work = env.longWork?.(now - gap, now)
    if (work === undefined) {
      if (blocked > MAX_PLAUSIBLE_MS) return
    } else if (work < blocked * MIN_COVERAGE) return
    reported += 1
    report(Math.round(blocked))
  }, WATCH_TICK_MS)
  return () => {
    stopTimer()
    stopVisibility()
  }
}

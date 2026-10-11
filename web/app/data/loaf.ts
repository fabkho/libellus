/**
 * Long animation frames (LoAF) that stuttered on the member's device, as
 * reports for the client error log (kind `vitals`, like the Core Web Vitals in
 * data/vitals.ts): `LoAF 312 ms on /library`, with what made the frame long,
 * in the stack's place. Chromium measures them (`PerformanceObserver` type
 * `long-animation-frame`); WebKit and Firefox do not, and there nothing is
 * reported. plugins/vitals.client.ts observes them once the app is idle.
 *
 * Only a frame of POOR_LOAF ms or more is reported, after the first
 * BOOT_IGNORED_MS of the page (the start is measured separately), never while the
 * document is hidden, at most ROUTE_MAX per route and SESSION_MAX per page life,
 * and one per culprit (the same script in the same route is the same stutter).
 *
 * Technical details only: the route as its pattern (`/book/:key`), scripts by
 * their function and chunk path (query and fragment dropped, another host by its
 * host only), the id of an invoking element dropped; never an element or text.
 * The error log scrubs and cuts what it is given once more.
 *
 * Framework-free: entries come in as the browser hands them over (only the fields
 * read here), the route and the origin are handed in.
 */
import { describeResource, POOR_LOAF } from './vitalsBasics'

/** Frames in the first moments of a page are the start's; it is measured on its own. */
export const BOOT_IGNORED_MS = 3000
/** At most this many reports for one route during the page's life. */
export const LOAF_ROUTE_MAX = 3
/** At most this many reports during the page's life. */
export const LOAF_SESSION_MAX = 10
/** Scripts named in a report, the longest first. */
export const SCRIPTS_MAX = 3

/** The parts of a `PerformanceLongAnimationFrameTiming` a report is made of. */
export type LoafEntry = {
  startTime: number
  duration: number
  renderStart?: number
  styleAndLayoutStart?: number
  blockingDuration?: number
  firstUIEventTimestamp?: number
  scripts?: readonly LoafScript[]
}

export type LoafScript = {
  duration: number
  invoker?: string
  invokerType?: string
  sourceURL?: string
  sourceFunctionName?: string
}

/** The browser can observe long animation frames. */
export function loafSupported(observer: { supportedEntryTypes?: readonly string[] } | undefined): boolean {
  return Boolean(observer?.supportedEntryTypes?.includes('long-animation-frame'))
}

/** A frame that is reported: long enough, not the start's. */
export function isPoorFrame(entry: Pick<LoafEntry, 'startTime' | 'duration'>): boolean {
  return entry.duration >= POOR_LOAF && entry.startTime >= BOOT_IGNORED_MS
}

const ms = (value: number) => `${Math.round(value)} ms`
const positive = (value: number | undefined) => (typeof value === 'number' && value > 0 ? value : null)

/** An invoker as the report names it: a script's address by its path, an element's id dropped (`BUTTON#b-42.onclick`). */
export function describeInvoker(invoker: string | undefined, origin: string): string {
  if (!invoker) return '(unnamed)'
  if (/^(https?|blob|data):/i.test(invoker)) return describeResource(invoker, origin)
  return invoker.replace(/#[^.\s]*/g, '').slice(0, 80) || '(unnamed)'
}

/** One script as the report names it: `invoker (function) from /_nuxt/abc.js 123 ms`. */
export function describeScript(script: LoafScript, origin: string): string {
  const name = script.sourceFunctionName ? ` (${script.sourceFunctionName.slice(0, 60)})` : ''
  return `${describeInvoker(script.invoker, origin)}${name} from ${describeResource(script.sourceURL, origin)} ${ms(script.duration)}`
}

/** The page's own load stages, as `navigation` timing has them (0 while it has not got there). */
export type LoadTimes = { domInteractive: number; domContentLoadedEventStart: number; domComplete: number }

/** Where the page was in loading at `time`, in web-vitals' words. */
export function loadStateAt(time: number, nav: LoadTimes | undefined): string {
  if (!nav || !nav.domInteractive || time < nav.domInteractive) return 'loading'
  if (!nav.domContentLoadedEventStart || time < nav.domContentLoadedEventStart) return 'dom-interactive'
  if (!nav.domComplete || time < nav.domComplete) return 'dom-content-loaded'
  return 'complete'
}

/** What the user was doing in the frame: an event's type, `navigation`, or nothing known. */
function duringOf(entry: LoafEntry, navigated: boolean): string | null {
  if (navigated) return 'navigation'
  // The event's own time, from before the frame began (it waited for the main thread): set only for a frame that handled one.
  if (positive(entry.firstUIEventTimestamp) === null) return null
  const listener = (entry.scripts ?? []).find((script) => script.invokerType === 'event-listener' && script.invoker)
  const type = listener?.invoker?.match(/\.on([a-z]+)$/i)?.[1]?.toLowerCase()
  return type ? `interaction (${type})` : 'interaction'
}

export type LoafContext = {
  route: string | null
  origin: string
  /** Load state at the frame (`loadStateAt`). */
  loadState: string
  /** The route changed while the frame ran. */
  navigated?: boolean
}

/** The culprit of a frame: the same script (function and chunk) in the same route is one stutter. */
export function loafCulprit(entry: LoafEntry, { route, origin }: Pick<LoafContext, 'route' | 'origin'>): string {
  const top = longestScripts(entry)[0]
  const where = top ? `${top.sourceFunctionName ?? ''}@${describeResource(top.sourceURL, origin)}` : 'no script'
  return `${route ?? '(unknown route)'}|${where}`
}

const longestScripts = (entry: LoafEntry) => [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, SCRIPTS_MAX)

/** What the error log gets for a long frame (`LoAF 312 ms on /library`, its parts line by line), null for one that is not reported. */
export function loafReport(entry: LoafEntry, context: LoafContext): { message: string; detail: string } | null {
  if (!isPoorFrame(entry)) return null
  const message = `LoAF ${ms(entry.duration)} on ${context.route ?? '(unknown route)'}`
  const end = entry.startTime + entry.duration
  const lines: string[] = []
  const blocking = entry.blockingDuration
  if (typeof blocking === 'number') lines.push(`blocking: ${ms(blocking)}`)
  const render = positive(entry.renderStart)
  if (render !== null) lines.push(`render: ${ms(Math.max(0, end - render))}`)
  const style = positive(entry.styleAndLayoutStart)
  if (style !== null) lines.push(`style/layout: ${ms(Math.max(0, end - style))}`)
  const scripts = longestScripts(entry)
  if (scripts.length) {
    lines.push('scripts:')
    for (const script of scripts) lines.push(`  ${describeScript(script, context.origin)}`)
  } else {
    lines.push('scripts: (none)')
  }
  const during = duringOf(entry, Boolean(context.navigated))
  if (during) lines.push(`during: ${during}`)
  lines.push(`load state: ${context.loadState}`)
  return { message, detail: lines.join('\n') }
}

/**
 * Keeps the reports in bounds: per route, per page life, one per culprit.
 * `take` says whether a frame may be reported and counts it if so.
 */
export function createLoafGate(routeMax = LOAF_ROUTE_MAX, sessionMax = LOAF_SESSION_MAX) {
  const perRoute = new Map<string, number>()
  const seen = new Set<string>()
  let total = 0
  return {
    take(route: string | null, culprit: string): boolean {
      const key = route ?? ''
      if (total >= sessionMax || seen.has(culprit) || (perRoute.get(key) ?? 0) >= routeMax) return false
      seen.add(culprit)
      perRoute.set(key, (perRoute.get(key) ?? 0) + 1)
      total++
      return true
    },
  }
}

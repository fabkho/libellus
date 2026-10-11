import { createLoafGate, isPoorFrame, loadStateAt, loafCulprit, loafReport, loafSupported, type LoafEntry } from '~/data/loaf'
import { reportError } from '~/composables/useErrorLog'

/**
 * Long animation frames (stutters) into the client error log, as `vitals` rows
 * (data/loaf.ts, docs/OPERATIONS.md "Web Vitals"). Started by
 * plugins/vitals.client.ts once the app is idle; the observer reads the frames
 * the browser buffered, so a stutter between the start and then counts too.
 * Where the browser cannot observe them (WebKit, Firefox) nothing happens.
 *
 * `routeAt` names the route at a time (performance time), by its pattern.
 */
export function observeLoaf(routeAt: (time: number | null) => string | null): void {
  try {
    if (typeof PerformanceObserver === 'undefined' || !loafSupported(PerformanceObserver)) return
    const gate = createLoafGate()
    const origin = window.location.origin
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as LoafEntry[]) {
        try {
          if (document.visibilityState === 'hidden' || !isPoorFrame(entry)) continue
          const route = routeAt(entry.startTime)
          if (!gate.take(route, loafCulprit(entry, { route, origin }))) continue
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
          const report = loafReport(entry, {
            route,
            origin,
            loadState: loadStateAt(entry.startTime, nav),
            navigated: routeAt(entry.startTime + entry.duration) !== route,
          })
          if (report) reportError('vitals', report.message, { stack: report.detail, route })
        } catch {
          // Never an error of its own.
        }
      }
    })
    observer.observe({ type: 'long-animation-frame', buffered: true })
  } catch {
    // Not observable here: nothing to measure with.
  }
}

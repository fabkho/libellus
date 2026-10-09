import { createRouteTimeline, routePattern } from '~/data/routeTimeline'
import type { ElementLike, VitalMetric } from '~/data/vitals'
import { reportError, useErrorLog } from '~/composables/useErrorLog'

/**
 * Poor Web Vitals into the client error log, with their culprit (data/vitals.ts,
 * docs/OPERATIONS.md, kind `vitals`). Google's `web-vitals` (its attribution
 * build) is loaded once the app is idle, in its own chunk, so it is never in
 * the way of the start: its observers read the buffered entries, so what
 * happened before it arrived counts too. Soft navigations are measured on their
 * own where the browser can tell them apart (Chrome), like Cloudflare's Web
 * Analytics does; elsewhere a metric spans the page's whole life.
 *
 * Only a poor value is reported, once per metric and navigation, on the route
 * where its culprit happened (the largest shift, the slowest interaction, the
 * largest paint), named by its pattern. The error log batches, folds, scrubs and
 * sends it like any error; in development it is printed and sent only when
 * sending is on (composables/useErrorLog.ts).
 */
export default defineNuxtPlugin({
  name: 'vitals',
  dependsOn: ['error-log'],
  setup(nuxtApp) {
    const router = useRouter()
    const timeline = createRouteTimeline()
    const patternOf = (path: string) => {
      try {
        const record = router.resolve(path).matched.at(-1)
        return record ? routePattern(record.path) : path
      } catch {
        return path
      }
    }
    timeline.visit(patternOf(window.location.pathname), 0)
    router.afterEach((to) => timeline.visit(routePattern(to.matched.at(-1)?.path ?? to.path), performance.now()))

    const reported = new Set<string>()
    function take(vitals: typeof import('~/data/vitals'), metric: VitalMetric & { navigationId?: number }) {
      const { culpritTime, vitalReport } = vitals
      try {
        const key = `${metric.name}:${metric.navigationId ?? 0}`
        if (reported.has(key)) return
        const route = timeline.at(culpritTime(metric))
        const report = vitalReport(metric, { route, origin: window.location.origin })
        if (!report) return
        reported.add(key)
        reportError('vitals', report.message, { stack: report.detail, route })
        // Reported as the page goes away (web-vitals reports then): sent now, while it still can be.
        if (document.visibilityState === 'hidden') void useErrorLog().flush()
      } catch {
        // Never an error of its own.
      }
    }

    async function start() {
      try {
        // Both off the start: web-vitals and what makes reports of it.
        const [{ onCLS, onINP, onLCP }, vitals] = await Promise.all([import('web-vitals/attribution'), import('~/data/vitals')])
        const options = {
          reportSoftNavs: true,
          // Named by tag, classes and test id, never by text (data/vitals.ts).
          generateTarget: (node: Node | null) => vitals.describeElement(node as ElementLike | null) || undefined,
        }
        // Only the fields data/vitals.ts reads; web-vitals' own types are wider.
        const handle = (metric: unknown) => take(vitals, metric as VitalMetric & { navigationId?: number })
        onCLS(handle, options)
        onINP(handle, options)
        onLCP(handle, options)
        // Stutters (long animation frames) where the browser reports them (composables/useLoaf.ts).
        void import('~/composables/useLoaf').then(({ observeLoaf }) => observeLoaf((time) => timeline.at(time))).catch(() => {})
      } catch {
        // No chunk (offline, a deploy replaced it): nothing to measure with this time.
      }
    }

    nuxtApp.hook('app:mounted', () => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void start(), { timeout: 5000 })
      else setTimeout(() => void start(), 2000)
    })
  },
})

/**
 * Loads and starts Sentry. Imported dynamically by plugins/sentry.client.ts and only when a DSN is set, so a build
 * without one never fetches this chunk (nor the SDK in it). The scrubber and the rules live in `sentryScrub.ts` /
 * `sentryConfig.ts`.
 */
import type { NuxtApp } from '#app'
import type { Router } from 'vue-router'
import { browserTracingIntegration, captureException, getClient, init, withScope } from '@sentry/nuxt'
import { DENIED_URLS, IGNORED_ERRORS, TRACES_SAMPLE_RATE } from './sentryConfig'
import { clickPath, deviceContexts, scrubEvent } from './sentryScrub'
import { FROZEN_MS, frozenEvent, watchFrozen } from './uiFrozen'

export interface SentryStart {
  dsn: string
  environment: string
  /** The app's version (`version.txt`); '' leaves the release unset. */
  release: string
}

export function startSentry(nuxtApp: NuxtApp, { dsn, environment, release }: SentryStart) {
  // Browser and system by name and version, the kind of device: read once, the User-Agent itself never goes out.
  const device = deviceContexts(navigator.userAgent)
  init({
    dsn,
    environment,
    release: release || undefined,
    // No person, no IP, no cookies/headers from the SDK itself; `scrubEvent` removes what is left.
    sendDefaultPii: false,
    // SDK 11 collects by default what `sendDefaultPii` used to guard (user, IP inference by Sentry, cookies,
    // headers, bodies, query strings): every switch off. `scrubEvent` is the second lock.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // No session replay (not installed) and no feedback widget.
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // Supabase and the other services sit on other origins: a `sentry-trace` header would need their CORS
    // to allow it and would break the request. Spans of those calls are still recorded (status, duration).
    tracePropagationTargets: [],
    ignoreErrors: IGNORED_ERRORS,
    denyUrls: DENIED_URLS,
    beforeSend: (event) => scrubEvent(event, device),
    beforeSendTransaction: (event) => scrubEvent(event, device),
    // A tap's breadcrumb names where it landed by tag names and test ids only (`clickPath`); Sentry's own path
    // (ids, classes, a label) never leaves, `scrubEvent` drops any other.
    beforeBreadcrumb: (crumb, hint) => {
      if (crumb.category === 'ui.click') crumb.message = clickPath((hint?.event as Event | undefined)?.target)
      return crumb
    },
  })
  const client = getClient()
  if (!client) return

  // `routeLabel: 'route'`: „/members/:id“ instead of the address with her friend's id in it.
  const router = (nuxtApp as { $router?: Router }).$router
  if (router) client.addIntegration(browserTracingIntegration({ router, routeLabel: 'route' }))

  // Vue's errors come through Nuxt's `vue:error` hook. Sentry's Vue integration is not installed on purpose: it
  // attaches the component's props (a message's text, a name) to the event.
  nuxtApp.hook('vue:error', (error, _instance, info) => {
    withScope((scope) => {
      scope.setTag('vue.info', String(info))
      captureException(error)
    })
  })
  nuxtApp.hook('app:error', (error) => captureException(error))

  // Unhandled promise rejections and `window.onerror` are the SDK's default integrations (GlobalHandlers).

  // „UI frozen“: README „Sentry“.
  // Long tasks / long animation frames prove a real block (uiFrozen.ts); without the API (iOS Safari) the
  // watchdog falls back to its time-only rule.
  const longWork = observeLongWork()
  // The reporter itself, apart from the watch: what a real freeze sends, and what the development probe below sends
  // through the same function, so what is proven is this path and not a copy of it.
  const reportFrozen = (blockedMs: number) => {
    const event = frozenEvent(blockedMs, router?.currentRoute.value.matched.at(-1)?.path ?? 'unknown')
    withScope((scope) => {
      scope.setLevel(event.level)
      scope.setFingerprint(event.fingerprint)
      scope.setTag('ui.frozen', event.tags['ui.frozen'])
      scope.setTag('route', event.tags.route)
      scope.setExtra('blockedMs', event.extra.blockedMs)
      // An exception with its own type and value: a message with a synthetic stack was titled by a minified
      // function name („Os“). The stack points at this reporter, not at the block, so it goes.
      const error = new Error(event.exception.value)
      error.name = event.exception.type
      error.stack = undefined
      captureException(error, { mechanism: { type: 'ui-frozen', handled: true } })
    })
  }
  // Development only, stripped from a build (`import.meta.dev` is `false` there, so this branch goes): a way to prove
  // the reporter before a real freeze ever happens, which is the only way to tell „no freeze on this phone“ from „the
  // reporter never fires“ (docs/OPERATIONS.md, „Sentry“).
  //
  // It exists only where Sentry runs at all (no `if (!client) return` above, so no DSN means no probe) and it sends
  // through `reportFrozen`, the function the watcher calls. What it proves: the level, the fingerprint `ui-frozen`, the
  // tags, the text, the mechanism, the scrubber and the DSN, all the way to the project. What it does not: the watch's
  // own rules (the tick, sleep signals, long-work coverage, the cap), which `tests/sentry.test.ts` pins instead.
  if (import.meta.dev) {
    const probe = (blockedMs: number = FROZEN_MS) => {
      // Below the threshold nothing would ever be reported, so the probe refuses to invent a freeze under it.
      const claimed = Math.max(FROZEN_MS, Math.round(blockedMs))
      reportFrozen(claimed)
      return claimed
    }
    ;(window as unknown as { __uiFrozenProbe?: typeof probe }).__uiFrozenProbe = probe
  }
  watchFrozen(
    reportFrozen,
    {
      now: () => performance.now(),
      every: (fn, ms) => {
        const id = setInterval(fn, ms)
        return () => clearInterval(id)
      },
      onVisibility: (fn) => {
        const targets: [EventTarget, string][] = [
          [document, 'visibilitychange'], [document, 'freeze'], [document, 'resume'],
          [window, 'pagehide'], [window, 'pageshow'], [window, 'blur'], [window, 'focus'],
        ]
        for (const [target, name] of targets) target.addEventListener(name, fn)
        return () => { for (const [target, name] of targets) target.removeEventListener(name, fn) }
      },
      isVisible: () => document.visibilityState === 'visible',
      longWork,
    },
  )
}

/** Collects long tasks and long animation frames; returns how much of a window they cover, or undefined if unsupported. */
function observeLongWork(): ((from: number, to: number) => number | undefined) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined
  const types = (PerformanceObserver.supportedEntryTypes ?? []).filter((t) => t === 'long-animation-frame' || t === 'longtask')
  if (!types.length) return undefined
  let entries: { start: number; end: number }[] = []
  const keep = (list: PerformanceEntryList) => {
    for (const e of list) entries.push({ start: e.startTime, end: e.startTime + e.duration })
    if (entries.length > 200) entries = entries.slice(-100)
  }
  const observer = new PerformanceObserver((list) => keep(list.getEntries()))
  // Prefer frames (long-animation-frame) and fall back to long tasks: both would double count.
  observer.observe({ type: types.includes('long-animation-frame') ? 'long-animation-frame' : 'longtask' })
  return (from, to) => {
    keep(observer.takeRecords())
    let covered = 0
    for (const e of entries) covered += Math.max(0, Math.min(e.end, to) - Math.max(e.start, from))
    return covered
  }
}

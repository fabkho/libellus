/**
 * The routes the app went through and when (performance time), so a report can
 * name the screen something happened on rather than the one the app is on when
 * it is reported (plugins/vitals.client.ts: a layout shift on the Library is
 * reported as the page goes away, maybe from a Book). Routes by their pattern
 * (`/book/:key`), never a Book's id. Framework-free and small: it runs from the
 * start, while the rest of the vitals code waits until the app is idle.
 */

/** The route patterns the app went through, with when (performance time), to name where a culprit happened. */
export function createRouteTimeline(max = 50) {
  const stops: { at: number; route: string }[] = []
  return {
    /** The app is now on `route`. */
    visit(route: string, at: number) {
      if (stops.at(-1)?.route === route) return
      stops.push({ at, route })
      if (stops.length > max) stops.shift()
    },
    /** The route the app was on at `time`; the current one without a time, null before any. */
    at(time: number | null): string | null {
      if (time === null) return stops.at(-1)?.route ?? null
      let found: string | null = stops[0]?.route ?? null
      for (const stop of stops) {
        if (stop.at > time) break
        found = stop.route
      }
      return found
    },
  }
}

/** A route record's path as the report names it: Nuxt's `/book/:key()` is `/book/:key`. */
export function routePattern(path: string): string {
  return path.replace(/\(\)/g, '').replace(/\(\.\*\)\*?/g, '*') || '/'
}

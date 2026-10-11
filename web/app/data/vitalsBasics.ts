/**
 * The two parts of data/vitals.ts that data/loaf.ts (the stutter reports, loaded on its own) shares with it.
 * They live here so loaf.ts does not import data/vitals.ts: the vitals plugin loads that module with a
 * dynamic `import()`, and a module that is also imported statically gets a namespace object built by
 * the bundler's `__exportAll` helper, which sits in a shared chunk of papaparse, the import store and the
 * barcode scanner, so the sign-in screen fetched all of it at idle (docs/perf/bundle.md, F2).
 * vitals.ts re-exports both: nothing that imports it changes.
 */

/**
 * In ms: a frame (script, style, layout, paint) that took this long is a stutter
 * the member felt; reported as `LoAF` (data/loaf.ts), not one of the three Core Web Vitals.
 */
export const POOR_LOAF = 200

/**
 * A resource as the report names it: same-origin, its path (a chunk, the app's
 * own picture); elsewhere its host only, since a cover's address names the book.
 */
export function describeResource(url: string | undefined, origin: string): string {
  if (!url) return '(none)'
  try {
    const parsed = new URL(url, origin)
    if (parsed.protocol === 'data:') return 'data: URL'
    if (parsed.protocol === 'blob:') return 'blob: URL'
    return parsed.origin === origin ? parsed.pathname : parsed.host
  } catch {
    return '(unreadable)'
  }
}

/**
 * The engine on its own, built like production (minified, split, hashed), to
 * measure what the reader costs: the lazy chunk's size and the time from "Read
 * now" to the first page. The entry only fetches the book; the engine is a
 * dynamic import, exactly as Reader.vue loads it. Driven by
 * scripts/measure.mjs (Playwright, phone profile: 412 × 915, CPU 4× slower).
 */
import { DEFAULT_SETTINGS } from '../settings'

declare global {
  interface Window {
    __open: (url: string, at: number | null) => Promise<unknown>
  }
}

window.__open = async (url, at) => {
  const blob = await (await fetch(url)).blob()
  const file = new File([blob], url.split('/').pop() ?? 'book.epub', { type: 'application/epub+zip' })
  const startedAt = performance.now()
  const { openReader } = await import('../engine')
  const importedAt = performance.now()
  const engine = await openReader(document.getElementById('host')!, file, {
    handlers: { relocate() {}, tap() {}, scroll() {}, swipe() {} },
    layout: { flow: 'paginated', animated: false, gap: 0.075, margin: 34, maxColumns: 1, maxInlineSize: 640 },
    settings: DEFAULT_SETTINGS,
    colors: { surface: '#f4f0e9', ink: '#1c1915', inkMuted: 'rgb(28 25 21 / 0.64)', accent: '#b8782a', hairline: 'rgb(40 30 20 / 0.17)', scheme: 'light' },
    at,
    startedAt,
    importedAt,
  })
  // A page turn, timed too.
  const turnAt = performance.now()
  await engine.next()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return { ...engine.timings, turnMs: performance.now() - turnAt, sections: engine.view.book.sections.length, title: engine.title }
}

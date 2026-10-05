/**
 * Time-to-cover in a scrolled search list (issue #63): Chromium on a phone-sized
 * viewport, the network throttled to DevTools' "Fast 4G", the browser cache
 * off, live search APIs and cover CDNs. Not a test — a measurement to compare
 * before and after a change.
 *
 * For each query it signs a throwaway member in (removed again at the end),
 * opens search, types the query and, once the list has settled, scrolls it to
 * its far end at a steady pace. Every frame it notes, per result row, when the
 * row first came into the list's view and when its cover image had loaded (or
 * that the Placeholder shows), and it sums the layout shifts while scrolling.
 *
 *   # the app on :3066 against the local stack (see docs/covers.md)
 *   cd web && pnpm tsx scripts/cover-timing.ts [--base http://localhost:3066] [--runs 2] [--out /tmp/libellus-63/timing.json]
 */
import { writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { signUpMember } from '../tests/support/member'
import { sweepRun } from '../tests/support/stack'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback
}
const BASE = flag('base', 'http://localhost:3066')
const RUNS = Number(flag('runs', '2'))
const OUT = flag('out', '/tmp/libellus-63/timing.json')
const QUERIES = flag('queries', 'der zauberberg|fourth wing|pride and prejudice|im westen nichts neues').split('|')

/** DevTools' "Fast 4G" preset (Chrome 1xx): 9 Mbps down, 1.5 Mbps up, 60 ms × 2.75 latency. */
const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (1.5 * 1024 * 1024) / 8 * 0.9 }

/** Pixels per scroll step and the pause between steps: a thumb flicking slowly through the list. */
const SCROLL_STEP = 240
const SCROLL_PAUSE_MS = 300
/** How long a visible row may wait for its cover before it counts as not loaded. */
const SETTLE_MS = 4000

process.env.LIBELLUS_TEST_RUN ??= 'covertiming'

type RowTiming = { key: string; src: string | null; visibleAt: number | null; loadedAt: number | null; placeholder: boolean }
type Measure = { query: string; run: number; firstResultsAt: number; scrollStartAt: number; rows: RowTiming[]; cls: number }

/**
 * Runs in the page: every frame, which rows are in view and which covers have
 * loaded. A string, not a function: tsx would wrap a function in helpers the
 * page does not have.
 */
const INSTRUMENT = `(() => {
  const rows = new Map()
  let cls = 0
  let firstResultsAt = 0
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value
  }).observe({ type: 'layout-shift', buffered: true })
  const tick = () => {
    const list = document.querySelector('[data-testid="search.results"]')
    if (list) {
      if (!firstResultsAt) firstResultsAt = performance.now()
      const bounds = list.getBoundingClientRect()
      for (const link of list.querySelectorAll('[data-testid="search.result"]')) {
        const key = link.getAttribute('href') || ''
        const row = rows.get(key) || { key, src: null, visibleAt: null, loadedAt: null, placeholder: false }
        rows.set(key, row)
        const box = link.getBoundingClientRect()
        const inView = box.bottom > bounds.top && box.top < bounds.bottom && box.bottom > 0 && box.top < innerHeight
        if (inView && row.visibleAt === null) row.visibleAt = performance.now()
        const image = link.querySelector('[data-cover] img')
        row.src = (image && (image.currentSrc || image.getAttribute('src'))) || row.src
        row.placeholder = Boolean(link.querySelector('[data-cover] .cloth'))
        if (image && image.complete && image.naturalWidth > 1 && row.loadedAt === null) row.loadedAt = performance.now()
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.__covers = () => ({ rows: [...rows.values()], cls, firstResultsAt })
  // Layout shifts count from the scroll on: the list growing while sources answer is not the covers' doing.
  window.__scrolling = () => { cls = 0 }
})()`

async function measure(page: Page, query: string, run: number): Promise<Measure> {
  await page.goto(BASE)
  await page.getByTestId('home.title').waitFor()
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill(query)
  await page.getByTestId('search.result').first().waitFor({ timeout: 30_000 })
  // Let every source answer (the list grows while they do).
  await page.waitForFunction(() => document.querySelector('[data-testid="search.results"]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 30_000 })
  await page.waitForTimeout(2500)
  // The keyboard would be down by now on a phone: blur the query.
  await page.getByTestId('search.query').blur()
  const list = page.getByTestId('search.results')
  const box = (await list.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const scrollStartAt = await page.evaluate(() => {
    ;(window as unknown as { __scrolling: () => void }).__scrolling()
    return performance.now()
  })
  let last = Number.NaN
  for (let step = 0; step < 80; step++) {
    // A reversed list: its far end is up.
    await page.mouse.wheel(0, -SCROLL_STEP)
    await page.waitForTimeout(SCROLL_PAUSE_MS)
    const top = await list.evaluate((el) => el.scrollTop)
    if (top === last) break
    last = top
  }
  await page.waitForTimeout(SETTLE_MS)
  const result = (await page.evaluate(() => (window as unknown as { __covers: () => unknown }).__covers())) as Omit<Measure, 'query' | 'run' | 'scrollStartAt'>
  return { query, run, scrollStartAt, ...result }
}

const member = await signUpMember()
const session: Record<string, string> = {}
// The member's session, as supabase-js keeps it, goes into the page's localStorage.
{
  const { data } = await member.client.auth.getSession()
  const ref = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321').hostname.split('.')[0]
  session[`sb-${ref}-auth-token`] = JSON.stringify(data.session)
}

const browser = await chromium.launch()
const measures: Measure[] = []
try {
  for (let run = 1; run <= RUNS; run++) {
    for (const query of QUERIES) {
      const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2.625, isMobile: true, locale: 'de-DE' })
      await context.addInitScript({
        content: `for (const [key, value] of Object.entries(${JSON.stringify(session)})) localStorage.setItem(key, value)`,
      })
      await context.addInitScript({ content: INSTRUMENT })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', FAST_4G)
      try {
        measures.push(await measure(page, query, run))
        process.stdout.write(`run ${run} · ${query}: ${measures.at(-1)!.rows.length} rows\n`)
      } catch (error) {
        process.stdout.write(`run ${run} · ${query}: failed (${(error as Error).message.split('\n')[0]})\n`)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
  await sweepRun()
}

writeFileSync(OUT, JSON.stringify(measures, null, 2))

// ------------------------------------------------------------------ the report

const sorted = (values: number[]) => [...values].sort((a, b) => a - b)
const at = (values: number[], q: number) => (values.length ? Math.round(sorted(values)[Math.min(values.length - 1, Math.floor(values.length * q))]!) : NaN)
const host = (src: string | null) => (!src ? 'none' : /mzstatic/.test(src) ? 'apple' : /openlibrary|archive\.org/.test(src) ? 'openlibrary' : 'other')

function summarise(label: string, list: Measure[]) {
  const rows = list.flatMap((m) => m.rows.filter((r) => r.visibleAt !== null))
  const withImage = rows.filter((r) => r.src)
  const waits = withImage.filter((r) => r.loadedAt !== null).map((r) => Math.max(0, r.loadedAt! - r.visibleAt!))
  const never = withImage.filter((r) => r.loadedAt === null).length
  const slow = waits.filter((w) => w > 1000).length
  const instant = waits.filter((w) => w === 0).length
  const cls = Math.max(...list.map((m) => m.cls))
  return `| ${label} | ${rows.length} | ${withImage.length} | ${rows.filter((r) => r.placeholder).length} | ${instant} | ${at(waits, 0.5)} | ${at(waits, 0.9)} | ${slow} | ${never} | ${cls.toFixed(3)} |`
}

const lines = [
  `Fast 4G, cache off, ${RUNS} run(s) × ${QUERIES.length} queries, scroll ${SCROLL_STEP} px every ${SCROLL_PAUSE_MS} ms.`,
  '',
  '| scope | rows seen | with an image | Placeholder | cover before row seen | median wait ms | p90 wait ms | > 1 s | not loaded | max CLS |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...QUERIES.map((q) => summarise(q, measures.filter((m) => m.query === q))),
  ...['apple', 'openlibrary'].map((h) =>
    summarise(`all · ${h}`, measures.map((m) => ({ ...m, rows: m.rows.filter((r) => host(r.src) === h) }))),
  ),
  summarise('all', measures),
]
console.log(`\n${lines.join('\n')}`)
writeFileSync(OUT.replace(/\.json$/, '.md'), `${lines.join('\n')}\n`)

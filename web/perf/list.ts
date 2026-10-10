/**
 * The long lists, measured: DOM nodes, style recalculation, layout, long frames, for the Library's
 * segments (mount, switch, scroll to the end) and for typing in search, on a Library of any size.
 * The numbers behind "does this list need windowing?" (docs/perf/client-1-startup.md, F-3).
 *
 *   pnpm perf:list                                  slow4g-4x, 5 runs
 *   pnpm perf:list --runs 7 --label entries-1000    the label names the result file (.data/perf/<label>/list.json)
 *   PERF_ENTRIES=1000 pnpm perf:seed                first: the Library's size
 *
 * Per step, in the order a session meets them (steps run on one warm page, so the DOM grows as it
 * does for a member): `ready` is tap → the list's first row visible; `style`/`layout`/`script` are
 * CDP's Performance.getMetrics deltas over the step; `nodes` the document's node count after it;
 * `frames>50` and `worst` the requestAnimationFrame gaps; `LoAF` the Long Animation Frames. Medians.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { launch, memberSession, netLog, newContext, PROFILES, throttle } from './browser'
import { appUrl } from './env'
import { median, metricsDelta, spread, windowStats, type Snapshot } from './measure'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'slow4g-4x' },
    runs: { type: 'string', default: '5' },
    label: { type: 'string', default: 'list' },
    /** Only these steps (ids). */
    only: { type: 'string', default: '' },
  },
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const repoRoot = new URL('../..', import.meta.url).pathname

type Step = { id: string; label: string; act: (page: import('@playwright/test').Page, cdp: import('@playwright/test').CDPSession) => Promise<void>; ready?: string; settle?: number }
const tap = (page: import('@playwright/test').Page, testid: string, nth = 0) => page.getByTestId(testid).nth(nth).tap({ timeout: 20000 })
const scrollToBottom = async (page: import('@playwright/test').Page, cdp: import('@playwright/test').CDPSession) => {
  let last = -1
  let still = 0
  for (let i = 0; i < 400 && still < 3; i++) {
    await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 600, yDistance: -1800, speed: 4000, gestureSourceType: 'touch', preventFling: true })
    const y = await page.evaluate(() => Math.round(window.scrollY))
    still = y === last ? still + 1 : 0
    last = y
  }
}

const STEPS: Step[] = [
  { id: 'l1-library-mount', label: 'Home → Library (the segment she was in)', act: (p) => tap(p, 'shell.tab.library'), ready: 'library.entry' },
  { id: 'l2-finished', label: 'Library → Finished (the longest segment)', act: (p) => tap(p, 'library.segment.finished'), ready: 'library.year', settle: 1200 },
  { id: 'l3-finished-scroll', label: 'Finished: scroll to the end', act: scrollToBottom, settle: 800 },
  { id: 'l4-scroll-up', label: 'Finished: scroll back to the top', act: (p) => p.evaluate(() => window.scrollTo({ top: 0 })).then(() => sleep(600)), settle: 600 },
  { id: 's1-search-open', label: 'Search: open', act: (p) => tap(p, 'shell.tab.search'), ready: 'search.query', settle: 800 },
  {
    id: 's2-search-type',
    label: 'Search: type "piranesi"',
    act: async (p) => {
      await p.getByTestId('search.query').pressSequentially('piranesi', { delay: 90 })
    },
    ready: 'search.result',
    settle: 1500,
  },
  // Her own Books are matched on the device: "the" is in most titles of the seeded Library.
  { id: 's3-search-own', label: 'Search: "the" (her own Books match widely)', act: async (p) => void (await p.getByTestId('search.query').fill('the')), ready: 'search.ownResult', settle: 2500 },
]

async function main() {
  const profile = PROFILES[args.profile!]!
  const runs = Number(args.runs)
  const only = new Set(args.only!.split(',').filter(Boolean))
  const load = loadavg().map((l) => Math.round(l * 100) / 100)
  console.log(`\n== list, ${profile.name}, ${runs} runs, load average at start ${load.join(' ')}`)
  const browser = await launch(profile)
  const rows: Record<string, { ready: number[]; style: number[]; layout: number[]; script: number[]; nodes: number[]; imgs: number[]; covers: number[]; over50: number[]; worst: number[]; loafN: number[]; loafMs: number[]; loafMax: number[]; rows: number[] }> = {}
  for (let run = 1; run <= runs; run++) {
    const context = await newContext(browser, profile, await memberSession())
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const net = await netLog(page, cdp)
    await cdp.send('Performance.enable')
    await throttle(cdp, profile)
    await page.goto(appUrl(profile.engine) + '/')
    await page.getByTestId('home.title').waitFor({ timeout: 30000 })
    await sleep(2500)
    const snapshot = async () => page.evaluate(() => {
      const p = (window as unknown as { __perf: Omit<Snapshot, 'now'> }).__perf
      return { ...p, frames: [...p.frames], now: performance.now() } as Snapshot
    })
    const metrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
      const { metrics } = await cdp.send('Performance.getMetrics')
      return Object.fromEntries(metrics.map((m) => [m.name, m.value])) as Record<string, number>
    }
    const quiet = async (ms = 600, cap = 15000) => {
      const t0 = Date.now()
      let since = Date.now()
      while (Date.now() - t0 < cap) {
        if (net.inFlight() > 0) since = Date.now()
        else if (Date.now() - since >= ms) return
        await sleep(100)
      }
    }
    for (const step of STEPS) {
      if (only.size && !only.has(step.id)) continue
      try {
        await sleep(300)
        const before = await metrics()
        const base = await snapshot()
        const from = base.now
        await page.evaluate(() => void ((window as unknown as { __perf: { sampling: boolean } }).__perf.sampling = true))
        const t0 = Date.now()
        await step.act(page, cdp)
        if (step.ready) await page.getByTestId(step.ready).first().waitFor({ state: 'visible', timeout: 20000 })
        const ready = Date.now() - t0
        await sleep(step.settle ?? 1000)
        await quiet()
        const snap = await snapshot()
        await page.evaluate(() => void ((window as unknown as { __perf: { sampling: boolean } }).__perf.sampling = false))
        const after = await metrics()
        const stats = windowStats({ ...snap, frames: snap.frames.slice(base.frames.length) }, from, snap.now)
        const d = metricsDelta(before, after)
        const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, imgs: document.images.length, rows: document.querySelectorAll('[data-testid="library.entry"]').length, own: document.querySelectorAll('[data-testid="search.ownResult"]').length }))
        const row = (rows[step.id] ??= { ready: [], style: [], layout: [], script: [], nodes: [], imgs: [], covers: [], over50: [], worst: [], loafN: [], loafMs: [], loafMax: [], rows: [] })
        row.ready.push(ready)
        row.style.push(d.styleMs)
        row.layout.push(d.layoutMs)
        row.script.push(d.scriptMs)
        row.nodes.push(dom.nodes)
        row.imgs.push(dom.imgs)
        row.covers.push(net.entries.filter((e) => e.at >= t0 && e.host === 'covers').length)
        row.rows.push(dom.rows)
        row.over50.push(stats.frames?.over50 ?? 0)
        row.worst.push(stats.frames?.worstMs ?? 0)
        row.loafN.push(stats.loaf.n)
        row.loafMs.push(stats.loaf.totalMs)
        row.loafMax.push(stats.loaf.maxMs)
        console.log(`  run ${run} ${step.id.padEnd(20)} ready ${ready} ms  nodes ${dom.nodes}  rows ${dom.rows}  own ${dom.own}  covers ${net.entries.filter((e) => e.at >= t0 && e.host === 'covers').length}  style ${d.styleMs} layout ${d.layoutMs} script ${d.scriptMs} ms  frames>50 ${stats.frames?.over50 ?? 0} worst ${stats.frames?.worstMs ?? 0}  loaf ${stats.loaf.n}/${stats.loaf.maxMs} ms`)
      } catch (e) {
        console.log(`  run ${run} ${step.id} failed: ${(e as Error).message.split('\n')[0]}`)
        await page.goto(appUrl(profile.engine) + '/').catch(() => {})
        await sleep(2000)
      }
    }
    await context.close()
  }
  await browser.close()
  const cell = (xs: number[]) => `${Math.round(median(xs))}${spread(xs) > 0.15 ? '~' : ''}`
  console.log(`\n${profile.name}, ${runs} runs, load average at start ${load.join(' ')}, medians (~ = spread above 15 %)\n`)
  console.log('| step | ready ms | DOM nodes | Library rows | `<img>` | cover requests | style ms | layout ms | script ms | frames>50 | worst frame ms | LoAF n | LoAF max ms |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const step of STEPS) {
    const r = rows[step.id]
    if (r) console.log(`| ${step.label} | ${cell(r.ready)} | ${cell(r.nodes)} | ${cell(r.rows)} | ${cell(r.imgs)} | ${cell(r.covers)} | ${cell(r.style)} | ${cell(r.layout)} | ${cell(r.script)} | ${cell(r.over50)} | ${cell(r.worst)} | ${cell(r.loafN)} | ${cell(r.loafMax)} |`)
  }
  const out = join(repoRoot, '.data/perf', args.label!)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'list.json'), JSON.stringify({ profile: profile.name, runs, load, rows }))
}
await main()

/**
 * Perf harness: runs the scripted journeys on the production build and saves what it measured.
 *
 *   pnpm perf                                  all profiles, 5 runs each, prints the table
 *   pnpm perf --profile slow4g-4x --runs 7     one profile
 *   pnpm perf --journey start,tabs             some journeys (start, tabs, book, search, profile)
 *   pnpm perf --cpuprofile                     also save a V8 CPU profile of every step (.cpuprofile; perf/cpuprofile.py)
 *   pnpm perf --trace                          also save a Chrome trace of every step (perf/analyse.py)
 *
 * Needs the stack, the seed, the build and the server (perf/README.md: pnpm perf:up does all
 * four). Raw results: .data/perf/<label>/<profile>.json (gitignored); `pnpm perf:report <dir>`
 * prints them again as tables.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, totalmem } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { BrowserContext, CDPSession, Page } from '@playwright/test'
import { launch, memberSession, netLog, newContext, PROFILES, stubTheWorld, throttle, type NetEntry, type Profile } from './browser'
import { appUrl, env } from './env'
import { metricsDelta, netStats, windowStats, type Metrics, type Snapshot } from './measure'
import { printReport } from './report'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'slow4g-4x,chromium,webkit' },
    runs: { type: 'string', default: '5' },
    journey: { type: 'string', default: 'start,tabs,book,search,profile' },
    label: { type: 'string', default: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') },
    out: { type: 'string', default: '' },
    cpuprofile: { type: 'boolean', default: false },
    trace: { type: 'boolean', default: false },
  },
})
const journeys = new Set(args.journey!.split(','))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const repoRoot = new URL('../..', import.meta.url).pathname
const outDir = args.out || join(repoRoot, '.data/perf', args.label!)
mkdirSync(outDir, { recursive: true })

export type StepResult = {
  id: string
  journey: string
  label: string
  ok: boolean
  error?: string
  /** Tap (or navigation) to the screen being ready, as a visible element: ms. */
  readyMs: number | null
  windowMs: number
  stats: ReturnType<typeof windowStats>
  cdp: ReturnType<typeof metricsDelta> | null
  net: ReturnType<typeof netStats>
  requests: NetEntry[]
  extra?: Record<string, unknown>
}

class Session {
  cdp: CDPSession | null = null
  net!: Awaited<ReturnType<typeof netLog>>
  readonly base: string
  constructor(
    readonly page: Page,
    readonly profile: Profile,
  ) {
    this.base = appUrl(profile.engine)
  }
  static async open(context: BrowserContext, profile: Profile) {
    const page = await context.newPage()
    const s = new Session(page, profile)
    s.cdp = profile.engine === 'chromium' ? await context.newCDPSession(page) : null
    s.net = await netLog(page, s.cdp)
    if (s.cdp) await s.cdp.send('Performance.enable')
    await throttle(s.cdp, profile)
    return s
  }
  snapshot() {
    return this.page.evaluate(() => {
      const p = (window as unknown as { __perf: Omit<Snapshot, 'now'> }).__perf
      return { ...p, frames: [...p.frames], now: performance.now() } as Snapshot
    })
  }
  async metrics(): Promise<Metrics> {
    if (!this.cdp) return {}
    const { metrics } = await this.cdp.send('Performance.getMetrics')
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  }
  async gcMetrics(): Promise<Metrics> {
    await this.cdp?.send('HeapProfiler.collectGarbage').catch(() => {})
    return this.metrics()
  }
  async quiet(ms = 1000, cap = 30000) {
    const t0 = Date.now()
    let since = Date.now()
    while (Date.now() - t0 < cap) {
      if (this.net.inFlight() > 0) since = Date.now()
      else if (Date.now() - since >= ms) return
      await sleep(100)
    }
  }
  async sampling(on: boolean) {
    await this.page.evaluate((v) => void ((window as unknown as { __perf: { sampling: boolean; frames: number[] } }).__perf.sampling = v), on)
  }
  async watch(selector: string) {
    await this.page.evaluate((s) => (window as unknown as { __perfWatch(s: string): void }).__perfWatch(s), selector)
  }
  async seen(selector: string) {
    return this.page.evaluate((s) => (window as unknown as { __perf: Snapshot }).__perf.seen[s] ?? null, selector)
  }
  async tap(testid: string, nth = 0) {
    await this.page.getByTestId(testid).nth(nth).tap({ timeout: 15000 })
  }
  /** A finger-like scroll to the bottom of the page: compositor-driven in Chromium, wheel events in WebKit. */
  async scrollToBottom(max = 60) {
    let still = 0
    let last = -1
    for (let i = 0; i < max && still < 3; i++) {
      if (this.cdp) await this.cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 600, yDistance: -1800, speed: 4000, gestureSourceType: 'touch', preventFling: true })
      else {
        // Mobile WebKit has no wheel: script the scroll in steps a finger-fling would cover.
        await this.page.evaluate(() => window.scrollBy(0, 900))
        await sleep(120)
      }
      const y = await this.page.evaluate(() => Math.round(window.scrollY))
      still = y === last ? still + 1 : 0
      last = y
    }
  }
  async scrollToTop() {
    await this.page.evaluate(() => window.scrollTo(0, 0))
    await sleep(500)
  }
}

type StepDef = { id: string; journey: string; label: string; prepare?: (s: Session) => Promise<void>; act: (s: Session) => Promise<void>; ready: (s: Session) => Promise<void>; settle?: number }

const visible = (testid: string, nth = 0) => (s: Session) => s.page.getByTestId(testid).nth(nth).waitFor({ state: 'visible', timeout: 20000 })

const STEPS: StepDef[] = [
  { id: 'b1-home-to-library', journey: 'tabs', label: 'Home → Library (tab)', act: (s) => s.tap('shell.tab.library'), ready: visible('library.entry') },
  { id: 'b2-library-scroll', journey: 'tabs', label: 'Library: scroll to the bottom', act: (s) => s.scrollToBottom(), ready: async () => {}, settle: 600 },
  { id: 'b3-library-to-profile', journey: 'tabs', label: 'Library → Profile (avatar)', act: (s) => s.tap('shell.avatar'), ready: visible('profile.figures'), settle: 1500 },
  {
    id: 'b4-profile-to-home',
    journey: 'tabs',
    label: 'Profile → Home',
    act: async (s) => {
      if (await s.page.getByTestId('shell.tab.home').count()) await s.tap('shell.tab.home')
      else await s.page.goto(`${s.base}/`)
    },
    ready: visible('home.title'),
  },
  {
    id: 'c1-library-to-book',
    journey: 'book',
    label: 'Library → Book',
    prepare: async (s) => {
      await s.tap('shell.tab.library')
      await visible('library.entry')(s)
      await sleep(800)
      await s.scrollToTop()
    },
    act: (s) => s.tap('library.entry', 2),
    ready: visible('book.hero'),
    settle: 1200,
  },
  { id: 'c2-book-back', journey: 'book', label: 'Book → back to Library', act: (s) => s.tap('book.back'), ready: visible('library.entry') },
  { id: 'd1-search-open', journey: 'search', label: 'Search palette: open', act: (s) => s.tap('shell.tab.search'), ready: visible('search.query'), settle: 800 },
  {
    id: 'd2-search-type',
    journey: 'search',
    label: 'Search: type "piranesi", results',
    act: async (s) => {
      await s.page.getByTestId('search.query').pressSequentially('piranesi', { delay: 90 })
    },
    ready: visible('search.result'),
    settle: 1500,
  },
  { id: 'd3-search-close', journey: 'search', label: 'Search: close', act: (s) => s.tap('search.cancel'), ready: async () => {}, settle: 800 },
  {
    id: 'e1-profile-open',
    journey: 'profile',
    label: 'Home → Profile figures',
    prepare: async (s) => {
      if (!(await s.page.getByTestId('home.title').count())) await s.page.goto(`${s.base}/`)
      await visible('home.title')(s)
      await sleep(500)
    },
    act: (s) => s.tap('shell.avatar'),
    ready: visible('profile.figures'),
    settle: 2500,
  },
  { id: 'e2-profile-back', journey: 'profile', label: 'Profile → back', act: (s) => s.page.goBack().then(() => {}), ready: visible('home.title'), settle: 800 },
]

async function runStep(s: Session, def: StepDef, dir: string): Promise<StepResult> {
  const t0 = Date.now()
  await def.prepare?.(s)
  await s.sampling(false)
  await sleep(300)
  const before = await s.gcMetrics()
  const base = await s.snapshot()
  const cdpPage = s.cdp
  if (args.cpuprofile && cdpPage) {
    await cdpPage.send('Profiler.enable')
    await cdpPage.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdpPage.send('Profiler.start')
  }
  if (args.trace && s.profile.engine === 'chromium') await s.page.context().browser()!.startTracing(s.page, { path: join(dir, `${def.id}.trace.json`), screenshots: false, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'loading', 'v8.execute', 'cc', 'viz'] })
  // The step's window starts at the page's clock now.
  const from = base.now
  const wallFrom = Date.now()
  await s.sampling(true)
  let error: string | undefined
  let readyMs: number | null = null
  try {
    await def.act(s)
    await def.ready(s)
    readyMs = Date.now() - wallFrom
  } catch (e) {
    error = String((e as Error).message ?? e).split('\n')[0]
    await s.page.screenshot({ path: join(dir, `${def.id}.error.png`) }).catch(() => {})
  }
  await sleep(def.settle ?? 1000)
  await s.quiet(400, 8000)
  const snap = await s.snapshot()
  await s.sampling(false)
  const wallTo = Date.now()
  const after = await s.metrics()
  if (args.cpuprofile && cdpPage) {
    const { profile } = await cdpPage.send('Profiler.stop')
    writeFileSync(join(dir, `${def.id}.cpuprofile`), JSON.stringify(profile))
  }
  if (args.trace && s.profile.engine === 'chromium') await s.page.context().browser()!.stopTracing()
  const frames = snap.frames
  const stats = windowStats({ ...snap, frames }, from, snap.now)
  console.log(`    ${def.id.padEnd(24)} ready ${readyMs ?? '—'} ms  inp ${stats.inp?.ms ?? '—'}  loaf ${stats.loaf.n}/${stats.loaf.totalMs} ms  cls ${stats.cls.value}  ${error ? `ERROR ${error}` : ''}  (${Date.now() - t0} ms)`)
  const net = netStats(s.net.entries, wallFrom, wallTo)
  return {
    id: def.id,
    journey: def.journey,
    label: def.label,
    ok: !error,
    error,
    readyMs,
    windowMs: Math.round(snap.now - from),
    stats,
    cdp: s.cdp ? metricsDelta(before, after) : null,
    net,
    requests: s.net.entries.filter((e) => e.at >= wallFrom && e.at <= wallTo),
  }
}

/** The start: navigation to the Home screen being shown, then until the page is quiet. Cold = nothing on the device; warm = the app was open before. */
async function startStep(s: Session, kind: 'cold' | 'warm', dir: string): Promise<StepResult> {
  const wallFrom = Date.now()
  if (args.cpuprofile && s.cdp) {
    await s.cdp.send('Profiler.enable')
    await s.cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await s.cdp.send('Profiler.start')
  }
  let error: string | undefined
  await s.page.addInitScript(() => (window as unknown as { __perfWatch?: (s: string) => void }).__perfWatch?.('[data-testid="home.title"]'))
  try {
    await s.page.goto(`${s.base}/`, { waitUntil: 'commit' })
    await s.page.getByTestId('home.title').waitFor({ state: 'visible', timeout: 90000 })
  } catch (e) {
    error = String((e as Error).message).split('\n')[0]
  }
  const readyAt = await s.seen('[data-testid="home.title"]').catch(() => null)
  await s.quiet(1500, 40000)
  await sleep(500)
  const snap = await s.snapshot()
  const wallTo = Date.now()
  const after = await s.gcMetrics()
  if (args.cpuprofile && s.cdp) {
    const { profile } = await s.cdp.send('Profiler.stop')
    writeFileSync(join(dir, `start-${kind}.cpuprofile`), JSON.stringify(profile))
  }
  const nav = await s.page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    return { ttfb: Math.round(n.responseStart), domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), protocol: n.nextHopProtocol }
  })
  const stats = windowStats(snap, 0, snap.now, { tbtFrom: snap.paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0 })
  const net = netStats(s.net.entries, wallFrom, wallTo)
  const extra: Record<string, unknown> = { nav, homeShownMs: readyAt === null ? null : Math.round(readyAt) }
  if (kind === 'cold' && s.profile.engine === 'chromium') {
    // The service worker: when it was ready, and what it keeps.
    const sw = await s.page.evaluate(async () => {
      const t = performance.now()
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 30000))])
      const readyAt = performance.now()
      const names = await caches.keys()
      const caches_: Record<string, { n: number; bytes: number }> = {}
      for (const name of names) {
        const c = await caches.open(name)
        const keys = await c.keys()
        let bytes = 0
        for (const k of keys.slice(0, 400)) bytes += (await (await c.match(k))?.clone().blob())?.size ?? 0
        caches_[name] = { n: keys.length, bytes }
      }
      return { active: Boolean(reg?.active), waitedMs: Math.round(readyAt - t), readyAt: Math.round(readyAt), caches: caches_ }
    })
    extra.serviceWorker = sw
  }
  const wire = (await (await fetch(`${s.base}/__perf/log?since=${wallFrom - 50}`)).json().catch(() => [])) as { path: string; bytes: number; raw: number; status: number; dest: string; cache: string }[]
  extra.wire = {
    requests: wire.length,
    kb: Math.round(wire.reduce((a, e) => a + e.bytes, 0) / 102.4) / 10,
    rawKb: Math.round(wire.reduce((a, e) => a + e.raw, 0) / 102.4) / 10,
    status304: wire.filter((e) => e.status === 304).length,
    // Files sent more than once in the window (page + service worker, or twice by the page).
    twice: Object.entries(wire.reduce<Record<string, number>>((m, e) => ((m[e.path] = (m[e.path] ?? 0) + 1), m), {})).filter(([, n]) => n > 1).length,
    twiceKb: Math.round(Object.entries(wire.reduce<Record<string, { n: number; b: number }>>((m, e) => ((m[e.path] ??= { n: 0, b: 0 }), m[e.path]!.n++, (m[e.path]!.b = e.bytes), m), {})).filter(([, v]) => v.n > 1).reduce((a, [, v]) => a + v.b * (v.n - 1), 0) / 102.4) / 10,
  }
  const ls = await s.page.evaluate(() => {
    let total = 0
    const keys: Record<string, number> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      const n = (localStorage.getItem(k) ?? '').length
      total += n
      if (n > 5000) keys[k] = Math.round(n / 1024)
    }
    return { totalKb: Math.round(total / 1024), bigKeysKb: keys }
  })
  extra.localStorage = ls
  console.log(`    start-${kind.padEnd(4)}            home ${extra.homeShownMs ?? '—'} ms  lcp ${stats.lcp?.ms ?? '—'}  fcp ${Math.round(stats.fcp ?? 0)}  tbt ${stats.tbt}  cls ${stats.cls.value}  req ${net.requests}/${net.transferKb} KB  ${error ? `ERROR ${error}` : ''}`)
  return {
    id: `a-start-${kind}`,
    journey: 'start',
    label: kind === 'cold' ? 'Cold start (first launch: no service worker, empty cache)' : 'Warm start (app launched again: service worker, cache, device copy)',
    ok: !error,
    error,
    readyMs: extra.homeShownMs as number | null,
    windowMs: Math.round(snap.now),
    stats,
    cdp: s.cdp ? metricsDelta({}, after) : null,
    net,
    requests: s.net.entries.filter((e) => e.at >= wallFrom && e.at <= wallTo),
    extra,
  }
}

async function main() {
  const profiles = args.profile!.split(',').map((p) => {
    const profile = PROFILES[p]
    if (!profile) throw new Error(`unknown profile ${p} (${Object.keys(PROFILES).join(', ')})`)
    return profile
  })
  const runs = Number(args.runs)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repoRoot }).toString().trim()
  for (const profile of profiles) {
    const load = loadavg()
    console.log(`\n== ${profile.name}: ${profile.describe} — ${runs} runs, load average at start ${load.map((l) => l.toFixed(2)).join(' ')}`)
    const browser = await launch(profile)
    const meta = { profile: profile.name, describe: profile.describe, runs, startedAt: new Date().toISOString(), loadAtStart: load.map((l) => Math.round(l * 100) / 100), browser: `${browser.browserType().name()} ${browser.version()}`, commit: git('rev-parse', '--short', 'HEAD'), machine: { cpu: cpus()[0]?.model, cores: cpus().length, memGB: Math.round(totalmem() / 2 ** 30) }, app: appUrl(profile.engine), stack: env.supabaseUrl }
    const results: { run: number; steps: StepResult[] }[] = []
    for (let run = 1; run <= runs; run++) {
      console.log(`  run ${run}/${runs}`)
      const dir = join(outDir, profile.name, `run-${run}`)
      mkdirSync(dir, { recursive: true })
      const session = await memberSession()
      const context = await newContext(browser, profile, session)
      await stubTheWorld(context, profile)
      const steps: StepResult[] = []
      // Cold: a fresh context, nothing but the session.
      const cold = await Session.open(context, profile)
      if (journeys.has('start')) steps.push(await startStep(cold, 'cold', dir))
      else {
        await cold.page.goto(`${cold.base}/`)
        await cold.quiet(1500, 40000)
      }
      await cold.page.close()
      // Warm: the same context, a new page (the app launched again).
      const warm = await Session.open(context, profile)
      const warmStart = await startStep(warm, 'warm', dir)
      if (journeys.has('start')) steps.push(warmStart)
      for (const def of STEPS) {
        if (!journeys.has(def.journey)) continue
        try {
          steps.push(await runStep(warm, def, dir))
        } catch (e) {
          console.log(`    ${def.id} failed: ${(e as Error).message.split('\n')[0]}`)
          await warm.page.goto(`${warm.base}/`).catch(() => {})
          await sleep(1500)
        }
      }
      results.push({ run, steps })
      await context.close()
    }
    await browser.close()
    writeFileSync(join(outDir, `${profile.name}.json`), JSON.stringify({ meta, results }))
  }
  console.log(`\nRaw results: ${outDir}\n`)
  printReport(outDir)
}

await main()

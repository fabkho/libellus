/**
 * Perf harness, rendering deep dive (not app code): drives the key motion flows of a
 * static build in Chromium on a phone profile (412 × 915 @ 2.625, touch), CPU throttled, and records
 * per flow: a Chrome trace, rAF frame gaps, Long Animation Frames (LoAF, with script attribution and
 * forced style/layout), Performance.getMetrics deltas (style/layout counts and time, heap, nodes),
 * and in a separate unthrottled pass the composited layer tree (count, area) mid-transition.
 *
 *   pnpm perf:flows --cpu 4 --out .data/perf/flows-4x [--only profile-open,library-scroll] [--profile] [--layers]
 *
 * Needs the stack, the seed, the build and the server (perf/README.md). Where `pnpm perf` reports
 * what a journey costs, this records why: a trace, rAF gaps, LoAF scripts, a CPU profile
 * (--profile: python3 perf/cpuprofile.py <out>) and the layer tree (--layers) per motion flow;
 * perf/analyse.py summarises the traces.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import { launch, memberSession, PROFILES } from './browser'
import { appUrl } from './env'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: appUrl('chromium') },
    cpu: { type: 'string', default: '4' },
    out: { type: 'string', default: new URL('../../.data/perf/flows', import.meta.url).pathname },
    layers: { type: 'boolean', default: false },
    trace: { type: 'string', default: 'on' },
    headed: { type: 'boolean', default: false },
    only: { type: 'string', default: '' },
    theme: { type: 'string', default: 'dark' },
    profile: { type: 'boolean', default: false },
    cdp: { type: 'string', default: '' },
    css: { type: 'string', default: '' },
    screencast: { type: 'boolean', default: false },
  },
})
const out = args.out!
mkdirSync(out, { recursive: true })
const session = await memberSession()
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing',
  'cc',
  'benchmark',
  'gpu',
  'viz',
  'loading',
  'v8.execute',
  'blink',
]

type FlowResult = Record<string, unknown>

async function recorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    const gaps: number[] = []
    w.__gaps = gaps
    w.__rec = true
    let last = performance.now()
    const tick = (t: number) => {
      gaps.push(t - last)
      last = t
      if (w.__rec) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    ;(w.__loaf as unknown[]).length = 0
    ;(w.__lt as unknown[]).length = 0
    w.__t0 = performance.now()
  })
}

async function stopRecorder(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w.__rec = false
    const gaps = (w.__gaps as number[]).slice(1)
    const t0 = w.__t0 as number
    const loaf = (w.__loaf as PerformanceEntry[]).filter((e) => e.startTime >= t0).map((e) => {
      const l = e as unknown as {
        startTime: number; duration: number; blockingDuration: number; renderStart: number; styleAndLayoutStart: number
        scripts: { sourceURL: string; sourceFunctionName: string; invoker: string; duration: number; forcedStyleAndLayoutDuration: number }[]
      }
      return {
        start: Math.round(l.startTime - t0),
        duration: Math.round(l.duration),
        blocking: Math.round(l.blockingDuration),
        render: Math.round(l.startTime + l.duration - l.renderStart),
        styleLayout: Math.round(l.startTime + l.duration - l.styleAndLayoutStart),
        scripts: l.scripts
          .filter((s) => s.duration > 4)
          .map((s) => ({ fn: s.sourceFunctionName, inv: s.invoker, src: s.sourceURL.split('/').pop(), d: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration) })),
      }
    })
    return { gaps, loaf, nodes: document.getElementsByTagName('*').length }
  })
}

function summariseGaps(gaps: number[]) {
  const total = gaps.reduce((a, b) => a + b, 0)
  const over = (ms: number) => gaps.filter((g) => g > ms).length
  // Frames that should have been drawn in the window at 60 Hz vs frames delivered.
  const expected = Math.round(total / 16.67)
  return {
    frames: gaps.length,
    windowMs: Math.round(total),
    expected60: expected,
    missed60: Math.max(0, expected - gaps.length),
    over25ms: over(25),
    over50ms: over(50),
    over100ms: over(100),
    worstMs: Math.round(Math.max(0, ...gaps)),
    first5: gaps.slice(0, 5).map((g) => Math.round(g)),
  }
}

async function metrics(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

function metricDelta(a: Record<string, number>, b: Record<string, number>) {
  const keys = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'JSHeapUsedSize', 'Nodes', 'LayoutObjects']
  const d: Record<string, number> = {}
  for (const k of keys) {
    const v = (b[k] ?? 0) - (a[k] ?? 0)
    d[k] = k.endsWith('Duration') ? Math.round(v * 1000) : k === 'JSHeapUsedSize' ? Math.round(v / 1024) : v
  }
  d.heapMB = Math.round(((b.JSHeapUsedSize ?? 0) / 1048576) * 10) / 10
  d.nodesTotal = b.Nodes ?? 0
  return d
}

async function layerSampler(cdp: CDPSession) {
  let latest: { count: number; drawing: number; areaPx: number; big: { w: number; h: number; name?: string }[] } | null = null
  let max = { count: 0, drawing: 0, areaPx: 0, big: [] as { w: number; h: number }[] }
  const onChange = (e: { layers?: { layerId: string; width: number; height: number; drawsContent: boolean; invisible?: boolean }[] }) => {
    if (!e.layers) return
    const drawing = e.layers.filter((l) => l.drawsContent && !l.invisible)
    const areaPx = drawing.reduce((a, l) => a + l.width * l.height, 0)
    latest = {
      count: e.layers.length,
      drawing: drawing.length,
      areaPx,
      big: drawing.filter((l) => l.width * l.height > 412 * 200).map((l) => ({ w: Math.round(l.width), h: Math.round(l.height) })),
    }
    if (areaPx > max.areaPx) max = latest
  }
  cdp.on('LayerTree.layerTreeDidChange', onChange)
  await cdp.send('LayerTree.enable')
  return {
    reset() {
      max = { count: 0, drawing: 0, areaPx: 0, big: [] }
    },
    peak() {
      return { ...max, viewportMultiples: Math.round((max.areaPx / (412 * 915)) * 10) / 10, gpuMBat2625: Math.round((max.areaPx * 2.625 * 2.625 * 4) / 1048576) }
    },
    latest: () => latest,
  }
}

async function main() {
  const browser: Browser = args.cdp
    ? await chromium.connectOverCDP(args.cdp)
    : await launch(PROFILES.chromium!)
  const context: BrowserContext = args.cdp ? browser.contexts()[0]! : await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    colorScheme: args.theme === 'light' ? 'light' : 'dark',
    serviceWorkers: 'block',
    ignoreHTTPSErrors: true,
  })
  await context.addInitScript('window.__name = (fn) => fn')
  // A/B experiments only (never app code): extra CSS laid over the build, e.g. no blur.
  if (args.css)
    await context.addInitScript((css: string) => {
      const add = () => document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }))
      if (document.head) add()
      else document.addEventListener('DOMContentLoaded', add)
    }, args.css)
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    const w = window as unknown as Record<string, unknown>
    w.__loaf = []
    w.__lt = []
    try {
      new PerformanceObserver((l) => (w.__loaf as PerformanceEntry[]).push(...l.getEntries())).observe({ type: 'long-animation-frame', buffered: true })
      new PerformanceObserver((l) => (w.__lt as PerformanceEntry[]).push(...l.getEntries())).observe({ type: 'longtask', buffered: true })
    } catch {}
  }, session)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  if (args.cdp) {
    await cdp.send('Network.enable')
    await cdp.send('Network.setBypassServiceWorker', { bypass: true })
  }
  // A touch through CDP (works on a connected Android Chrome, where Playwright's tap() does not).
  const tap = async (locator: import('@playwright/test').Locator) => {
    await locator.scrollIntoViewIfNeeded().catch(() => {})
    const b = await locator.boundingBox()
    if (!b) throw new Error('no box')
    const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
    await sleep(40)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  // Scrolls by a finger-like gesture (the tab bar hides and shows as it would); positive = down.
  const scroll = async (dy: number, speed = 2500) => {
    await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 450, yDistance: -dy, speed, gestureSourceType: 'touch', preventFling: true })
  }
  let shots: number[] = []
  if (args.screencast) {
    cdp.on('Page.screencastFrame', (frame) => {
      shots.push((frame.metadata.timestamp ?? 0) * 1000)
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
    })
  }
  await cdp.send('Performance.enable')
  const layers = args.layers ? await layerSampler(cdp) : null
  let requests: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('perf.supabase.co')) requests.push(`${r.method()} ${u.replace(/^.*perf\.supabase\.co/, '').slice(0, 140)}`)
  })
  if (args.profile) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  }

  const toTop = async () => {
    for (let i = 0; i < 20 && (await page.evaluate(() => window.scrollY)) > 0; i++) await scroll(-3000, 8000)
    await scroll(-200)
    await sleep(700)
  }
  // Warm up: Home, Library (all covers seen once so they are in the HTTP cache), back Home.
  await page.goto(`${args.base}/`)
  await page.getByTestId('home.title').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  const gpu = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl')
    const d = c?.getExtension('WEBGL_debug_renderer_info')
    return { renderer: d ? c!.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, ua: navigator.userAgent }
  })
  writeFileSync(join(out, 'env.json'), JSON.stringify({ gpu, cpu: args.cpu, base: args.base }, null, 2))
  console.log('warm: library')
  await tap(page.getByTestId('shell.tab.library'))
  await page.getByTestId('library.entry').first().waitFor()
  console.log('warm: scroll')
  for (let y = 0; y < 8; y++) await scroll(1500, 6000)
  console.log('warm: top')
  await toTop()
  console.log('warm: home')
  await tap(page.getByTestId('shell.tab.home'))
  await sleep(1500)

  const results: FlowResult = {}
  const rate = Number(args.cpu)

  async function flow(name: string, act: () => Promise<void>, settle = 1400) {
    if (args.only && !args.only.split(',').includes(name)) {
      await act()
      await sleep(settle)
      return
    }
    await sleep(400)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    if (args.trace === 'on' && !layers) await browser.startTracing(page, { path: join(out, `${name}.trace.json`), screenshots: true, categories: CATEGORIES })
    layers?.reset()
    requests = []
    shots = []
    if (args.screencast) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 412, everyNthFrame: 1 })
    if (args.profile) await cdp.send('Profiler.start')
    const before = await metrics(cdp)
    await recorder(page)
    const t = Date.now()
    await act()
    await sleep(settle)
    const rec = await stopRecorder(page)
    const after = await metrics(cdp)
    if (args.screencast) await cdp.send('Page.stopScreencast')
    const shotGaps = shots.slice(1).map((t, i) => t - shots[i]!)
    if (args.profile) {
      const { profile } = await cdp.send('Profiler.stop')
      writeFileSync(join(out, `${name}.cpuprofile`), JSON.stringify(profile))
    }
    if (args.trace === 'on' && !layers) await browser.stopTracing()
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    results[name] = {
      raf: summariseGaps(rec.gaps),
      loaf: rec.loaf.filter((l) => l.duration >= 50),
      loafTotalBlocking: rec.loaf.reduce((a, l) => a + l.blocking, 0),
      metrics: metricDelta(before, after),
      domNodes: rec.nodes,
      layers: layers?.peak(),
      wallMs: Date.now() - t,
      requests,
      screencast: args.screencast ? { frames: shots.length, over50: shotGaps.filter((g) => g > 50).length, worst: Math.round(Math.max(0, ...shotGaps)), first8: shotGaps.slice(0, 8).map(Math.round) } : undefined,
    }
    await page.screenshot({ path: join(out, `${name}.end.png`) })
    console.log(name, JSON.stringify((results[name] as { raf: unknown }).raf))
  }

  const tapCover = (sel: string, nth = 0) => tap(page.locator(sel).nth(nth).locator('[data-cover]').first())
  const backFromBook = async () => {
    await tap(page.getByTestId('book.back'))
  }
  const heroIn = () => page.getByTestId('book.hero').waitFor()

  // 1. Home → Book (cover flight) and back.
  const homeLink = (await page.getByTestId('home.upNextEntry').count()) ? '[data-testid="home.upNextEntry"]' : '[data-testid="home.readingCard"]'
  await flow('home-to-book', async () => {
    await tapCover(homeLink, 0)
    await heroIn()
  })
  await flow('book-back-home', backFromBook)

  // 2. Tab switch Home → Library.
  await flow('tab-home-to-library', async () => {
    await tap(page.getByTestId('shell.tab.library'))
    await page.getByTestId('library.entry').first().waitFor()
  }, 900)

  // 3. Library row → Book, back (top of the list).
  await flow('library-to-book', async () => {
    await tapCover('[data-testid="library.entry"]', 2)
    await heroIn()
  })
  await flow('book-back-library', backFromBook)

  // 4. Deep in the Library (scrolled 3000 px) → Book, back.
  await page.evaluate(() => window.scrollTo(0, 3000))
  await sleep(800)
  const deep = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="library.entry"]')]
    return rows.findIndex((r) => {
      const b = r.getBoundingClientRect()
      return b.top > 200 && b.bottom < 700
    })
  })
  await flow('library-deep-to-book', async () => {
    await tapCover('[data-testid="library.entry"]', Math.max(0, deep))
    await heroIn()
  })
  await flow('book-back-library-deep', backFromBook)

  // 5. Scroll the Library (tab bar hides, scroll edge shows).
  await flow('library-scroll', async () => {
    await scroll(1800, 2000)
  }, 600)
  await toTop()

  // 6. Search morph open / close.
  await flow('search-open', async () => {
    await tap(page.getByTestId('shell.tab.search'))
    await page.getByTestId('search.query').waitFor()
  }, 900)
  await flow('search-close', async () => {
    await tap(page.getByTestId('search.cancel'))
  }, 900)

  // 7. Tab switch Library → Home.
  await flow('tab-library-to-home', async () => {
    await tap(page.getByTestId('shell.tab.home'))
    await page.getByTestId('home.title').waitFor()
  }, 900)

  // 8. A sheet: Home's tally (Read in <year>).
  if (await page.getByTestId('home.tally').count()) {
    await flow('sheet-open', async () => {
      await tap(page.getByTestId('home.tally'))
    }, 900)
    await flow('sheet-close', async () => {
      await page.keyboard.press('Escape')
    }, 800)
  }

  // 9. Profile push (View Transitions API) and its loading wave, and back.
  await flow('profile-open', async () => {
    await tap(page.getByTestId('shell.avatar'))
    await page.waitForURL(/\/profile/)
  }, 2500)
  await flow('profile-back', async () => {
    await page.goBack()
    await page.getByTestId('home.title').waitFor()
  }, 1200)

  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
  if (args.cdp) await page.close()
  else await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

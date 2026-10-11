// Production smoke test, logged out: https://libellus.fabkho.dev (or $SMOKE_URL).
//
//   node docs/perf/data/final/prod-smoke.mjs chromium|webkit [--runs 5] [--out docs/perf/data/final] [--block mzstatic]
//   --block <host substring>: abort the requests to that host (an experiment: what would LCP be without the sign-in wall's covers); the result file gets a `-blocked` suffix.
//
// chromium: Playwright's Pixel 7, CPU 4x slower, Slow 4G (1.6 Mbit/s, 150 ms RTT, CDP); webkit: iPhone 14,
// unthrottled (no throttling exists for WebKit). Per run, in a fresh context: a cold first visit (sign-in
// form shown = `signIn.title`), 9 s for the idle work and the service worker's install, a second visit in the
// same context (service worker + HTTP cache), then the shell reloaded offline. Logged out, nothing written,
// nobody signed in. Needs `pnpm install` in web/ (Playwright resolves from there).
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { join } from 'node:path'

const require = createRequire(new URL('../../../../web/package.json', import.meta.url))
const { chromium, webkit, devices } = require('@playwright/test')

const engine = process.argv[2] ?? 'chromium'
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const runs = Number(arg('runs', '5'))
const out = arg('out', 'docs/perf/data/final')
const block = arg('block', '')
const URL_ = process.env.SMOKE_URL ?? 'https://libellus.fabkho.dev'
const shotDirs = ['/tmp/perf-final', '.shots']
for (const d of shotDirs) mkdirSync(d, { recursive: true })
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
const spread = (xs) => (xs.length ? (Math.max(...xs) - Math.min(...xs)) / (median(xs) || 1) : null)

const INIT = () => {
  const p = { lcp: null, cls: 0, fcp: null, loaf: [], longtasks: 0 }
  window.__smoke = p
  const obs = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true })
    } catch {}
  }
  obs('largest-contentful-paint', (e) => (p.lcp = { t: Math.round(e.startTime), size: e.size, el: e.element ? e.element.tagName.toLowerCase() + (e.element.getAttribute('data-testid') ? `[${e.element.getAttribute('data-testid')}]` : '') + (e.url ? ` ${e.url.split('/').slice(-1)[0].slice(0, 40)}` : '') : null }))
  // layout-shift: worst session window
  let win = [], winVal = 0, worst = 0
  obs('layout-shift', (e) => {
    if (e.hadRecentInput) return
    const last = win.at(-1), first = win[0]
    if (win.length && (e.startTime - last.startTime > 1000 || e.startTime - first.startTime > 5000)) { win = []; winVal = 0 }
    win.push(e); winVal += e.value; worst = Math.max(worst, winVal); p.cls = Math.round(worst * 10000) / 10000
  })
  obs('paint', (e) => { if (e.name === 'first-contentful-paint') p.fcp = Math.round(e.startTime) })
  obs('long-animation-frame', (e) =>
    p.loaf.push({ start: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), scripts: e.scripts.slice(0, 3).map((s) => `${s.invokerType}:${(s.sourceURL || '').split('/').slice(-1)[0]}:${s.sourceFunctionName || ''} ${Math.round(s.duration)}ms`) }),
  )
  obs('longtask', () => p.longtasks++)
}

async function visit(page, cdp, label, { reload = false } = {}) {
  const reqs = []
  let netLog = null
  if (cdp) {
    netLog = new Map()
    cdp.removeAllListeners?.('Network.responseReceived')
    cdp.on('Network.responseReceived', (e) => netLog.set(e.requestId, { url: e.response.url, status: e.response.status, fromSW: e.response.fromServiceWorker, fromCache: e.response.fromDiskCache || e.response.fromPrefetchCache, type: e.type, headers: e.response.headers, enc: 0 }))
    cdp.on('Network.loadingFinished', (e) => { const r = netLog.get(e.requestId); if (r) r.enc = e.encodedDataLength })
  } else {
    page.on('response', async (r) => {
      let enc = 0
      try { const s = await r.request().sizes(); enc = s.responseBodySize + s.responseHeadersSize } catch {}
      reqs.push({ url: r.url(), status: r.status(), fromSW: r.fromServiceWorker(), type: r.request().resourceType(), headers: r.headers(), enc })
    })
  }
  const t0 = Date.now()
  if (reload) await page.reload({ waitUntil: 'commit' })
  else await page.goto(URL_ + '/', { waitUntil: 'commit' })
  await page.getByTestId('signIn.title').waitFor({ timeout: 90_000 })
  const shown = Date.now() - t0
  await page.waitForTimeout(label === 'cold' ? 9000 : 4000)
  const m = await page.evaluate(() => window.__smoke)
  const list = netLog ? [...netLog.values()] : reqs
  return { shown, m, list }
}

function summarise(r) {
  const own = r.list.filter((e) => new URL(e.url).host === new URL(URL_).host)
  const sum = (xs) => xs.reduce((a, e) => a + (e.enc || 0), 0)
  const fromSW = r.list.filter((e) => e.fromSW).length
  const netOnly = r.list.filter((e) => !e.fromSW && !e.fromCache)
  return {
    shownMs: r.shown,
    fcp: r.m?.fcp,
    lcp: r.m?.lcp?.t ?? null,
    lcpEl: r.m?.lcp?.el ?? null,
    cls: r.m?.cls ?? null,
    loaf: r.m?.loaf ?? [],
    requests: r.list.length,
    requestsOwn: own.length,
    fromServiceWorker: fromSW,
    onWire: netOnly.length,
    transferKB: Math.round(sum(netOnly) / 102.4) / 10,
    transferOwnKB: Math.round(sum(netOnly.filter((e) => own.includes(e))) / 102.4) / 10,
    thirdParty: [...new Set(r.list.map((e) => new URL(e.url).host).filter((h) => h !== new URL(URL_).host))],
  }
}

const result = { engine, url: URL_, startedAt: new Date().toISOString(), loadAtStart: loadavg().map((x) => Math.round(x * 100) / 100), runs: [] }
const type = engine === 'chromium' ? chromium : webkit
const device = engine === 'chromium' ? devices['Pixel 7'] : devices['iPhone 14']
const browser = await type.launch()
result.browser = `${engine} ${browser.version()}`
result.device = engine === 'chromium' ? 'Pixel 7 (CPU 4x, Slow 4G)' : 'iPhone 14 (no throttling)'
const headersSeen = new Map()
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ ...device, serviceWorkers: 'allow', colorScheme: 'dark' })
  await context.addInitScript(INIT)
  if (block) await context.route((u) => u.host.includes(block), (r) => r.abort())
  const row = { run: i + 1 }
  const pageA = await context.newPage()
  const cdp = engine === 'chromium' ? await context.newCDPSession(pageA) : null
  if (cdp) {
    await cdp.send('Network.enable')
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  }
  const c = await visit(pageA, cdp, 'cold')
  row.cold = summarise(c)
  const key = (u) => new URL(u).pathname.replace(/[A-Za-z0-9_-]{6,}\.(js|css|woff2)$/, '<hash>.$1')
  for (const e of c.list) if (!headersSeen.has(key(e.url))) headersSeen.set(key(e.url), { url: e.url, status: e.status, cc: e.headers?.['cache-control'], ce: e.headers?.['content-encoding'], cf: e.headers?.['cf-cache-status'], ct: e.headers?.['content-type'] })
  if (i === 0) for (const d of shotDirs) await pageA.screenshot({ path: join(d, `prod-${engine}-signin-cold.png`) })
  // is the service worker in charge?
  row.swActive = await pageA.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return !!r?.active })
  // second visit: same page reloaded under the service worker
  const w = await visit(pageA, cdp, 'warm', { reload: true })
  row.warm = summarise(w)
  if (i === 0) for (const d of shotDirs) await pageA.screenshot({ path: join(d, `prod-${engine}-signin-warm.png`) })
  // offline: shell
  await context.setOffline(true)
  let offline = { ok: false }
  try {
    const t0 = Date.now()
    await pageA.reload({ waitUntil: 'commit', timeout: 20_000 })
    await pageA.getByTestId('signIn.title').waitFor({ timeout: 20_000 })
    offline = { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    offline = { ok: false, error: String(e).slice(0, 120) }
  }
  if (i === 0) for (const d of shotDirs) await pageA.screenshot({ path: join(d, `prod-${engine}-offline.png`) }).catch(() => {})
  row.offline = offline
  await context.setOffline(false)
  result.runs.push(row)
  console.log(`run ${i + 1}: cold ${row.cold.shownMs} ms lcp ${row.cold.lcp} cls ${row.cold.cls} ${row.cold.requests} req ${row.cold.transferKB} KB | warm ${row.warm.shownMs} ms lcp ${row.warm.lcp} ${row.warm.requests} req (${row.warm.fromServiceWorker} sw, ${row.warm.onWire} wire ${row.warm.transferKB} KB) | offline ${JSON.stringify(row.offline)}`)
  await context.close()
}
await browser.close()
const col = (k, f) => runs && result.runs.map((r) => r[k][f]).filter((x) => x != null)
result.median = {}
for (const k of ['cold', 'warm'])
  result.median[k] = Object.fromEntries(['shownMs', 'fcp', 'lcp', 'cls', 'requests', 'fromServiceWorker', 'onWire', 'transferKB'].map((f) => [f, { median: median(col(k, f)), spread: spread(col(k, f)) }]))
result.headers = Object.fromEntries(headersSeen)
result.loadAtEnd = loadavg().map((x) => Math.round(x * 100) / 100)
mkdirSync(out, { recursive: true })
writeFileSync(join(out, `prod-smoke-${engine}${block ? '-blocked' : ''}.json`), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result.median, null, 1))

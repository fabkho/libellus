/**
 * Perf harness: the sign-in wall against the form. From a first launch (no service worker, empty cache,
 * no session) on the phone profile, per run: when the sign-in form is painted, the largest contentful
 * paint (time and element), what was asked of the network before the form was visible and after the
 * page settled, and how many cover images were requested before the form. The same build and run
 * conditions for a before and an after: serve each build with LIBELLUS_SERVE_ROOT=<its public dir>.
 *
 *   pnpm perf:wall [--profile slow4g-4x|chromium|webkit] [--runs 7] [--settle 8000] [--label name]
 *
 * Needs a build (pnpm perf:build) served (pnpm perf:serve). No stack: nobody is signed in. WebKit has
 * no LCP API: its row reports the form time and the cover requests only.
 */
import { chromium } from '@playwright/test'
import { launch, netLog, PROFILES, stubTheWorld, throttle } from './browser'
import { appUrl, env } from './env'

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback)
}
const profile = PROFILES[arg('profile', 'slow4g-4x')]!
const runs = Number(arg('runs', '7'))
const settle = Number(arg('settle', '8000'))
const label = arg('label', '')
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const spread = (xs: number[]) => (xs.length ? `${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)}` : '–')
const kb = (n: number) => n / 1024

const browser = await launch(profile)
const webkit = profile.engine === 'webkit'
type Row = { form: number; lcp: number; lcpEl: string; reqForm: number; kbForm: number; coversBeforeForm: number; reqAll: number; kbAll: number; coversAll: number; load: number }
const rows: Row[] = []
console.log(`${label} ${profile.name}: load average ${(await import('node:os')).loadavg()[0]!.toFixed(1)}`)
for (let i = 0; i < runs; i++) {
  const device = webkit ? (await import('@playwright/test')).devices['iPhone 15'] : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: (await import('@playwright/test')).devices['Pixel 7'].userAgent }
  const context = await browser.newContext({ ...device, colorScheme: 'dark', ignoreHTTPSErrors: true, serviceWorkers: 'allow' })
  // tsx compiles with keepNames: the helper it wraps functions in must exist in the page too.
  await context.addInitScript('window.__name = (fn) => fn')
  await context.addInitScript(() => {
    const w = window as unknown as { __wall: { form: number; lcp: { t: number; el: string }[] } }
    w.__wall = { form: 0, lcp: [] }
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => {
        const x = e as unknown as { startTime: number; element: Element | null }
        const el = x.element
        w.__wall.lcp.push({ t: x.startTime, el: el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}` : '' })
      })).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch { /* no LCP in this engine */ }
    // The form is painted at the first frame after its title exists.
    const tick = () => {
      const el = document.querySelector('[data-testid="signIn.title"]')
      if (el && (el as HTMLElement).getBoundingClientRect().height > 0) return requestAnimationFrame(() => requestAnimationFrame(() => { w.__wall.form = performance.now() }))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await stubTheWorld(context, profile)
  const page = await context.newPage()
  const cdp = webkit ? null : await context.newCDPSession(page)
  await throttle(cdp, profile)
  const net = await netLog(page, cdp)
  const t0 = Date.now()
  await page.goto(`${appUrl(profile.engine)}/sign-in`, { waitUntil: 'commit' })
  await page.getByTestId('signIn.title').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => (window as unknown as { __wall: { form: number } }).__wall.form > 0)
  await page.waitForTimeout(settle)
  const { form, lcp, resources } = await page.evaluate(() => {
    const w = window as unknown as { __wall: { form: number; lcp: { t: number; el: string }[] } }
    return { form: w.__wall.form, lcp: w.__wall.lcp, resources: performance.getEntriesByType('resource').map((r) => ({ name: r.name, start: r.startTime })) }
  })
  const last = lcp.at(-1)
  // The form is painted when its first text is (the wordmark: the first LCP candidate); WebKit has no LCP, its marker stands in.
  const painted = lcp[0]?.t ?? form
  // requests that had started when the form was painted (page clock → wall clock through t0: close, not exact)
  const before = net.entries.filter((e) => e.at - t0 <= painted)
  const covers = (xs: typeof net.entries) => xs.filter((e) => e.host === 'covers')
  rows.push({
    form,
    lcp: last?.t ?? NaN,
    lcpEl: last?.el ?? '–',
    reqForm: before.length,
    kbForm: kb(before.reduce((a, e) => a + e.transfer, 0)),
    coversBeforeForm: resources.filter((r) => /mzstatic/.test(r.name) && r.start <= painted).length,
    reqAll: net.entries.length,
    kbAll: kb(net.entries.reduce((a, e) => a + e.transfer, 0)),
    coversAll: covers(net.entries).length,
    load: 0,
  })
  const r = rows.at(-1)!
  console.log(`run ${i + 1}: form ${r.form.toFixed(0)} ms · LCP ${Number.isNaN(r.lcp) ? '–' : r.lcp.toFixed(0)} ms (${r.lcpEl}) · by the form ${r.reqForm} req ${r.kbForm.toFixed(0)} KB, ${r.coversBeforeForm} covers · settled ${r.reqAll} req ${r.kbAll.toFixed(0)} KB, ${r.coversAll} covers · api ${net.entries.filter((e) => e.host === 'supabase').length}`)
  await context.close()
}
await browser.close()
const col = (f: (r: Row) => number) => rows.map(f).filter((x) => !Number.isNaN(x))
const cell = (xs: number[]) => (xs.length ? `${median(xs).toFixed(0)} (${spread(xs)})` : '–')
console.log(`MEDIAN ${label} ${profile.name} n=${rows.length}: form ${cell(col((r) => r.form))} · LCP ${cell(col((r) => r.lcp))} · LCP element ${[...new Set(rows.map((r) => r.lcpEl))].join(' | ')} · by the form ${cell(col((r) => r.reqForm))} req / ${cell(col((r) => r.kbForm))} KB / ${cell(col((r) => r.coversBeforeForm))} covers · settled ${cell(col((r) => r.reqAll))} req / ${cell(col((r) => r.kbAll))} KB / ${cell(col((r) => r.coversAll))} covers`)
void chromium
void env

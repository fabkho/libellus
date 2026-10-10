// Run from web/: cp ../docs/perf/data/final/search-cls.ts perf/_search-cls.ts && pnpm tsx perf/_search-cls.ts slow4g-4x [--reduced]; delete the copy after.
// Stack, build and server as for `pnpm perf` (web/perf/README.md).
// Diagnosis of the search palette's CLS 0.42 (final round): what shifts when the answers land, with reduced motion, without the CPU slowdown, etc.
// Nothing here turns a certificate check off: the browser's errors are `browser.ts`'s business (the Chromium SPKI
// list, the context's `ignoreHTTPSErrors`) and this script makes no Node-side request to the TLS server.
import { launch, memberSession, newContext, PROFILES, throttle } from './browser'
import { APP_URL } from './env'
const variant = process.argv[2] ?? 'slow4g-4x'
const reduced = process.argv.includes('--reduced')
const profile = PROFILES[variant]!
const browser = await launch(profile)
const session = await memberSession()
const context = await newContext(browser, profile, session)
if (reduced) { /* new context option can't be set after; emulate on the page */ }
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await throttle(cdp, profile)
if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
await page.goto(`${APP_URL}/`, { waitUntil: 'commit' })
await page.getByTestId('home.title').waitFor({ timeout: 60000 })
await page.waitForTimeout(3000)
await page.evaluate(() => {
  const w = window as any
  w.__ls = []
  new PerformanceObserver((l) => l.getEntries().forEach((e: any) => w.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), input: e.hadRecentInput, src: (e.sources ?? []).map((s: any) => ({ n: s.node ? `${s.node.tagName.toLowerCase()}${s.node.getAttribute('data-testid') ? '[' + s.node.getAttribute('data-testid') + ']' : ''}.${[...(s.node.classList ?? [])].slice(0, 3).join('.')}` : null, from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round), to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round) })) }))).observe({ type: 'layout-shift', buffered: true })
  w.__marks = []
  document.addEventListener('keydown', () => w.__marks.push({ t: Math.round(performance.now()), what: 'keydown' }), true)
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && (n.matches?.('[data-testid="search.result"]') || n.querySelector?.('[data-testid="search.result"]'))) w.__marks.push({ t: Math.round(performance.now()), what: 'result-added' }) }).observe(document.body, { subtree: true, childList: true })
})
await page.getByTestId('shell.tab.search').tap()
await page.getByTestId('search.query').waitFor({ state: 'visible' })
await page.waitForTimeout(800)
const palette = async (label: string) => console.log(label, JSON.stringify(await page.evaluate(() => { const r = document.querySelector('[data-testid="search.result"]')?.getBoundingClientRect(); const p = document.querySelector('[data-testid="search.query"]')?.getBoundingClientRect(); return { firstResult: r && [r.x, r.y, r.width, r.height].map(Math.round), query: p && [p.x, p.y, p.width, p.height].map(Math.round), gap: document.querySelector('[data-testid="search.overlay"]') ? getComputedStyle(document.querySelector('[data-testid="search.overlay"]')!).getPropertyValue('--palette-gap') : null } })))
await palette('before typing')
await page.getByTestId('search.query').pressSequentially('piranesi', { delay: 90 })
await page.getByTestId('search.result').first().waitFor({ timeout: 20000 })
await page.waitForTimeout(2500)
await palette('after results')
const out = await page.evaluate(() => ({ ls: (window as any).__ls, marks: (window as any).__marks }))
console.log(variant, reduced ? 'reduced-motion' : 'motion')
console.log('marks', JSON.stringify(out.marks.filter((m: any, i: number, a: any[]) => m.what !== 'result-added' || i === a.findIndex((x) => x.what === 'result-added'))).slice(0, 600))
let total = 0
for (const e of out.ls) { total += e.input ? 0 : e.v; console.log(JSON.stringify(e)) }
console.log('CLS counted', total.toFixed(4))
await page.screenshot({ path: '/tmp/perf-final/search-results.png' })
await browser.close()

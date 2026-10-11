import { chromium } from '@playwright/test'
import { APP_URL, APP_SUPABASE_URL, env } from './perf/env'
import { memberSession } from './perf/browser'
const browser = await chromium.launch({ args: ['--ignore-certificate-errors', `--host-resolver-rules=${['is1-ssl.mzstatic.com', new URL(APP_SUPABASE_URL).hostname].map((h) => `MAP ${h} 127.0.0.1:${env.coverPort}`).join(', ')}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const from = process.argv[2] ?? '/profile'
for (const email of ['shelf1000@libellus.local']) {
  const session = await memberSession(email)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true })
  await context.addInitScript('window.__name = (fn) => fn')
  await context.addInitScript((s: Record<string, string>) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, session)
  const page = await context.newPage()
  await page.goto(`${APP_URL}${from}`); await page.waitForTimeout(4000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start')
  const t = Date.now()
  await page.evaluate(() => { history.pushState({}, '', '/profile/shelf'); dispatchEvent(new PopStateEvent('popstate')) })
  await page.locator('[data-testid="shelf.stage"].ready').waitFor({ timeout: 60000 })
  const ready = Date.now() - t
  await page.waitForTimeout(2500)
  const { profile } = await cdp.send('Profiler.stop') as any
  const self = new Map<string, number>()
  const total = new Map<string, number>()
  const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]))
  const parent = new Map<number, number>()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const dt = profile.timeDeltas as number[]
  const keyOf = (n: any) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`
  profile.samples.forEach((id: number, i: number) => {
    const ms = (dt[i] ?? 0) / 1000
    const n = byId.get(id)
    self.set(keyOf(n), (self.get(keyOf(n)) ?? 0) + ms)
    const seen = new Set<string>()
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) { const k = keyOf(byId.get(cur)); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) ?? 0) + ms) } }
  })
  console.log(email, 'from', from, 'ready ms', ready)
  console.log('SELF\n' + [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(0).padStart(6)} ${k}`).join('\n'))
  console.log('TOTAL\n' + [...total].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v.toFixed(0).padStart(6)} ${k}`).join('\n'))
  await context.close()
}
await browser.close()

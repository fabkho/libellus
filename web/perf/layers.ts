/** Perf harness: composited layers mid-transition (count, area, the big ones), via CDP LayerTree.  pnpm perf:layers */
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Locator } from '@playwright/test'
import { launch, memberSession, PROFILES } from './browser'
import { appUrl } from './env'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const session = await memberSession()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const browser = await launch(PROFILES.chromium!)
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block', ignoreHTTPSErrors: true })
await context.addInitScript('window.__name = (fn) => fn')
await context.addInitScript((s: Record<string, string>) => { for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v) }, session)
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
type L = { layerId: string; width: number; height: number; drawsContent: boolean; invisible?: boolean; compositingReasons?: string[] }
let snaps: L[][] = []
cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: L[] }) => e.layers && snaps.push(e.layers))
await page.goto(`${appUrl('chromium')}/`)
await page.getByTestId('home.title').waitFor()
await page.waitForLoadState('networkidle')
await cdp.send('DOM.enable')
await cdp.send('LayerTree.enable')
await sleep(1500)
const out: Record<string, unknown> = {}
async function sample(name: string, act: () => Promise<void>, wait = 1200) {
  snaps = []
  await act()
  await sleep(wait)
  const peak = snaps.reduce<{ area: number; layers: L[] }>((best, ls) => {
    const area = ls.filter((l) => l.drawsContent && !l.invisible).reduce((a, l) => a + l.width * l.height, 0)
    return area > best.area ? { area, layers: ls } : best
  }, { area: 0, layers: [] })
  const drawing = peak.layers.filter((l) => l.drawsContent && !l.invisible)
  const big = drawing.filter((l) => l.width * l.height >= 412 * 300).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8)
  const reasons: Record<string, string[]> = {}
  for (const l of big) {
    const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => null)
    reasons[`${Math.round(l.width)}x${Math.round(l.height)}#${l.layerId}`] = r?.compositingReasons ?? []
  }
  out[name] = { snapshots: snaps.length, layers: peak.layers.length, drawing: drawing.length, viewportAreas: Math.round((peak.area / (412 * 915)) * 10) / 10, estGpuMB: Math.round((peak.area * 2.625 ** 2 * 4) / 1048576), big: reasons }
  console.log(name, JSON.stringify(out[name]).slice(0, 400))
}
const tap = (l: Locator) => l.tap()
await sample('home-idle', async () => {}, 300)
await sample('home-to-book', async () => { await tap(page.locator('[data-testid="home.upNextEntry"] [data-cover]').first()) }, 150)
await sleep(1200)
await sample('book-idle', async () => {}, 300)
await sample('book-back', async () => { await tap(page.getByTestId('book.back')) }, 120)
await sleep(1200)
await sample('search-open', async () => { await tap(page.getByTestId('shell.tab.search')) }, 150)
await sleep(800)
await sample('search-idle', async () => {}, 300)
await tap(page.getByTestId('search.cancel'))
await sleep(1000)
await sample('profile-open', async () => { await tap(page.getByTestId('shell.avatar')) }, 150)
await sleep(2500)
await sample('profile-idle', async () => {}, 300)
const dir = new URL('../../.data/perf', import.meta.url).pathname
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/layers.json`, JSON.stringify(out, null, 2))
await browser.close()

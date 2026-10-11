/**
 * Does the cover flight still measure the right row? Library → Finished → scroll down → tap a row
 * far from the top → Book → Back, on whichever build the server on PERF_APP_PORT serves. Records
 * the flying cover's box on every frame and compares it with the row's own cover: the push must
 * start on it, the pop must land on it, and Back must restore the scroll place. Used for the
 * `content-visibility` rows (docs/perf/client-1-startup.md §10): run it against a build with and
 * without them.
 *
 *   pnpm tsx perf/flight-check.ts [--rows 6]     (needs the stack, the seed and the server, like pnpm perf)
 */
import { parseArgs } from 'node:util'
import { launch, memberSession, newContext, PROFILES, throttle } from './browser'
import { appUrl } from './env'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { values: args } = parseArgs({ options: { rows: { type: 'string', default: '6' }, cpu: { type: 'string', default: '4' }, scroll: { type: 'string', default: '3000' } } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const profile = { ...PROFILES['slow4g-4x']!, cpu: Number(args.cpu) }
const browser = await launch(profile)
const context = await newContext(browser, profile, await memberSession())
const page = await context.newPage()
if (process.env.DEBUG_FLIGHT)
  await context.addInitScript(() => {
    const w = window as unknown as { __rects: string[]; __log: boolean }
    w.__rects = []
    const orig = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = orig.call(this)
      if (w.__log && this.hasAttribute('data-cover') && this.closest('[data-testid="library.entry"]')) w.__rects.push(`${Math.round(performance.now())}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      return r
    }
  })
const cdp = await context.newCDPSession(page)
await throttle(cdp, profile)
await page.goto(appUrl('chromium') + '/')
await page.getByTestId('home.title').waitFor()
await sleep(2000)
await page.getByTestId('shell.tab.library').tap()
await page.getByTestId('library.entry').first().waitFor()
await page.getByTestId('library.segment.finished').tap()
await page.getByTestId('library.year').first().waitFor()
await sleep(1500)

type Box = { x: number; y: number; w: number; h: number }
const coverOf = (index: number) =>
  page.evaluate((i) => {
    const row = document.querySelectorAll('[data-testid="library.entry"]')[i]
    const r = row?.querySelector('[data-cover]')?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  }, index)
const rows: string[] = []
const dist = (a: Box, b: Box) => Math.round(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)) * 10) / 10
let bad = 0
for (let n = 0; n < Number(args.rows); n++) {
  // Scroll somewhere far from the top, a different place each round, and let the page settle.
  const y = Number(args.scroll) + n * 1500
  await page.evaluate((top) => window.scrollTo({ top }), y)
  await sleep(1200)
  const scrollBefore = await page.evaluate(() => Math.round(window.scrollY))
  // The row nearest the screen's middle.
  const index = await page.evaluate(() => {
    const mid = window.innerHeight / 2
    const all = [...document.querySelectorAll('[data-testid="library.entry"]')]
    let best = 0
    let gap = Infinity
    all.forEach((e, i) => {
      const r = e.getBoundingClientRect()
      const g = Math.abs(r.top + r.height / 2 - mid)
      if (g < gap) (gap = g), (best = i)
    })
    return best
  })
  const before = await coverOf(index)
  await page.evaluate(() => {
    const w = window as unknown as { __flightBoxes: { t: number; x: number; y: number; w: number; h: number }[] }
    w.__flightBoxes = []
    const tick = () => {
      const el = document.querySelector('[data-testid="shell.flightCover"]')
      const r = el?.getBoundingClientRect()
      if (r && r.width > 0) w.__flightBoxes.push({ t: performance.now(), x: r.x, y: r.y, w: r.width, h: r.height })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.getByTestId('library.entry').nth(index).tap()
  await page.getByTestId('book.hero').waitFor({ timeout: 20000 })
  await sleep(1500)
  const push = await page.evaluate(() => (window as unknown as { __flightBoxes: Box[] }).__flightBoxes.slice())
  await page.evaluate(() => ((window as unknown as { __flightBoxes: Box[] }).__flightBoxes = []))
  if (process.env.DEBUG_FLIGHT) await page.evaluate(() => void ((window as unknown as { __log: boolean; __rects: string[] }).__log = true, ((window as unknown as { __rects: string[] }).__rects.length = 0)))
  await page.getByTestId('book.back').tap()
  await page.getByTestId('library.entry').first().waitFor()
  await sleep(1800)
  const pop = await page.evaluate(() => (window as unknown as { __flightBoxes: Box[] }).__flightBoxes.slice())
  if (process.env.DEBUG_FLIGHT) console.log((await page.evaluate(() => (window as unknown as { __rects: string[] }).__rects.slice(0, 8))).join(' | '))
  const after = await coverOf(index)
  if (process.env.DEBUG_FLIGHT) console.log('after', JSON.stringify(after), await page.evaluate(() => ({ rows: document.querySelectorAll('[data-testid="library.entry"]').length, seg: document.querySelector('[role=tab][aria-selected=true]')?.textContent, y: window.scrollY, h: document.documentElement.scrollHeight, url: location.pathname })))
  const scrollAfter = await page.evaluate(() => Math.round(window.scrollY))
  const pushStart = push[0] && before ? dist(push[0], before) : null
  const popEnd = pop.at(-1) && after ? dist(pop.at(-1)!, after) : null
  const ok = push.length > 3 && pop.length > 3 && pushStart !== null && pushStart < 3 && popEnd !== null && popEnd < 3 && Math.abs(scrollAfter - scrollBefore) <= 2
  if (!ok) bad++
  rows.push(`row ${index} scroll ${scrollBefore}→${scrollAfter}: push ${push.length} frames, starts ${pushStart} px off its cover; pop ${pop.length} frames, lands ${popEnd} px off the row's cover ${ok ? 'OK' : 'FAIL'}`)
}
console.log(rows.join('\n'))
console.log(bad ? `${bad} of ${rows.length} rounds FAILED` : `all ${rows.length} rounds fine`)
await browser.close()

/**
 * Image census: every <img> the app renders on its screens, as the phone would have it (412 x 915,
 * DPR 2.625): what loads, what waits, how it is declared. A lazy-loading audit's evidence.
 *
 *   pnpm perf:images                          all screens, Chromium, Slow 4G network (no CPU slowdown)
 *   pnpm perf:images --screens home,library   some of them
 *   pnpm perf:images --json out.json          the raw census too
 *
 * Per screen it reports, after the page was quiet for a second: the `<img>` elements in the DOM, how
 * many are `loading="lazy"` / eager, how many have `decoding="async"`, how many are on screen
 * (their box meets the viewport), how many have loaded (`naturalWidth`), how many were requested
 * (the network log) and their bytes; and lists the images that load without being on screen
 * ("eager and off-screen" or lazy but within the browser's distance), and the images that are on
 * screen but not loaded. Needs the stack, the build and the server like `pnpm perf`.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { Page } from '@playwright/test'
import { launch, memberSession, netLog, newContext, PROFILES, throttle } from './browser'
import { appUrl } from './env'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'slow4g-4x' },
    screens: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    /** Throttle the network only: the CPU is not what a census is about. */
    cpu: { type: 'string', default: '1' },
  },
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type Img = {
  src: string
  loading: string
  decoding: string
  fetchpriority: string
  /** The width / height attributes (intrinsic size hints), if any. */
  attrSize: string
  box: { x: number; y: number; w: number; h: number }
  onScreen: boolean
  loaded: boolean
  /** Where it sits: the nearest ancestor with a test id or a class. */
  where: string
  hidden: boolean
}

/** Runs in the page. */
function census(): Img[] {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const where = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const id = n.getAttribute('data-testid')
      if (id) return id
    }
    return el.parentElement?.className?.toString().split(' ')[0] ?? ''
  }
  return [...document.querySelectorAll('img')].map((img) => {
    const r = img.getBoundingClientRect()
    const cs = getComputedStyle(img)
    // Hidden by a kept-alive page (display: none above it) or by size.
    const hidden = img.offsetParent === null && cs.position !== 'fixed'
    return {
      src: img.currentSrc || img.src,
      loading: img.loading,
      decoding: img.decoding,
      fetchpriority: img.getAttribute('fetchpriority') ?? '',
      attrSize: img.getAttribute('width') ? `${img.getAttribute('width')}x${img.getAttribute('height')}` : '',
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      onScreen: !hidden && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0,
      loaded: img.naturalWidth > 0,
      where: where(img),
      hidden,
    }
  })
}

type Screen = { id: string; label: string; go: (page: Page) => Promise<void>; then?: (page: Page) => Promise<void> }

const push = (page: Page, path: string) =>
  page.evaluate((to) => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(to: string): void } } } } }).__vue_app__
    app.config.globalProperties.$router.push(to)
  }, path)
const tap = (page: Page, testid: string, nth = 0) => page.getByTestId(testid).nth(nth).tap({ timeout: 15000 })
const wait = (page: Page, testid: string) => page.getByTestId(testid).first().waitFor({ state: 'visible', timeout: 20000 })
const scrollBottom = async (page: Page) => {
  let last = -1
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => window.scrollBy(0, 900))
    await sleep(250)
    const y = await page.evaluate(() => Math.round(window.scrollY))
    if (y === last) break
    last = y
  }
}

const SCREENS: Screen[] = [
  { id: 'home', label: 'Home', go: async (p) => void (await p.goto(appUrl('chromium') + '/')), then: (p) => wait(p, 'home.title') },
  { id: 'library', label: 'Library (top)', go: (p) => tap(p, 'shell.tab.library'), then: (p) => wait(p, 'library.entry') },
  { id: 'library-bottom', label: 'Library (scrolled to the bottom)', go: scrollBottom },
  { id: 'profile', label: 'Profile', go: (p) => tap(p, 'shell.avatar'), then: (p) => wait(p, 'profile.figures') },
  { id: 'year', label: 'Profile → year', go: async (p) => void (await p.locator('a[href^="/profile/20"]').first().tap()), then: sleepFor(2000) },
  { id: 'collections', label: 'Collections', go: async (p) => void (await push(p, '/collections')), then: sleepFor(1500) },
  { id: 'collection', label: 'A collection', go: async (p) => void (await p.locator('a[href^="/collections/"]').first().tap()), then: sleepFor(1500) },
  { id: 'book', label: 'Book page', go: async (p) => void (await push(p, '/library')), then: async (p) => {
      await wait(p, 'library.entry')
      await sleep(600)
      await tap(p, 'library.entry', 2)
      await wait(p, 'book.hero')
      await sleep(1500)
    } },
  { id: 'search', label: 'Search: "piranesi"', go: async (p) => void (await tap(p, 'shell.tab.search')), then: async (p) => {
      await wait(p, 'search.query')
      await p.getByTestId('search.query').pressSequentially('piranesi', { delay: 60 })
      await wait(p, 'search.result')
      await sleep(1500)
    } },
]
function sleepFor(ms: number) {
  return async () => void (await sleep(ms))
}

async function main() {
  const profile = { ...PROFILES[args.profile!]!, cpu: Number(args.cpu) }
  const only = new Set(args.screens!.split(',').filter(Boolean))
  const browser = await launch(profile)
  const context = await newContext(browser, profile, await memberSession())
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const net = await netLog(page, cdp)
  await throttle(cdp, profile)
  await page.goto(appUrl(profile.engine) + '/')
  await wait(page, 'home.title')
  const rows: unknown[] = []
  const quiet = async (ms = 1200) => {
    const t0 = Date.now()
    let since = Date.now()
    while (Date.now() - t0 < 30000) {
      if (net.inFlight() > 0) since = Date.now()
      else if (Date.now() - since >= ms) return
      await sleep(100)
    }
  }
  for (const screen of SCREENS) {
    if (only.size && !only.has(screen.id)) continue
    const from = Date.now()
    try {
      await screen.go(page)
      await screen.then?.(page)
      await quiet()
    } catch (e) {
      console.log(`${screen.id}: ${(e as Error).message.split('\n')[0]}`)
      continue
    }
    const imgs = await page.evaluate(census)
    const reqs = net.entries.filter((e) => e.at >= from && e.host === 'covers')
    const other = imgs.filter((i) => !/mzstatic|openlibrary/.test(i.src))
    const bytes = reqs.reduce((n, e) => n + (e.decoded || e.transfer), 0)
    const visible = imgs.filter((i) => !i.hidden)
    const count = (f: (i: Img) => boolean) => visible.filter(f).length
    const eagerOff = visible.filter((i) => i.loading !== 'lazy' && !i.onScreen && i.loaded)
    const lazyOff = visible.filter((i) => i.loading === 'lazy' && !i.onScreen && i.loaded)
    const waiting = visible.filter((i) => !i.loaded && i.onScreen)
    rows.push({ screen: screen.id, label: screen.label, imgs: imgs.length, hidden: imgs.length - visible.length, lazy: count((i) => i.loading === 'lazy'), eager: count((i) => i.loading !== 'lazy'), asyncDecode: count((i) => i.decoding === 'async'), onScreen: count((i) => i.onScreen), loaded: count((i) => i.loaded), coverRequests: reqs.length, coverKB: Math.round(bytes / 1024), eagerOffScreenLoaded: eagerOff.map((i) => `${i.where} y${i.box.y} x${i.box.x}`), lazyOffScreenLoaded: lazyOff.length, onScreenNotLoaded: waiting.map((i) => i.where), nonCover: other.map((i) => `${i.where}: ${i.src.slice(-40)}`), all: imgs })
  }
  if (!only.size || only.has('sign-in')) {
    // Signed out: a context with no session; the way-in's wall of covers.
    const out = await newContext(browser, profile, {})
    const p = await out.newPage()
    const c = await out.newCDPSession(p)
    const n = await netLog(p, c)
    // Not throttled: under CDP's network emulation these responses never finish here (a signed-out first visit has no service worker); the bytes do not depend on it.
    void c
    await p.goto(appUrl(profile.engine) + '/sign-in')
    await p.getByTestId('signIn.brand').first().waitFor({ timeout: 20000 }).catch(() => {})
    await sleep(3000)
    const imgs = await p.evaluate(census)
    // No service worker controls a signed-out first visit, and CDP then never reports these as finished: ask the page.
    const timing = await p.evaluate(() => performance.getEntriesByType('resource').filter((e) => /mzstatic/.test(e.name)).map((e) => ({ decoded: (e as PerformanceResourceTiming).decodedBodySize, transfer: (e as PerformanceResourceTiming).transferSize })))
    void n
    const reqs = timing.map((e) => ({ decoded: e.decoded, transfer: e.transfer }))
    const vis = imgs.filter((i) => !i.hidden)
    rows.push({ screen: 'sign-in', label: 'Sign in (signed out)', imgs: imgs.length, hidden: imgs.length - vis.length, lazy: vis.filter((i) => i.loading === 'lazy').length, eager: vis.filter((i) => i.loading !== 'lazy').length, asyncDecode: vis.filter((i) => i.decoding === 'async').length, onScreen: vis.filter((i) => i.onScreen).length, loaded: vis.filter((i) => i.loaded).length, coverRequests: reqs.length, coverKB: Math.round(reqs.reduce((a, e) => a + (e.decoded || e.transfer), 0) / 1024), eagerOffScreenLoaded: vis.filter((i) => i.loading !== 'lazy' && !i.onScreen && i.loaded).map((i) => i.where), lazyOffScreenLoaded: vis.filter((i) => i.loading === 'lazy' && !i.onScreen && i.loaded).length, onScreenNotLoaded: vis.filter((i) => !i.loaded && i.onScreen).map((i) => i.where), nonCover: [], all: imgs })
  }
  await browser.close()
  console.log(`\nImage census, ${profile.name} (network throttled, CPU ${profile.cpu}x), ${new Date().toISOString().slice(0, 10)}\n`)
  console.log('| screen | `<img>` | hidden | lazy | eager | decoding=async | on screen | loaded | cover requests | cover KB | eager & off screen (loaded) | lazy & off screen (loaded) | on screen, not loaded |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const r of rows as Record<string, any>[]) console.log(`| ${r.label} | ${r.imgs} | ${r.hidden} | ${r.lazy} | ${r.eager} | ${r.asyncDecode} | ${r.onScreen} | ${r.loaded} | ${r.coverRequests} | ${r.coverKB} | ${r.eagerOffScreenLoaded.length} | ${r.lazyOffScreenLoaded} | ${r.onScreenNotLoaded.length} |`)
  console.log()
  for (const r of rows as Record<string, any>[]) {
    if (r.eagerOffScreenLoaded.length) console.log(`${r.screen}: eager and off screen: ${r.eagerOffScreenLoaded.join('; ')}`)
    if (r.onScreenNotLoaded.length) console.log(`${r.screen}: on screen, not loaded: ${r.onScreenNotLoaded.join('; ')}`)
    if (r.nonCover.length) console.log(`${r.screen}: not a cover host: ${r.nonCover.join('; ')}`)
  }
  if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1))
}
await main()

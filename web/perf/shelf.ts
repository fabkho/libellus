/**
 * Your shelf for everyone: the proof the owner looks at, and the numbers of a 1,000-Book shelf.
 * Outside the Playwright flows (`pnpm e2e` never runs it): a script on the perf harness, against
 * the production build with Regal (LIBELLUS_REGAL=1) served like Pages (perf/serve.mjs) and the
 * members of perf/shelf-seed.ts on a throwaway stack.
 *
 *   LIBELLUS_REGAL=1 REGAL_LAYER=<regal checkout> pnpm perf:build
 *   pnpm perf:shelf-seed && pnpm perf:serve &
 *   pnpm perf:shelf                       # everything: --only proof|numbers|sheet
 *
 * Writes screenshots, a video and numbers.json to SHELF_OUT (default /tmp/shelf-for-everyone) and
 * copies them to the repository's `.shots/` (ignored by git). At 390 × 844, as an iPhone 15.
 *   proof    a member with 40 Books: the Profile's row, the loading pile, the Stack, a Book out
 *            (front, back, spine), offline; a member with none: the empty states; a member with
 *            1,000: the pile, the Stack, a Book out. A video of the first.
 *   numbers  the 1,000-Book shelf on Chromium with the CPU 4x slower: what Home fetches of the 3D
 *            (nothing), time to the pile and to the Stack's first draw, frames while flinging the
 *            pile (gaps over 50 ms), JS heap, the typeset Spines alive and their texture memory.
 *   sheet    the colour rule on the contact sheet's twelve covers: before (the cover's most common
 *            colour as it is) and after (the guard rails, the ink by WCAG contrast).
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { coverColors } from '../app/data/covers'
import { calmColour, contrast, SHELF_INK, SHELF_PAPER } from '../app/utils/bookColour'
import { APP_URL, APP_SUPABASE_URL, env } from './env'
import { COLLECT, memberSession } from './browser'
import { CONTACT_SHEET, coverJpeg, coverPixels } from './shelfCovers'
import { SHELF_MEMBERS } from './shelf-seed-members'

const OUT = process.env.SHELF_OUT ?? '/tmp/shelf-for-everyone'
const SHOTS = new URL('../../.shots/', import.meta.url).pathname
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })

const PHONE = { width: 390, height: 844 }
const numbers: Record<string, unknown> = {}

async function launch(): Promise<Browser> {
  return chromium.launch({
    args: [
      '--ignore-certificate-errors',
      // Covers, the API and third parties are perf/serve.mjs (perf/browser.ts does the same).
      `--host-resolver-rules=${['is1-ssl.mzstatic.com', new URL(APP_SUPABASE_URL).hostname, 'itunes.apple.com', 'openlibrary.org', 'covers.openlibrary.org', 'static.cloudflareinsights.com', 'cloudflareinsights.com'].map((h) => `MAP ${h} 127.0.0.1:${env.coverPort}`).join(', ')}`,
      '--enable-precise-memory-info',
      // The GPU, not SwiftShader: the frames a phone's GPU would draw, not a CPU's emulation of one.
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
    ],
  })
}

async function member(browser: Browser, email: string, video?: string, colorScheme: 'dark' | 'light' = 'dark'): Promise<{ context: BrowserContext; page: Page }> {
  const session = await memberSession(email)
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow',
    ...(video ? { recordVideo: { dir: join(OUT, 'video-tmp'), size: PHONE } } : {}),
  })
  await context.addInitScript('window.__name = (fn) => fn')
  await context.addInitScript(COLLECT)
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
  }, session)
  return { context, page: await context.newPage() }
}

async function shot(page: Page, name: string) {
  const file = join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  ${name}.png`)
}

const settle = (page: Page, ms: number) => page.waitForTimeout(ms)

/** The Stack has drawn (ShelfStage's `ready`: the 3D faded in over the pile). */
const stackReady = (page: Page) => page.locator('[data-testid="shelf.stage"].ready').waitFor({ timeout: 60_000 })

/** Takes a Book out through Regal's own Book list (the buttons assistive technology uses), as a tap would. */
async function takeOut(page: Page, index: number) {
  await page.locator('[data-testid="shelf.stage"] [role="list"] button').nth(index).evaluate((button: HTMLButtonElement) => button.click())
  await settle(page, 2200)
}

/** Turns the Book that is out a quarter round with a drag, to show its Spine. */
async function turnToSpine(page: Page) {
  const box = await page.locator('[data-testid="shelf.stage"] canvas').first().boundingBox()
  if (!box) return
  const y = box.y + box.height * 0.42
  const x = box.x + box.width * 0.5
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 9, y, { steps: 2 })
  await page.mouse.up()
  await settle(page, 1600)
}

async function proof(browser: Browser) {
  console.log('proof: 40 Books')
  {
    const { context, page } = await member(browser, SHELF_MEMBERS.forty.email, 'shelf-40')
    await page.goto(`${APP_URL}/profile`)
    const section = page.getByTestId('profile.shelf')
    await section.scrollIntoViewIfNeeded()
    await page.getByTestId('profile.shelfRow').waitFor()
    await settle(page, 4500)
    await section.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await settle(page, 1200)
    await shot(page, '01-profile-row-40')

    // Regal's entrance: the Books dropping into place, caught on the way.
    await page.getByTestId('profile.shelfAll').click()
    await stackReady(page)
    await settle(page, 450)
    await shot(page, '02-entrance-40')
    await settle(page, 3000)
    await shot(page, '03-stack-40')

    await takeOut(page, 2)
    await shot(page, '04-book-front-40')
    await page.getByTestId('shelf.flip').click()
    await settle(page, 1500)
    await shot(page, '05-book-back-40')
    await page.getByTestId('shelf.flip').click()
    await settle(page, 1200)
    await turnToSpine(page)
    await shot(page, '06-book-spine-40')
    await page.getByTestId('shelf.putBack').click()
    await settle(page, 1500)

    // A Book without a cover of its own would be the Placeholder's cloth; here a scroll down the pile.
    const canvas = page.locator('[data-testid="shelf.stage"] canvas').first()
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 260)
      await settle(page, 120)
    }
    await settle(page, 1500)
    await shot(page, '07-stack-scrolled-40')

    // Offline: the shelf comes from the device's Library, the 3D from the service worker's cache.
    await context.setOffline(true)
    await page.reload()
    await page.getByTestId('shelf').waitFor()
    await stackReady(page).catch(() => undefined)
    await settle(page, 2500)
    await shot(page, '08-offline-stack-40')
    await context.setOffline(false)

    const video = page.video()
    await context.close()
    if (video) copyFileSync(await video.path(), join(OUT, 'shelf-40.webm'))
  }

  console.log('proof: nothing finished yet')
  {
    const { context, page } = await member(browser, SHELF_MEMBERS.empty.email)
    await page.goto(`${APP_URL}/profile`)
    const section = page.getByTestId('profile.shelf')
    await section.waitFor()
    await page.getByTestId('profile.shelfEmpty').waitFor()
    await section.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await settle(page, 800)
    await shot(page, '09-profile-empty')
    await page.goto(`${APP_URL}/profile/shelf`)
    await page.getByTestId('shelf.emptyState').waitFor()
    await settle(page, 800)
    await shot(page, '10-shelf-empty')
    await context.close()
  }

  console.log('proof: 1,000 Books')
  {
    const { context, page } = await member(browser, SHELF_MEMBERS.thousand.email, 'shelf-1000')
    await page.goto(`${APP_URL}/profile`)
    await page.getByTestId('profile.shelfRow').waitFor()
    await settle(page, 2000)
    await page.getByTestId('profile.shelfAll').click()
    await stackReady(page)
    await settle(page, 450)
    await shot(page, '11-entrance-1000')
    await settle(page, 3000)
    await shot(page, '12-stack-1000')
    await takeOut(page, 40)
    await shot(page, '13-book-front-1000')
    await page.getByTestId('shelf.flip').click()
    await settle(page, 1500)
    await shot(page, '14-book-back-1000')
    const video = page.video()
    await context.close()
    if (video) copyFileSync(await video.path(), join(OUT, 'shelf-1000.webm'))
  }
}

async function measure(browser: Browser) {
  console.log('numbers: 1,000 Books, Chromium, CPU 4x slower')
  const { context, page } = await member(browser, SHELF_MEMBERS.thousand.email)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const regalRequests: string[] = []
  page.on('request', (request) => {
    if (/\/_nuxt\/regal(?:-reel)?\.[^/]+\.js$/.test(request.url())) regalRequests.push(request.url())
  })

  // Home and the Library tab first: a member who never opens a shelf fetches nothing of it.
  await page.goto(`${APP_URL}/`)
  await page.getByTestId('home.title').waitFor({ timeout: 30_000 }).catch(() => undefined)
  await settle(page, 4000)
  await page.goto(`${APP_URL}/library`)
  await settle(page, 3000)
  numbers.regalChunkBeforeTheShelf = regalRequests.length
  numbers.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  // The precache: the service worker's list never names the 3D.
  numbers.regalInPrecache = await page.evaluate(async () => (await (await fetch('/sw.js')).text()).match(/regal(?:-reel)?\.[\w-]+\.js/g)?.length ?? 0)

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const heapBefore = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
  const started = Date.now()
  await page.goto(`${APP_URL}/profile/shelf?debug=loads`)
  await page.getByTestId('shelf').waitFor()
  const pile = Date.now() - started
  await stackReady(page)
  const firstDraw = Date.now() - started
  await settle(page, 4000)
  numbers.timeToScreenMs = pile
  numbers.timeToStackMs = firstDraw
  numbers.regalChunkAfterTheShelf = regalRequests.length

  // Fling down the pile and back, sampling every frame.
  const canvas = page.locator('[data-testid="shelf.stage"] canvas').first()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.evaluate(() => {
    const perf = (window as unknown as { __perf: { frames: number[]; sampling: boolean } }).__perf
    perf.frames = []
    perf.sampling = true
  })
  const flat: unknown[] = []
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 420)
    await settle(page, 60)
    if (i % 10 === 9) flat.push(await page.evaluate(() => (window as { __regalFlat?: unknown }).__regalFlat))
  }
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -840)
    await settle(page, 60)
  }
  await settle(page, 1500)
  const frames = await page.evaluate(() => {
    const perf = (window as unknown as { __perf: { frames: number[]; sampling: boolean } }).__perf
    perf.sampling = false
    return perf.frames
  })
  const gaps = frames.slice(1).map((t, i) => t - frames[i]!)
  const sorted = [...gaps].sort((a, b) => a - b)
  const quantile = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0)
  numbers.fling = {
    frames: gaps.length,
    medianFrameMs: quantile(0.5),
    p95FrameMs: quantile(0.95),
    longFramesOver50ms: gaps.filter((g) => g > 50).length,
    worstFrameMs: Math.round(sorted.at(-1) ?? 0),
  }
  const typeset = (await page.evaluate(() => (window as { __regalFlat?: { books: number; typeset: number; pixels: number } }).__regalFlat)) ?? null
  numbers.typesetSpines = { atRest: typeset, duringFling: flat }
  if (typeset) numbers.typesetSpineTextureMB = Math.round(((typeset.pixels * 4 * 4) / 3 / 1024 / 1024) * 10) / 10
  numbers.allSpinesTypesetWouldBeMB = typeset && typeset.typeset ? Math.round(((typeset.pixels / typeset.typeset) * typeset.books * 4 * 4) / 3 / 1024 / 1024) : null
  const metrics = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }
  const metric = (name: string) => metrics.metrics.find((m) => m.name === name)?.value ?? 0
  const heapAfter = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
  numbers.jsHeapMB = { beforeTheShelf: Math.round(heapBefore.usedSize / 1048576), withTheStack: Math.round(heapAfter.usedSize / 1048576) }
  numbers.domNodes = metric('Nodes')
  const loads = (await page.evaluate(() => (window as { __regalLoads?: { face: string }[] }).__regalLoads ?? [])).filter((l) => l.face === 'front').length
  numbers.frontsLoaded = loads

  // Opened again from the Profile, as a member does (Show all), the 3D's code in the cache: the
  // time to the pile and to the Stack's first frame, and the main thread's long tasks meanwhile.
  await page.goto(`${APP_URL}/profile`)
  await page.getByTestId('profile.shelfAll').waitFor()
  await settle(page, 3000)
  const mark = await page.evaluate(() => performance.now())
  const warmStarted = Date.now()
  await page.getByTestId('profile.shelfAll').click()
  await page.getByTestId('shelf').waitFor()
  const warmPile = Date.now() - warmStarted
  await stackReady(page)
  numbers.fromProfile = {
    toScreenMs: warmPile,
    toStackMs: Date.now() - warmStarted,
    longTasks: await page.evaluate((from) => {
      const perf = (window as unknown as { __perf: { longtasks: { startTime: number; duration: number }[] } }).__perf
      const tasks = perf.longtasks.filter((t) => t.startTime >= from)
      return { count: tasks.length, totalMs: Math.round(tasks.reduce((sum, t) => sum + t.duration, 0)), longestMs: Math.round(Math.max(0, ...tasks.map((t) => t.duration))) }
    }, mark),
  }
  await context.close()
  console.log(JSON.stringify(numbers, null, 2))
}

async function contactSheet(browser: Browser) {
  console.log('sheet: the colour rule on twelve covers')
  const rows: string[] = []
  const hexToRgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
  for (const cover of CONTACT_SHEET) {
    const image = (await coverJpeg(cover, 240, 360)).toString('base64')
    const raw = coverColors(await coverPixels(cover)).dominant
    const rgb = hexToRgb(raw)
    // Before: the most common colour as it is, the ink the old Spine chose (brightness over 128 → near-black).
    const naiveInk = (rgb[0] + rgb[1] + rgb[2]) / 3 > 128 ? '#111111' : '#eeeeee'
    const before = { colour: raw, ink: naiveInk, contrast: Math.round(contrast(rgb, hexToRgb(naiveInk)) * 100) / 100 }
    const after = calmColour(raw)
    const book = (side: { colour: string; ink: string; contrast: number }) => `
      <div class="book">
        <div class="spine" style="background:${side.colour};color:${side.ink}"><span class="t">${cover.title}</span><span class="a">${cover.author}</span></div>
        <div class="back" style="background:${side.colour};color:${side.ink}"><b>${cover.title}</b><i>${cover.author}</i><s></s></div>
      </div>
      <p class="hex">${side.colour} · ${side.ink === SHELF_INK ? 'dark ink' : side.ink === SHELF_PAPER ? 'light ink' : `ink ${side.ink}`} · ${side.contrast.toFixed(2)}:1${side.contrast < 4.5 ? ' ✕' : ''}</p>`
    rows.push(`<div class="row"><img src="data:image/jpeg;base64,${image}"><div>${book(before)}</div><div>${book(after)}</div></div>`)
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:28px 32px;background:#f5f2eb;color:#2c2c2a;font:13px/1.35 'IBM Plex Mono',ui-monospace,monospace}
    h1{font:600 20px Georgia,serif;margin:0 0 4px}.sub{margin:0 0 18px;color:#6b665c}
    .head,.row{display:grid;grid-template-columns:110px 1fr 1fr;gap:24px;align-items:center}
    .head{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b665c;padding-bottom:8px;border-bottom:1px solid #d8d2c4;margin-bottom:10px}
    .row{padding:8px 0;border-bottom:1px solid #e4dfd3}img{width:72px;height:108px;object-fit:cover;box-shadow:0 1px 3px rgba(0,0,0,.25)}
    .book{display:flex;gap:6px;height:108px}.spine{width:26px;writing-mode:vertical-rl;display:flex;align-items:center;gap:8px;padding:8px 0;font:600 11px Georgia,serif;white-space:nowrap;overflow:hidden;border-radius:2px}
    .spine .a{font:400 9px Helvetica,sans-serif;opacity:.85}.back{width:72px;padding:12px 8px;display:flex;flex-direction:column;gap:3px;border-radius:2px}
    .back b{font:600 10px/1.2 Georgia,serif;opacity:.92}.back i{font:400 8px Georgia,serif;opacity:.72;font-style:normal}.back s{display:block;width:14px;height:1px;background:currentColor;opacity:.35;margin-top:4px}
    .hex{margin:4px 0 0;font-size:10px;color:#6b665c}
  </style>
  <h1>One colour per Book: the rule on twelve covers</h1>
  <p class="sub">Spine and back in the cover's most common colour. Before: as it comes. After: saturation ≤ 0.55, lightness 0.14–0.84, out of the middle band until the ink (ink or paper, by WCAG contrast) reads at ≥ 4.5:1.</p>
  <div class="head"><span>Cover</span><span>Before</span><span>After</span></div>
  ${rows.join('')}`
  const page = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 })
  await page.setContent(html)
  await page.screenshot({ path: join(OUT, '00-contact-sheet.png'), fullPage: true })
  await page.close()
  console.log('  00-contact-sheet.png')
}

const browser = await launch()
try {
  if (!only || only === 'sheet') await contactSheet(browser)
  if (!only || only === 'proof') await proof(browser)
  if (!only || only === 'numbers') {
    await measure(browser)
    writeFileSync(join(OUT, 'numbers.json'), `${JSON.stringify(numbers, null, 2)}\n`)
  }
} finally {
  await browser.close()
}
for (const file of readdirSync(OUT)) if (/\.(png|webm|json)$/.test(file)) copyFileSync(join(OUT, file), join(SHOTS, file))
console.log(`written to ${OUT} and ${SHOTS}`)

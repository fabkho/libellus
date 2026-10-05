/**
 * The page never moves sideways, on a real device: Chrome on the Android
 * emulator, driven over adb and the DevTools protocol like `smoke.ts`
 * (docs/TESTING.md). On every main screen it writes down whether the document is
 * wider than the viewport (`scrollWidth` against `clientWidth`, and the visual
 * viewport's offset) and which elements stick out; on the Profile it puts a real
 * finger on the page and swipes it sideways (the page must stay), then on the
 * year cards and on Regal's row (they must scroll). Not part of CI.
 *
 *   pnpm tsx e2e/android/scroll-x.ts --base http://localhost:3128 --email <the owner's address>
 *
 * The app must be served with NUXT_PUBLIC_SHELF_OWNER_ID set to that member's id
 * (the Profile then shows the shelf row). Screenshots (`scroll-x-<step>.jpg`, whole
 * screen, at most 1000 px high) and the measurements (`scroll-x.json`) go to `--out`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { emailCooldown, stack } from '../../tests/support/stack'

/** The newest mail to an address (Mailpit's search lists at most 50, which a long-lived dev address passes: a count never moves). */
const newestMail = async (email: string) =>
  ((await (await fetch(`${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`)).json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID
/** The six-digit code of the first mail to the address after `previous`. */
async function codeAfter(email: string, previous: string | undefined) {
  for (let i = 0; i < 60; i++) {
    const id = await newestMail(email)
    if (id && id !== previous) {
      const { Text } = (await (await fetch(`${stack.mailUrl}/api/v1/message/${id}`)).json()) as { Text: string }
      return Text.match(/\b(\d{6})\b/)![1]!
    }
    await sleep(300)
  }
  throw new Error(`No mail arrived for ${email}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3128' },
    out: { type: 'string', default: '/tmp/libellus-scroll-x' },
    email: { type: 'string', default: 'dev@libellus.local' },
    year: { type: 'string', default: '2025' },
    serial: { type: 'string' },
  },
})
const OUT = args.out!
mkdirSync(OUT, { recursive: true })

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, [...(args.serial ? ['-s', args.serial] : []), ...command], { maxBuffer: 64 * 1024 * 1024 })
const shell = (command: string) => adb('shell', command).toString()

async function screenshot(name: string) {
  const png = adb('exec-out', 'screencap', '-p')
  await sharp(png).resize({ height: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, `scroll-x-${name}.jpg`))
}

type Origin = { x: number; y: number; dpr: number }

/** Where the page's (0, 0) is on the screen, in device pixels: a calibration tap the page swallows. */
async function pageOrigin(page: Page, yDevice: number): Promise<Origin> {
  const [width] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number)
  const at = { x: Math.round(width! / 2), y: yDevice }
  const seen = page.evaluate(
    () =>
      new Promise<{ x: number; y: number; dpr: number }>((resolve) => {
        const swallow = (event: TouchEvent) => {
          event.preventDefault()
          event.stopImmediatePropagation()
          window.removeEventListener('touchstart', swallow, true)
          resolve({ x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, dpr: devicePixelRatio })
        }
        window.addEventListener('touchstart', swallow, { capture: true, passive: false })
      }),
  )
  await sleep(200)
  shell(`input tap ${at.x} ${at.y}`)
  const css = await seen
  return { x: at.x - css.x * css.dpr, y: at.y - css.y * css.dpr, dpr: css.dpr }
}
const device = (o: Origin, [x, y]: [number, number]) => `${Math.round(o.x + x * o.dpr)} ${Math.round(o.y + y * o.dpr)}`
const swipe = (o: Origin, from: [number, number], to: [number, number], ms = 300) => shell(`input swipe ${device(o, from)} ${device(o, to)} ${ms}`)

/** Is the document wider than the viewport, is the page moved, and which elements stick out (not clipped by an ancestor that scrolls or clips). */
const probe = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement
    const width = root.clientWidth
    const clippedBy = (el: Element) => {
      // An absolutely positioned element is clipped only by ancestors between it and its containing block.
      for (let parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return true
        const position = getComputedStyle(el).position
        if (position === 'fixed') return false
      }
      return false
    }
    const outside: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if ((!box.width && !box.height) || (box.right <= width + 0.5 && box.left >= -0.5)) continue
      if (clippedBy(el)) continue
      outside.push(`${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')} ${Math.round(box.left)}..${Math.round(box.right)} ${getComputedStyle(el).position}`)
    }
    const vv = window.visualViewport
    return {
      url: location.pathname,
      scrollWidth: root.scrollWidth,
      clientWidth: width,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth,
      scrollX: Math.round(scrollX * 100) / 100,
      visualWidth: vv?.width,
      visualPageLeft: vv?.pageLeft,
      visualOffsetLeft: vv?.offsetLeft,
      wider: root.scrollWidth > width,
      outside,
    }
  })

async function main() {
  for (const port of [new URL(args.base!).port, new URL(stack.url).port]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
  shell(`am start -a android.intent.action.VIEW -d ${args.base}/ com.android.chrome`)
  await sleep(2500)

  const browser = await chromium.connectOverCDP('http://localhost:9333')
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((p) => p.url().startsWith(args.base!))
    .at(-1)
  if (!page) throw new Error(`No Chrome tab on ${args.base}`)
  await page.bringToFront()
  const keepNames = 'window.__name = (fn) => fn'
  await page.context().addInitScript(keepNames)
  await page.evaluate(keepNames)

  // The published library file, fetched here and handed to the page with CORS (the emulator's Chrome may not reach it, or the bucket not answer a localhost origin).
  const library = await (await fetch('https://books.fabkho.dev/v2/library.json')).text()
  // A built app has a service worker, and a request that goes through it is not seen by `route`.
  const session = await page.context().newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.setBypassServiceWorker', { bypass: true })
  await page.route('https://books.fabkho.dev/v2/library.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: library }),
  )

  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle').catch(() => {})
  if (/\/(sign-in|verify)$/.test(page.url())) {
    await page.goto(`${args.base}/sign-in`)
    await emailCooldown()
    const before = await newestMail(args.email!)
    await page.getByTestId('signIn.email').fill(args.email!)
    await page.getByTestId('signIn.submit').click()
    await page.waitForURL(/\/verify$/)
    await page.getByTestId('verify.code').fill(await codeAfter(args.email!, before))
    await page.getByTestId('home.title').waitFor()
  }

  const report: Record<string, unknown> = {}
  let failed = false
  const measure = async (name: string) => {
    await sleep(1200)
    const p = await probe(page)
    report[name] = p
    if (p.wider || p.scrollX !== 0 || p.visualPageLeft) failed = true
    console.log(name, JSON.stringify(p))
    await screenshot(name)
  }

  await page.goto(`${args.base}/`)
  await sleep(1500)
  await measure('home')
  await page.goto(`${args.base}/library`)
  await measure('library')
  await page.getByTestId('shell.tab.search').first().click().catch(() => {})
  await measure('search')
  await page.keyboard.press('Escape')
  await page.goto(`${args.base}/profile`)
  await page.getByTestId('profile.shelfCount').waitFor({ timeout: 20_000 })
  // The 3D is fetched once the card comes near the view.
  await page.getByTestId('profile.shelfRow').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.locator('[data-testid="profile.shelfRow"][data-ready]').waitFor({ timeout: 60_000 })
  await sleep(3000)
  await measure('profile')

  // A real finger on the page itself (the heading above the cards), sideways both ways.
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(500)
  const origin = await pageOrigin(page, 700)
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  const y = 140
  swipe(origin, [viewport.w * 0.85, y], [viewport.w * 0.1, y], 250)
  await sleep(700)
  await measure('profile-swiped-left')
  swipe(origin, [viewport.w * 0.1, y], [viewport.w * 0.9, y], 250)
  await sleep(700)
  await measure('profile-swiped-right')

  // The year cards scroll sideways under a finger.
  const cards = page.getByTestId('profile.yearCards')
  if (await cards.count()) {
    await cards.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await sleep(800)
    const box = (await cards.boundingBox())!
    const o = await pageOrigin(page, 700)
    const scroller = cards.locator('xpath=.//div[contains(@class,"overflow-x-auto")]').first()
    const start = await scroller.evaluate((el) => el.scrollLeft)
    swipe(o, [box.x + box.width * 0.85, box.y + box.height / 2], [box.x + box.width * 0.1, box.y + box.height / 2], 250)
    await sleep(1200)
    const end = await scroller.evaluate((el) => el.scrollLeft)
    report.yearCardsScrolled = { start, end }
    console.log('year cards scrollLeft', start, '->', end)
    if (end <= start) failed = true
    await measure('profile-year-cards-swiped')
  }

  // Regal's row scrolls sideways under a finger.
  const row = page.getByTestId('profile.shelfRow')
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await sleep(1000)
  const box = (await row.boundingBox())!
  const o = await pageOrigin(page, 400)
  const before = await row.locator('.row-card__scroller').evaluate((el) => el.scrollLeft)
  swipe(o, [box.x + box.width * 0.2, box.y + box.height / 2], [box.x + box.width * 0.85, box.y + box.height / 2], 300)
  await sleep(2000)
  const after = await row.locator('.row-card__scroller').evaluate((el) => el.scrollLeft)
  report.shelfRowScrolled = { before, after }
  console.log('shelf row scrollLeft', before, '->', after)
  if (after === before) failed = true
  await measure('profile-shelf-row-swiped')

  // A Book broken out over the whole screen and put back, by the system's Back and by Done: the page is as it was.
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await sleep(1000)
  for (const way of ['system-back', 'done'] as const) {
    const o2 = await pageOrigin(page, 400)
    const card = (await row.boundingBox())!
    shell(`input tap ${device(o2, [card.x + card.width / 2, card.y + card.height / 2])}`)
    await sleep(2500)
    await measure(`profile-book-out-${way}`)
    if (way === 'system-back') shell('input keyevent KEYCODE_BACK')
    else {
      const done = await page.getByTestId('shelfRow.putBack').boundingBox()
      if (done) shell(`input tap ${device(o2, [done.x + done.width / 2, done.y + done.height / 2])}`)
    }
    await sleep(2500)
    await measure(`profile-book-back-${way}`)
  }

  await page.goto(`${args.base}/profile/${args.year}`)
  await sleep(3000)
  await measure('year')
  await page.goto(`${args.base}/profile/shelf`)
  await sleep(5000)
  await measure('shelf')

  writeFileSync(join(OUT, 'scroll-x.json'), JSON.stringify(report, null, 2))
  await browser.close()
  if (failed) {
    console.error('FAILED: the page is wider than the viewport or moved, or an inner scroller did not scroll')
    process.exit(1)
  }
  console.log('OK: the page stayed put, the inner scrollers scrolled')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

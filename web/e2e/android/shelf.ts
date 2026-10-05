/**
 * Your shelf on a real device (#23): Chrome on the Android emulator, driven
 * over adb and the DevTools protocol like `smoke.ts` (docs/TESTING.md). Real
 * fingers (`adb shell input`) on Regal's row in the Profile's card: a swipe
 * sideways through it, a vertical swipe over it that must scroll the page, a
 * tap that breaks a Book out over the whole screen, a tap that turns it, the
 * system Back and the sheet's Done that put it back without leaving the page,
 * then the same in the year in review's row. Not part of CI.
 *
 *   pnpm tsx e2e/android/shelf.ts --base http://localhost:3121 --email <the owner's address>
 *
 * The app must be built or served with NUXT_PUBLIC_SHELF_OWNER_ID set to that
 * member's id, and her address must reach Mailpit (the local stack): the run
 * signs her in through the screens unless the tab already has her session.
 * Screenshots (`shelf-<step>.jpg`, whole screen, at most 1000 px high) and
 * what the row reported at each step (`shelf.json`) go to `--out`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { emailCooldown, mailCount, readMailedCode, stack } from '../../tests/support/stack'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3121' },
    out: { type: 'string', default: '/tmp/libellus-23' },
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function screenshot(name: string) {
  const png = adb('exec-out', 'screencap', '-p')
  await sharp(png).resize({ height: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, `shelf-${name}.jpg`))
}

type Origin = { x: number; y: number; dpr: number }

/**
 * Where the page's (0, 0) is on the screen, in device pixels: a calibration tap
 * the page swallows (its touchstart; Regal listens to pointer events, so on the
 * shelf it goes where no Book is: `yDevice`, the empty room above the pile).
 */
async function pageOrigin(page: Page, yDevice?: number): Promise<Origin> {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number)
  const at = { x: Math.round(width! / 2), y: yDevice ?? Math.round(height! / 2) }
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
/** A real finger at a point of the page (CSS pixels). */
const tapAt = (o: Origin, at: [number, number]) => shell(`input tap ${device(o, at)}`)
async function tapTestId(page: Page, o: Origin, testid: string) {
  const box = await page.getByTestId(testid).first().boundingBox()
  if (!box) throw new Error(`${testid} is not on screen`)
  tapAt(o, [box.x + box.width / 2, box.y + box.height / 2])
}
/** A real flick from one point to another (CSS pixels), over `ms`. */
const swipe = (o: Origin, from: [number, number], to: [number, number], ms = 250) => shell(`input swipe ${device(o, from)} ${device(o, to)} ${ms}`)

/** What Regal's row in a card says about itself: its Books, the one that is out, whether it broke out, where the page is. */
const rowState = (page: Page, testid: string) =>
  page.evaluate((testid) => {
    const row = document.querySelector(`[data-testid="${testid}"] section.row-card`)
    const tabs = document.querySelector('[data-testid="shell.tabs"]')?.getBoundingClientRect()
    const atTabs = tabs ? document.elementFromPoint(tabs.x + tabs.width / 2, tabs.y + tabs.height / 2) : null
    return {
      url: location.pathname + location.search,
      books: Number(row?.getAttribute('data-book-count') ?? 0),
      picked: row?.getAttribute('data-picked') || null,
      ready: Boolean(document.querySelector(`[data-testid="${testid}"][data-ready]`)),
      brokenOut: Boolean(document.querySelector('body > .row-card__view--out')),
      tabBarOnTop: Boolean(atTabs?.closest('[data-testid="shell.tabs"]')),
      scrollY: Math.round(scrollY),
      history: history.length,
    }
  }, testid)

async function main() {
  for (const port of [new URL(args.base!).port, new URL(stack.url).port]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
  shell(`am start -a android.intent.action.VIEW -d ${args.base}/ com.android.chrome`)
  await sleep(2500)

  const browser = await chromium.connectOverCDP('http://localhost:9333')
  // The tab just opened (the newest of the app's), in front: real fingers land on what is showing.
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

  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle').catch(() => {})
  if (page.url().includes('/sign-in')) {
    await emailCooldown()
    const before = await mailCount(args.email!)
    await page.getByTestId('signIn.email').fill(args.email!)
    await page.getByTestId('signIn.submit').click()
    await page.waitForURL(/\/verify$/)
    await page.getByTestId('verify.code').fill(await readMailedCode(args.email!, before + 1))
    await page.getByTestId('home.title').waitFor()
  }

  const report: Record<string, unknown> = {}
  const step = async (name: string, testid: string) => {
    await sleep(800)
    report[name] = await rowState(page, testid)
    await screenshot(name)
    console.log(name, JSON.stringify(report[name]))
  }

  /** One card's row under real fingers: sideways, up and down over it, a Book out and turned, the system Back and Done. */
  async function row(prefix: string, testid: string) {
    await page.getByTestId(testid).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.locator(`[data-testid="${testid}"][data-ready]`).waitFor({ timeout: 60_000 })
    await sleep(3000)
    await step(`${prefix}`, testid)
    const box = () => page.getByTestId(testid).boundingBox().then((b) => b!)
    // The calibration tap lands above the card (centred on the screen), on the page; again after
    // anything that may have moved Chrome's toolbar.
    const calibrate = () => pageOrigin(page, 400)
    let origin = await calibrate()
    let card = await box()
    const cy = card.y + card.height / 2
    // Sideways: the row scrolls (towards the older Books).
    swipe(origin, [card.x + card.width * 0.2, cy], [card.x + card.width * 0.85, cy], 300)
    await sleep(2000)
    await step(`${prefix}-swiped`, testid)
    // Up over the row: the page scrolls, the row doesn't keep the finger.
    const before = (await rowState(page, testid)).scrollY
    swipe(origin, [card.x + card.width / 2, cy + card.height * 0.3], [card.x + card.width / 2, cy - card.height * 0.3], 300)
    await sleep(1500)
    await step(`${prefix}-page-scrolled`, testid)
    if ((await rowState(page, testid)).scrollY === before) console.warn(`${prefix}: the page did not scroll under a vertical swipe over the row`)
    await page.getByTestId(testid).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await sleep(1000)
    origin = await calibrate()
    card = await box()
    // A tap on the Book in the middle breaks it out over the whole screen.
    tapAt(origin, [card.x + card.width / 2, card.y + card.height / 2])
    await sleep(2500)
    await step(`${prefix}-out`, testid)
    // A tap on it (now in the middle of the screen) turns it.
    const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    tapAt(origin, [viewport.w / 2, viewport.h * 0.4])
    await sleep(2500)
    await step(`${prefix}-turned`, testid)
    // The system Back (the button, or the gesture's key) puts it back and stays on the page.
    shell('input keyevent KEYCODE_BACK')
    await sleep(2500)
    await step(`${prefix}-system-back`, testid)
    // Out again, and the sheet's Done (Regal's round Back is off).
    origin = await calibrate()
    card = await box()
    tapAt(origin, [card.x + card.width / 2, card.y + card.height / 2])
    await sleep(2500)
    await step(`${prefix}-out-again`, testid)
    const done = await page.getByTestId('shelfRow.putBack').boundingBox()
    if (done) tapAt(origin, [done.x + done.width / 2, done.y + done.height / 2])
    await sleep(2500)
    await step(`${prefix}-done`, testid)
  }

  await page.goto(`${args.base}/profile`)
  await page.getByTestId('profile.shelfCount').waitFor({ timeout: 20_000 })
  await row('profile', 'profile.shelfRow')

  await page.goto(`${args.base}/profile/${args.year}`)
  await page.getByTestId('yearInReview.shelf').waitFor({ timeout: 20_000 })
  await row('year', 'yearInReview.shelfRow')

  writeFileSync(join(OUT, 'shelf.json'), JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

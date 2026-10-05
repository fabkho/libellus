/**
 * Your shelf on a real device (#23): Chrome on the Android emulator, driven
 * over adb and the DevTools protocol like `smoke.ts` (docs/TESTING.md). Real
 * fingers (`adb shell input`) on Regal's 3D Stack: a flick through the pile, a
 * tap that takes a Book out, a tap that turns it, the system Back and the round
 * Back that put it away first, then the year in review's stack. Not part of CI.
 *
 *   pnpm tsx e2e/android/shelf.ts --base http://localhost:3121 --email <the owner's address>
 *
 * The app must be built or served with NUXT_PUBLIC_SHELF_OWNER_ID set to that
 * member's id, and her address must reach Mailpit (the local stack): the run
 * signs her in through the screens unless the tab already has her session.
 * Screenshots (`shelf-<step>.jpg`, whole screen, at most 1000 px high) and
 * what the Stack reported at each step (`shelf.json`) go to `--out`.
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

/** What Regal's Stack says about itself: Books in the pile, the one that is out. */
const stackState = (page: Page) =>
  page.evaluate(() => {
    const section = document.querySelector('[data-testid="shelf"] section[data-view]')
    return {
      url: location.pathname + location.search,
      books: Number(section?.getAttribute('data-book-count') ?? 0),
      picked: section?.getAttribute('data-picked') || null,
      loading: Boolean(document.querySelector('[data-testid="shelf.loading"]')),
      canvas: (() => {
        const canvas = document.querySelector('[data-testid="shelf"] canvas')?.getBoundingClientRect()
        return canvas ? { width: Math.round(canvas.width), height: Math.round(canvas.height) } : null
      })(),
    }
  })

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
  await page.waitForLoadState('networkidle')
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
  const step = async (name: string) => {
    await sleep(800)
    report[name] = await stackState(page)
    await screenshot(name)
    console.log(name, JSON.stringify(report[name]))
  }

  // The Profile's card, and a real tap on it.
  await page.goto(`${args.base}/profile`)
  await page.getByTestId('profile.shelfCount').waitFor({ timeout: 20_000 })
  await page.getByTestId('profile.shelf').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await step('profile')
  await tapTestId(page, await pageOrigin(page), 'profile.shelf')
  await page.waitForURL(/\/profile\/shelf/)
  await page.getByTestId('shelf').waitFor()
  await step('loading')
  await page.getByTestId('shelf.loading').waitFor({ state: 'detached', timeout: 60_000 })
  await sleep(4000)
  await step('stack')

  // A flick up through the pile: it glides on.
  const stage = (await page.getByTestId('shelf.stage').boundingBox())!
  const cx = stage.x + stage.width / 2
  const origin = await pageOrigin(page, 450)
  swipe(origin, [cx, stage.y + stage.height * 0.8], [cx, stage.y + stage.height * 0.35], 180)
  await sleep(2500)
  await step('flicked')

  // A tap on the Book in the middle of the view takes it out; another turns it; Back puts it away.
  tapAt(origin, [cx, stage.y + stage.height * 0.55])
  await sleep(2500)
  await step('picked')
  tapAt(origin, [cx, stage.y + stage.height * 0.45])
  await sleep(2500)
  await step('turned')
  // The system Back (the gesture, or the button) puts it away and stays on the shelf…
  shell('input keyevent KEYCODE_BACK')
  await sleep(2000)
  await step('system-back')
  // … and so does the round Back, before it leaves.
  tapAt(origin, [cx, stage.y + stage.height * 0.55])
  await sleep(2500)
  await step('picked-again')
  await tapTestId(page, origin, 'shelf.back')
  await sleep(2000)
  await step('put-away')

  // The year in review's stack, and Open (full screen, that year only).
  await page.goto(`${args.base}/profile/${args.year}`)
  await page.getByTestId('yearInReview.shelf').waitFor({ timeout: 20_000 })
  await page.getByTestId('yearInReview.shelf').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await sleep(6000)
  await step('year')
  await tapTestId(page, await pageOrigin(page, 450), 'yearInReview.shelfOpen')
  await page.waitForURL(/\/profile\/shelf\?year=/)
  await page.getByTestId('shelf').waitFor()
  await page.getByTestId('shelf.loading').waitFor({ state: 'detached', timeout: 60_000 })
  await sleep(4000)
  await step('year-full')

  writeFileSync(join(OUT, 'shelf.json'), JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

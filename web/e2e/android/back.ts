/**
 * Real-device check of the system Back with something open (#62): Chrome on
 * the Android emulator, signed in by `smoke.ts` first (same `--out`, it reuses
 * her `member.json`). Not part of CI; `e2e/sheets.spec.ts` covers the same in
 * Playwright with `page.goBack()`.
 *
 * From one book page to another inside the app, then on the second: Edit read
 * and Back (the sheet closes, the page stays); Edit read and Cancel; the
 * Delete question over the sheet and Back twice; the search and Back; Back
 * once more (the previous book: no entry was left behind). Then the avatar
 * menu on Home and Back. Each step prints where the page is and what is open;
 * a few take a screenshot of the whole screen.
 *
 *   pnpm tsx e2e/android/back.ts --base http://localhost:3065 --out /tmp/libellus-android --real --gesture
 *
 * `--real` taps with a finger (adb input; otherwise the DevTools protocol),
 * `--gesture` goes back with a swipe in from the left edge (otherwise the Back
 * key), `--menu` runs only the avatar menu.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3062' },
    out: { type: 'string', default: '/tmp/libellus-android' },
    name: { type: 'string', default: 'back' },
    gesture: { type: 'boolean', default: false },
    real: { type: 'boolean', default: false },
    menu: { type: 'boolean', default: false },
  },
})
const OUT = args.out!
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, command, { maxBuffer: 64 * 1024 * 1024 })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function screenSize() {
  const [width, height] = adb('shell', 'wm size').toString().match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number)
  return { width: width!, height: height! }
}

async function screenshot(name: string) {
  const png = adb('exec-out', 'screencap', '-p')
  await sharp(png).resize({ height: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, `${args.name}-${name}.jpg`))
}

/** The system Back: a swipe in from the left edge, or the Back key. */
function back() {
  const { height } = screenSize()
  if (args.gesture) adb('shell', `input swipe 2 ${Math.round(height / 2)} 500 ${Math.round(height / 2)} 250`)
  else adb('shell', 'input keyevent KEYCODE_BACK')
}

/** A real finger on an element (adb input), placed by a calibration tap the page measures and swallows. */
async function tapReal(page: Page, testid: string) {
  const box = (await page.getByTestId(testid).first().boundingBox())!
  const { width, height } = screenSize()
  const at = { x: Math.round(width / 2), y: Math.round(height / 2) }
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
  adb('shell', `input tap ${at.x} ${at.y}`)
  const css = await seen
  const x = Math.round(at.x + (box.x + box.width / 2 - css.x) * css.dpr)
  const y = Math.round(at.y + (box.y + box.height / 2 - css.y) * css.dpr)
  adb('shell', `input tap ${x} ${y}`)
}

/** Goes to a page inside the app, as a link does (a new history entry, no reload). */
const push = (page: Page, path: string) =>
  page.evaluate((to) => (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$router.push(to), path)

/** Where the page is and what is open on it. */
const state = (page: Page) =>
  page.evaluate(() => ({
    path: location.pathname.replace(/^\/book\/(.{4}).*/, '/book/$1…'),
    open: [...document.querySelectorAll('[role="dialog"], [data-testid="shell.menu"], [data-testid="search.query"]')]
      .map((el) => el.getAttribute('data-testid'))
      .join(','),
  }))

async function main() {
  const member = JSON.parse(readFileSync(join(OUT, 'member.json'), 'utf8'))
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
  const browser = await chromium.connectOverCDP('http://localhost:9333')
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(args.base!))
  if (!page) throw new Error('No tab of the app open')
  // tsx (esbuild, keepNames) wraps the functions inside page.evaluate in a `__name` helper the page lacks.
  await page.context().addInitScript('window.__name = (fn) => fn')
  await page.evaluate('window.__name = (fn) => fn')

  const tap = (testid: string) => (args.real ? tapReal(page, testid) : page.getByTestId(testid).first().click())
  const step = async (label: string, shot?: string) => {
    await sleep(1100)
    console.log(label.padEnd(34), JSON.stringify(await state(page)))
    if (shot) await screenshot(shot)
  }

  if (!args.menu) {
    // The owner's case: one book page to another, Edit read on the second, Back.
    await page.goto(`${args.base}/book/${member.reading}`)
    await page.getByTestId('book.title').waitFor()
    await push(page, `/book/${member.finished}`)
    await page.getByTestId('history.edit').waitFor()
    await sleep(800)
    await tap('history.edit')
    await step('edit read open', '1-sheet')
    back()
    await step('back: sheet closes, same book', '2-after-back')
    // Cancel takes the sheet's entry off again.
    await tap('history.edit')
    await step('edit read open again')
    await tap('editSession.cancel')
    await step('cancel')
    // A dialog over the sheet: Back closes the dialog, then the sheet.
    await tap('history.edit')
    await sleep(900)
    await tap('editSession.delete')
    await step('confirm over sheet', '3-confirm')
    back()
    await step('back: confirm closes')
    back()
    await step('back: sheet closes')
    // The search over the book page; the first Back puts the keyboard away, as on a phone.
    await tap('shell.tab.search')
    await sleep(600)
    adb('shell', 'input keyevent KEYCODE_BACK')
    await step('search open (keyboard down)', '4-search')
    back()
    await step('back: search closes')
    // Nothing left behind: one more Back is the previous book.
    back()
    await step('back: previous book', '5-previous-book')
  }

  // The avatar menu on Home.
  await push(page, '/')
  await page.getByTestId('shell.avatar').waitFor()
  await sleep(600)
  await tap('shell.avatar')
  await step('avatar menu open')
  back()
  await step('back: menu closes, still Home')
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Real-device smoke run: Chrome on an Android emulator (or a phone on USB),
 * driven over adb and the Chrome DevTools protocol. Not part of CI and not a
 * Playwright test (no `.spec`): it takes screenshots of the real screen —
 * system bars, Chrome's toolbar, the real keyboard — and writes down what the
 * browser reports about its viewports and insets next to each one. How to boot
 * the emulator and run this: docs/TESTING.md.
 *
 *   pnpm tsx e2e/android/smoke.ts --base http://localhost:3062 --name gesture-tab
 *   pnpm tsx e2e/android/smoke.ts --base http://localhost:3063 --name gesture-pwa --standalone
 *
 * `--base` is the app as the host serves it (dev server or a static build); its
 * port and the stack's API port are reversed into the device, so the phone's
 * localhost is the Mac's. The first run signs a fresh test member up (address
 * on the test domain, so the suites' sweep removes it a day later) and
 * gives her a few Books; later runs reuse her (`<out>/member.json`).
 * `--standalone` drives the installed app (Add to Home screen once, by hand,
 * then open it from its icon) instead of a Chrome tab. `--only home,search`
 * takes a subset.
 *
 * Every screenshot is the whole screen, downscaled to a JPEG at most 1000 px
 * high; `<name>.json` holds the probe for every step.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { appleCover } from '../../tests/support/apple'
import { signUpMember } from '../../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, stack, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'
import { createLibrary } from '../../app/data/library'
import type { BookSnapshot } from '../../app/data/books'
import { isoDay } from '../../app/utils/dates'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3062' },
    out: { type: 'string', default: '/tmp/libellus-android' },
    name: { type: 'string', default: 'tab' },
    standalone: { type: 'boolean', default: false },
    only: { type: 'string' },
    serial: { type: 'string' },
  },
})

const OUT = args.out!
mkdirSync(OUT, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'android'

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
function adb(...command: string[]): Buffer {
  return execFileSync(ADB, [...(args.serial ? ['-s', args.serial] : []), ...command], { maxBuffer: 64 * 1024 * 1024 })
}
const shell = (command: string) => adb('shell', command).toString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------ device

/** The phone's localhost is the Mac's: the app's port, the stack's API, and Chrome's DevTools socket. */
function connectPorts() {
  const appPort = new URL(args.base!).port || '80'
  const apiPort = new URL(stack.url).port
  for (const port of [appPort, apiPort]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
}

/** The whole screen as the member sees it, as a JPEG no higher than 1000 px. */
async function screenshot(name: string) {
  const png = adb('exec-out', 'screencap', '-p')
  await sharp(png).resize({ height: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, `${args.name}-${name}.jpg`))
}

/**
 * Where the page's (0, 0) is on the screen, in device pixels: a real tap at a
 * known spot and the page's own reading of it. One `touchstart` is swallowed
 * for it, so the calibration tap does nothing on the page.
 */
async function pageOrigin(page: Page): Promise<{ x: number; y: number; dpr: number }> {
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
  shell(`input tap ${at.x} ${at.y}`)
  const css = await seen
  return { x: at.x - css.x * css.dpr, y: at.y - css.y * css.dpr, dpr: css.dpr }
}

function screenSize() {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number)
  return { width: width!, height: height! }
}

/** A real finger on an element (adb input), so focusing a field brings up the real keyboard. */
async function tapReal(page: Page, testid: string) {
  const box = await page.getByTestId(testid).first().boundingBox()
  if (!box) throw new Error(`${testid} is not on screen`)
  const origin = await pageOrigin(page)
  const x = Math.round(origin.x + (box.x + box.width / 2) * origin.dpr)
  const y = Math.round(origin.y + (box.y + box.height / 2) * origin.dpr)
  shell(`input tap ${x} ${y}`)
}

/** Puts the keyboard away the way a member does: Back, while it is showing. */
async function keyboardDown() {
  if (shell('dumpsys input_method').includes('mInputShown=true')) shell('input keyevent KEYCODE_BACK')
  await sleep(600)
}

// ------------------------------------------------------------------ probe

/** What the browser says about its viewports, insets and the floating chrome right now. */
function probe(page: Page) {
  return page.evaluate(() => {
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;'
    const sizes = ['100dvh', '100svh', '100lvh', '100vh'].map((height) => {
      const box = document.createElement('div')
      box.style.cssText = `position:absolute;top:0;width:1px;height:${height};visibility:hidden`
      return box
    })
    const max = document.createElement('div')
    max.style.cssText = 'position:fixed;width:1px;visibility:hidden;height:env(safe-area-max-inset-bottom, 12345px)'
    document.body.append(el, max, ...sizes)
    const style = getComputedStyle(el)
    const rect = (testid: string) => {
      const box = document.querySelector(`[data-testid="${testid}"]`)?.getBoundingClientRect()
      return box && box.width ? { top: Math.round(box.top), bottom: Math.round(box.bottom), fromBottom: Math.round(innerHeight - box.bottom) } : null
    }
    const result = {
      displayMode: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      dpr: devicePixelRatio,
      innerWidth,
      innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualViewport: visualViewport && { height: Math.round(visualViewport.height * 10) / 10, offsetTop: visualViewport.offsetTop },
      fixedBottom: Math.round(el.getBoundingClientRect().bottom),
      insetTop: style.paddingTop,
      insetBottom: style.paddingBottom,
      maxInsetBottom: getComputedStyle(max).height === '12345px' ? 'unsupported' : getComputedStyle(max).height,
      dvh: sizes[0]!.offsetHeight,
      svh: sizes[1]!.offsetHeight,
      lvh: sizes[2]!.offsetHeight,
      vh: sizes[3]!.offsetHeight,
      floatBottom: getComputedStyle(document.documentElement).getPropertyValue('--float-bottom'),
      barTop: getComputedStyle(document.documentElement).getPropertyValue('--bar-top'),
      tabs: rect('shell.tabs'),
      palette: rect('search.overlay'),
      header: rect('shell.header'),
      scrollY: Math.round(scrollY),
    }
    for (const node of [el, max, ...sizes]) node.remove()
    return result
  })
}

// ------------------------------------------------------------------ member

type Member = { email: string; reading: string; finished: string }

const DESCRIPTION = Array.from(
  { length: 6 },
  () =>
    'A house of endless halls and tides, a man who keeps its records, and the slow understanding of what the house has done to him. ' +
    'Written with patience and warmth, it rewards the reader who walks its corridors slowly.',
).join('\n\n')

function snapshot(title: string, author: string): BookSnapshot {
  const appleId = uniqueAppleId()
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: DESCRIPTION,
    // Answered from the recorded cover (routeCovers), never fetched.
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/android-smoke/${appleId}/600x600bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** A test member with a Book being read, two to read and one finished. */
async function newMember(): Promise<Member> {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const today = isoDay()
  const reading = await library.addToLibrary(snapshot('Piranesi', 'Susanna Clarke'), { status: 'reading', startedOn: today })
  await library.addToLibrary(snapshot('Klara and the Sun', 'Kazuo Ishiguro'))
  await library.addToLibrary(snapshot('The Dispossessed', 'Ursula K. Le Guin'))
  const finished = await library.addToLibrary(snapshot('Kindred', 'Octavia E. Butler'), {
    status: 'finished',
    startedOn: today,
    endedOn: today,
    rating: 16,
  })
  if (reading.error || finished.error) throw new Error(`Seeding failed: ${reading.error ?? finished.error}`)
  return { email: member.email, reading: reading.data.book.id, finished: finished.data.book.id }
}

async function routeCovers(page: Page) {
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() }),
  )
}

/** Signs in through the screens (the address, then the mailed code), unless the app already has a session. */
async function signIn(page: Page, member: Member) {
  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle')
  if (!page.url().includes('/sign-in')) return
  await emailCooldown()
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await page.waitForURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  await page.getByTestId('home.title').waitFor()
}

// ------------------------------------------------------------------ the run

const STEPS = ['home', 'library', 'book', 'search', 'finish', 'name'] as const
const only = args.only ? new Set(args.only.split(',')) : null
const wanted = (step: (typeof STEPS)[number]) => !only || only.has(step)

async function main() {
  connectPorts()
  const memberFile = join(OUT, 'member.json')
  const member: Member = existsSync(memberFile) ? JSON.parse(readFileSync(memberFile, 'utf8')) : await newMember()
  writeFileSync(memberFile, JSON.stringify(member, null, 2))

  const browser = await chromium.connectOverCDP('http://localhost:9333')
  const pages = browser.contexts().flatMap((context) => context.pages())
  // A Chrome tab, or the installed app (a page of the app's origin in display-mode standalone).
  let page: Page | undefined
  for (const candidate of pages) {
    if (!candidate.url().startsWith(args.base!)) continue
    const standalone = await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches).catch(() => false)
    if (standalone === args.standalone) page = candidate
  }
  if (!page && args.standalone) throw new Error('No installed app open: add Libellus to the home screen and open it from its icon first.')
  page ??= pages[0]
  if (!page) throw new Error('No Chrome tab open: open Chrome on the device first.')

  // tsx (esbuild, keepNames) wraps the functions inside page.evaluate in a `__name` helper the page lacks.
  const keepNames = 'window.__name = (fn) => fn'
  await page.context().addInitScript(keepNames)
  await page.evaluate(keepNames)
  await routeCovers(page)
  await signIn(page, member)
  const report: Record<string, unknown> = {}
  const step = async (name: string) => {
    await sleep(700)
    report[name] = await probe(page)
    await screenshot(name)
    console.log(name, JSON.stringify(report[name]))
  }

  if (wanted('home')) {
    await page.goto(`${args.base}/`)
    await page.getByTestId('home.title').waitFor()
    await step('home')
  }
  if (wanted('library')) {
    await page.goto(`${args.base}/library`)
    await page.getByTestId('library.title').waitFor()
    await step('library')
  }
  if (wanted('book') || wanted('finish')) {
    await page.goto(`${args.base}/book/${member.reading}`)
    await page.getByTestId('book.title').waitFor()
  }
  if (wanted('book')) {
    await step('book')
    // A real swipe, so Chrome's toolbar (and its bottom chin) can go out of the way as it would under a finger.
    const { width, height } = screenSize()
    for (let i = 0; i < 2; i++) shell(`input swipe ${width / 2} ${Math.round(height * 0.75)} ${width / 2} ${Math.round(height * 0.45)} 600`)
    await sleep(800)
    await step('book-scrolled')
    // Search from the scrolled page, Chrome's toolbar out of the way (where the owner met the keyboard).
    if (wanted('search')) {
      await tapReal(page, 'shell.tab.search')
      await sleep(1500)
      await step('search-keyboard-scrolled')
      await keyboardDown()
      await page.getByTestId('search.cancel').click().catch(() => page!.keyboard.press('Escape'))
      await sleep(600)
    }
    await page.evaluate(() => scrollTo(0, 0))
  }
  if (wanted('finish')) {
    await page.getByTestId('book.finish').click()
    await page.getByTestId('finish.review').waitFor()
    await sleep(600)
    await tapReal(page, 'finish.review')
    await sleep(1200)
    await step('finish-keyboard')
    await keyboardDown()
    await page.getByTestId('finish.cancel').click()
    await sleep(600)
  }
  if (wanted('search')) {
    await page.goto(`${args.base}/library`)
    await page.getByTestId('library.title').waitFor()
    await tapReal(page, 'shell.tab.search')
    await sleep(1500)
    await step('search-keyboard')
    await keyboardDown()
    await step('search-no-keyboard')
    await page.getByTestId('search.cancel').click().catch(() => page!.keyboard.press('Escape'))
    await sleep(600)
  }
  if (wanted('name')) {
    await page.goto(`${args.base}/`)
    await page.getByTestId('shell.avatar').click()
    await page.getByTestId('profile.name').click()
    await page.getByTestId('accountName.input').waitFor()
    await sleep(600)
    await tapReal(page, 'accountName.input')
    await sleep(1200)
    await step('name-keyboard')
    await keyboardDown()
    await page.getByTestId('accountName.cancel').click()
  }

  writeFileSync(join(OUT, `${args.name}.json`), JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

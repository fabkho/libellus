/**
 * The cover's flight into the book page on a real Chrome for Android (the
 * emulator, or a phone on USB): a real finger on a Library row, recorded frame
 * by frame through the DevTools screencast. Not part of CI; how to boot the
 * emulator and reach it: docs/TESTING.md.
 *
 *   pnpm tsx e2e/android/flight.ts --base http://localhost:3122 --name after --network normal
 *
 * Covers are answered by the script, never fetched: a sharp test card at the
 * size each request asks for (a row's 120 × 180, the book page's 600 × 900),
 * after a delay that stands for the network (`--network warm|normal|slow`:
 * 0, 150 and 1500 ms for the book page's image; a row's are in already).
 * Writes `<out>/<name>-<network>-strip.jpg` (the flight, frame by frame, the
 * flying cover's part of the screen) and `-hero.jpg` (the hero, up close, as
 * it lands and after), each at most 1000 px wide, and the frame times in
 * `-frames.json`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { signUpMember } from '../../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, stack, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'
import { createLibrary } from '../../app/data/library'
import type { BookSnapshot } from '../../app/data/books'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3122' },
    out: { type: 'string', default: '/tmp/libellus-flight' },
    name: { type: 'string', default: 'run' },
    network: { type: 'string', default: 'normal' },
    serial: { type: 'string' },
  },
})
const OUT = args.out!
mkdirSync(OUT, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'android'
const DELAY = { warm: 0, normal: 150, slow: 1500 }[args.network as 'warm' | 'normal' | 'slow'] ?? 150

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, [...(args.serial ? ['-s', args.serial] : []), ...command], { maxBuffer: 64 << 20 })
const shell = (command: string) => adb('shell', command).toString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A test card with fine type and hairlines, so blur shows. */
function card(): string {
  const lines = Array.from({ length: 28 }, (_, i) => `<line x1="40" x2="560" y1="${470 + i * 12}" y2="${470 + i * 12}" stroke="#f3e9d2" stroke-width="2"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
    <rect width="600" height="900" fill="#1f3b5c"/>
    <rect x="24" y="24" width="552" height="852" fill="none" stroke="#f3e9d2" stroke-width="3"/>
    <text x="300" y="200" font-family="Georgia" font-size="84" fill="#f3e9d2" text-anchor="middle">PIRANESI</text>
    <text x="300" y="300" font-family="Georgia" font-size="34" fill="#e8b04a" text-anchor="middle">SUSANNA CLARKE</text>
    <text x="300" y="400" font-family="Georgia" font-size="18" fill="#f3e9d2" text-anchor="middle">The Beauty of the House is immeasurable; its Kindness infinite.</text>
    ${lines}
  </svg>`
}

async function covers() {
  const large = await sharp(Buffer.from(card())).jpeg({ quality: 88 }).toBuffer()
  const small = await sharp(large).resize(120, 180).jpeg({ quality: 88 }).toBuffer()
  const { data, info } = await sharp(large).resize(66, 100).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const hash = Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64')
  return { large, small, hash }
}

function snapshot(title: string): BookSnapshot {
  const appleId = uniqueAppleId()
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'A flight test. '.repeat(40),
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/flight-device/${appleId}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

async function signIn(page: Page, email: string) {
  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle')
  if (!page.url().includes('/sign-in')) return
  await emailCooldown()
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await page.waitForURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(email, 2))
  await page.getByTestId('home.title').waitFor()
}

/** Where the page's (0, 0) is on the screen, in device pixels (a calibration tap the page swallows). */
async function pageOrigin(page: Page) {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number) as [number, number]
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

async function main() {
  const appPort = new URL(args.base!).port
  for (const port of [appPort, new URL(stack.url).port]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')

  const image = await covers()
  const member = await signUpMember()
  const library = createLibrary(member.client)
  for (const title of ['Flight one', 'Flight two', 'Flight three', 'Flight four']) {
    const added = await library.addToLibrary({ ...snapshot(title), coverThumbhash: image.hash })
    if (added.error) throw new Error(`Seeding failed: ${added.error}`)
  }

  const browser = await chromium.connectOverCDP('http://localhost:9333')
  const page = browser.contexts().flatMap((context) => context.pages())[0]
  if (!page) throw new Error('No Chrome tab open: open Chrome on the device first.')
  const keepNames = 'window.__name = (fn) => fn'
  await page.context().addInitScript(keepNames)
  const cdp = await page.context().newCDPSession(page)
  // A fresh start: no session, no service worker or caches from another build on this origin.
  await page.goto(`${args.base}/sign-in`).catch(() => {})
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(args.base!).origin, storageTypes: 'all' })
  // The service worker's cover cache would fetch the made-up covers itself, past the route below.
  await cdp.send('Network.enable')
  await cdp.send('Network.setBypassServiceWorker', { bypass: true })
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, async (route) => {
    const large = !/120x180bb\.jpg$/.test(route.request().url())
    if (large) await sleep(DELAY)
    await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: large ? image.large : image.small })
  })
  await page.evaluate(keepNames).catch(() => {})
  await signIn(page, member.email)
  await page.evaluate(keepNames)

  await page.goto(`${args.base}/library`)
  await page.getByTestId('library.entry').first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="library.entry"] [data-cover] img')].every((img) => getComputedStyle(img).opacity === '1'))
  await sleep(800)
  const origin = await pageOrigin(page)
  await sleep(400)

  const row = page.getByTestId('library.entry').nth(1).locator('[data-cover]')
  const box = (await row.boundingBox())!
  const frames: { t: number; data: string }[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ t: frame.metadata.timestamp ?? 0, data: frame.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })
  // The tap's time on the device's clock, which the screencast's frames are stamped with.
  await page.evaluate(() => window.addEventListener('pointerdown', () => Object.assign(window, { __tapAt: Date.now() }), { once: true, capture: true }))
  await sleep(300)
  shell(`input tap ${Math.round(origin.x + (box.x + box.width / 2) * origin.dpr)} ${Math.round(origin.y + (box.y + box.height / 2) * origin.dpr)}`)
  await page.getByTestId('book.hero').waitFor()
  await sleep(Math.max(1200, DELAY + 900))
  await cdp.send('Page.stopScreencast')
  const tappedAt = (await page.evaluate(() => (window as unknown as { __tapAt: number }).__tapAt)) / 1000
  const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!

  // From the last frame before the tap, every frame; the strip shows up to ten of the first ones that changed.
  const shot = frames.filter((frame) => frame.t >= tappedAt - 0.05)
  const decoded = await Promise.all(shot.map((frame) => sharp(Buffer.from(frame.data, 'base64')).toBuffer({ resolveWithObject: true })))
  const scale = decoded[0]!.info.width / (await page.evaluate(() => innerWidth))
  // The part of the screen the cover flies through.
  const area = {
    left: 0,
    top: Math.max(0, Math.round((hero.y - 16) * scale)),
    width: Math.round(Math.min(decoded[0]!.info.width, (hero.x + hero.width + 24) * scale)),
    height: Math.round((box.y + box.height - hero.y + 32) * scale),
  }
  area.height = Math.min(area.height, decoded[0]!.info.height - area.top)
  // The screencast sends a frame only when the screen changed: up to ten from the tap on.
  const changed = decoded.map((frame) => frame.data)
  const picks = changed.slice(0, 10)
  const tileWidth = Math.floor(1000 / picks.length)
  const tiles = await Promise.all(picks.map((data) => sharp(data).extract(area).resize({ width: tileWidth }).jpeg().toBuffer({ resolveWithObject: true })))
  const tileHeight = Math.max(...tiles.map((tile) => tile.info.height))
  await sharp({ create: { width: tileWidth * tiles.length, height: tileHeight, channels: 3, background: '#000' } })
    .composite(tiles.map((tile, i) => ({ input: tile.data, left: i * tileWidth, top: 0 })))
    .jpeg({ quality: 85 })
    .toFile(join(OUT, `${args.name}-${args.network}-strip.jpg`))

  // The hero up close: as the cover lands, and every 100 ms after, for half a second.
  const heroArea = { left: Math.round(hero.x * scale), top: Math.round(hero.y * scale), width: Math.round(hero.width * scale), height: Math.round(hero.height * scale) }
  const settledFrom = shot.findIndex((frame) => frame.t > tappedAt + 0.25)
  const heroPicks = [0, 0.1, 0.2, 0.3, 0.5, 0.8].map((after) => shot.findIndex((frame) => frame.t >= shot[Math.max(settledFrom, 0)]!.t + after)).map((i) => (i < 0 ? shot.length - 1 : i))
  const heroTiles = await Promise.all(heroPicks.map((i) => sharp(decoded[i]!.data).extract(heroArea).resize({ width: Math.floor(1000 / heroPicks.length) }).jpeg().toBuffer({ resolveWithObject: true })))
  await sharp({ create: { width: heroTiles[0]!.info.width * heroTiles.length, height: heroTiles[0]!.info.height, channels: 3, background: '#000' } })
    .composite(heroTiles.map((tile, i) => ({ input: tile.data, left: i * tile.info.width, top: 0 })))
    .jpeg({ quality: 88 })
    .toFile(join(OUT, `${args.name}-${args.network}-hero.jpg`))

  writeFileSync(
    join(OUT, `${args.name}-${args.network}-frames.json`),
    JSON.stringify({ tappedAt, frames: shot.map((frame) => Math.round((frame.t - tappedAt) * 1000)), changed: changed.length, heroPicks, row: box, hero, dpr: origin.dpr }, null, 1),
  )
  console.log(`${args.name} ${args.network}: ${shot.length} frames, ${changed.length} distinct`)
  await browser.close().catch(() => {})
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)

/**
 * The cover's flight back into its row (closing a Book page) in Chromium on a
 * phone-sized screen (412 × 915, Android's density), the CPU slowed, recorded
 * frame by frame through the DevTools screencast. Not part of CI; the flows
 * that are (e2e/book-flight-built.spec.ts) assert the same thing in numbers.
 *
 *   pnpm tsx e2e/android/flight-return.ts --base http://localhost:3126 --name after --theme dark --network warm
 *
 * Covers are answered by the script, never fetched: a test card with fine
 * type and hairlines (so blur shows) at the size each request asks for (a
 * row's 120 × 180, the book page's 600 × 900). `--network warm` has both in
 * before the Book is opened; `cold` holds the row's small image back for
 * `--delay` ms (a slow connection, or a row whose image was never fetched),
 * so the list's cover is still on its thumbhash when the Book is closed.
 * `--close back|gesture` taps the page's own Back button or goes back in
 * history (the system Back, the browser's Back).
 *
 * Writes `<out>/<name>-<theme>-<network>-strip.jpg` (up to ten frames from
 * the tap, the part of the screen the cover flies through, at most 1000 px
 * wide) and `-frames.json` (each frame's cover width and what of the small
 * and the large image shows in it).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { signUpMember } from '../../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'
import { createLibrary } from '../../app/data/library'
import type { BookSnapshot } from '../../app/data/books'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3126' },
    out: { type: 'string', default: '/tmp/libellus-cover-return' },
    name: { type: 'string', default: 'run' },
    theme: { type: 'string', default: 'light' },
    network: { type: 'string', default: 'warm' },
    delay: { type: 'string', default: '4000' },
    close: { type: 'string', default: 'back' },
    cpu: { type: 'string', default: '4' },
  },
})
const OUT = args.out!
mkdirSync(OUT, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'coverreturn'
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
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/flight-return/${appleId}/600x900bb.jpg`,
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

type Frame = { t: number; width: number; small: number; large: number; copies: number[]; held: number }

async function main() {
  const image = await covers()
  const member = await signUpMember()
  const library = createLibrary(member.client)
  for (const title of ['Flight one', 'Flight two', 'Flight three', 'Flight four']) {
    const added = await library.addToLibrary({ ...snapshot(title), coverThumbhash: image.hash })
    if (added.error) throw new Error(`Seeding failed: ${added.error}`)
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    colorScheme: args.theme === 'dark' ? 'dark' : 'light',
    serviceWorkers: 'block',
  })
  const keepNames = 'window.__name = (fn) => fn'
  await context.addInitScript(keepNames)
  // Every animation the flight starts can be held still (`__freeze`), to be set to any moment and looked at.
  await context.addInitScript(() => {
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const animation = animate.apply(this, args)
      if ((window as unknown as { __freeze?: boolean }).__freeze) animation.pause()
      return animation
    }
  })
  const page = await context.newPage()
  let cold = false
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, async (route) => {
    const large = !/120x180bb\.jpg$/.test(route.request().url())
    if (!large && cold) await sleep(Number(args.delay))
    await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: large ? image.large : image.small })
  })
  await signIn(page, member.email)

  // The Library with its covers in (warm), or opened at once, before the small ones have come (cold).
  cold = args.network === 'cold'
  await page.goto(`${args.base}/library`)
  await page.getByTestId('library.entry').first().waitFor()
  if (!cold) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="library.entry"] [data-cover] img')].every((img) => getComputedStyle(img).opacity === '1'))
  }
  await sleep(600)
  const row = page.getByTestId('library.entry').nth(1).locator('[data-cover]')
  const rowBox = (await row.boundingBox())!
  await row.tap()
  await page.getByTestId('book.hero').waitFor()
  // The book page's own image is in and showing before it is closed.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="book.hero"] [data-cover] img')!).opacity === '1')
  await sleep(500)
  const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!

  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) })
  await page.evaluate(() => {
    const frames: Frame[] = []
    Object.assign(window, { __frames: frames, __tapAt: 0 })
    const look = () => {
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      if (fly) {
        const opacityOf = (large: boolean) =>
          Math.max(
            0,
            ...[...fly.querySelectorAll('img')]
              .filter((img) => (img.naturalWidth >= 400) === large && img.complete && img.naturalWidth > 0)
              .map((img) => Number(getComputedStyle(img).opacity)),
          )
        frames.push({
          t: performance.now(),
          width: fly.getBoundingClientRect().width,
          small: opacityOf(false),
          large: opacityOf(true),
          copies: [...fly.children].map((copy) => Number(getComputedStyle(copy).opacity)),
          held: 0,
        })
      }
      const held = document.querySelector('[data-testid="shell.flightHeld"]')
      if (held && !fly) frames.push({ t: performance.now(), width: held.getBoundingClientRect().width, small: 0, large: 0, copies: [], held: Number(getComputedStyle(held).opacity) })
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  const frames: { t: number; data: string }[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ t: frame.metadata.timestamp ?? 0, data: frame.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
  await sleep(300)
  const tappedAt = Date.now() / 1000
  if (args.close === 'gesture') await page.goBack()
  else await page.getByTestId('book.back').tap()
  await page.getByTestId('library.title').waitFor()
  // The row's cover 700 ms after the tap: landed, and what it shows (a cold one has only its thumbhash and the held large image).
  await sleep(700)
  await page.screenshot({ clip: { x: Math.max(0, rowBox.x - 8), y: Math.max(0, rowBox.y - 8), width: 160, height: rowBox.height + 16 }, path: `${join(OUT, `${args.name}-${args.theme}-${args.network}${args.close === 'back' ? '' : `-${args.close}`}`)}-landed.png` })
  await sleep(800)
  await cdp.send('Page.stopScreencast')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const shot = frames.filter((frame) => frame.t >= tappedAt - 0.05)
  const decoded = await Promise.all(shot.map((frame) => sharp(Buffer.from(frame.data, 'base64')).toBuffer({ resolveWithObject: true })))
  const scale = decoded[0]!.info.width / 412
  const left = Math.max(0, Math.min(hero.x, rowBox.x) - 12)
  const right = Math.min(412, Math.max(hero.x + hero.width, rowBox.x + rowBox.width) + 12)
  const area = {
    left: Math.round(left * scale),
    top: Math.max(0, Math.round((Math.min(hero.y, rowBox.y) - 8) * scale)),
    width: Math.round((right - left) * scale),
    height: Math.round((rowBox.y + rowBox.height - hero.y + 16) * scale),
  }
  area.height = Math.min(area.height, decoded[0]!.info.height - area.top)
  // The screencast sends a frame only when the screen changed: the first ten from the tap on, two rows of five.
  const picks = decoded.slice(0, 10).map((frame) => frame.data)
  const columns = 5
  const tileWidth = Math.floor(1000 / columns)
  const tiles = await Promise.all(picks.map((data) => sharp(data).extract(area).resize({ width: tileWidth }).jpeg().toBuffer({ resolveWithObject: true })))
  const tileHeight = Math.max(...tiles.map((tile) => tile.info.height))
  const base = join(OUT, `${args.name}-${args.theme}-${args.network}${args.close === 'back' ? '' : `-${args.close}`}`)
  await sharp({ create: { width: tileWidth * columns, height: tileHeight * Math.ceil(tiles.length / columns), channels: 3, background: '#000' } })
    .composite(tiles.map((tile, i) => ({ input: tile.data, left: (i % columns) * tileWidth, top: Math.floor(i / columns) * tileHeight })))
    .jpeg({ quality: 85 })
    .toFile(`${base}-strip.jpg`)
  const measured = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)
  writeFileSync(`${base}-frames.json`, JSON.stringify({ frames: shot.map((frame) => Math.round((frame.t - tappedAt) * 1000)), measured, row: rowBox, hero }, null, 1))

  // The same close, held still at seven moments of the flight, each cropped to the cover: what the eye sees.
  await sleep(500)
  await row.tap()
  await page.getByTestId('book.hero').waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="book.hero"] [data-cover] img')!).opacity === '1')
  await sleep(500)
  await page.evaluate(() => Object.assign(window, { __freeze: true }))
  if (args.close === 'gesture') await page.goBack()
  else await page.getByTestId('book.back').tap()
  await page.getByTestId('shell.flightCover').waitFor()
  const stills: Buffer[] = []
  const moments = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.92]
  for (const at of moments) {
    await page.evaluate((p) => {
      for (const animation of document.getAnimations())
        if (!(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation)) animation.currentTime = p * 200
    }, at)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const at2 = (await page.getByTestId('shell.flightCover').boundingBox())!
    stills.push(await page.screenshot({ clip: { x: Math.max(0, at2.x - 6), y: Math.max(0, at2.y - 6), width: Math.max(at2.width, 40) + 12, height: Math.max(at2.height, 60) + 12 } }))
  }
  const still = await Promise.all(stills.map((data) => sharp(data).resize({ width: 140, height: 210, fit: 'contain', background: '#808080' }).jpeg().toBuffer()))
  await sharp({ create: { width: 140 * still.length, height: 210, channels: 3, background: '#808080' } })
    .composite(still.map((input, i) => ({ input, left: i * 140, top: 0 })))
    .jpeg({ quality: 90 })
    .toFile(`${base}-stills.jpg`)
  console.log(`${base}: ${shot.length} frames, ${measured.length} measured`)
  console.log(measured.map((frame) => `${Math.round(frame.width)}px copies ${frame.copies.map((c) => c.toFixed(2)).join('/')} held ${frame.held.toFixed(2)}`).join('\n'))
  await browser.close()
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)

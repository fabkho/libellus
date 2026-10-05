/**
 * The Play Store listing's phone screenshots and feature graphic (#90), taken from the app
 * running in Chrome on the Android emulator (docs/TESTING.md) and framed in design D's room.
 *
 *   cd web && pnpm tsx ../android/scripts/store-screenshots.mts --base http://localhost:3102
 *
 * Needs the local stack, the dev server on `--base` (NUXT_PUBLIC_SUPABASE_* pointing at the local
 * stack, as for e2e/android/smoke.ts) and the emulator with Chrome open. It signs up a test member
 * on the local stack (never the hosted one), gives her a Library of real books (titles, authors
 * and covers from Apple's book search), signs in through the screens in the device's Chrome,
 * and takes the page (not Chrome's toolbar) at the phone's resolution: Home, Library, a book and
 * the search, in the dark and the light theme. Then each one is framed on a 1080 × 1920 canvas
 * (Play wants 9:16 or 16:9, at most 2:1) with a one-line caption, into docs/play/. The member
 * and her books are removed at the end (her test address alone would have the suites' sweep
 * take her a day later).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Page } from '@playwright/test'
import { signUpMember } from '../../web/tests/support/member'
import { emailCooldown, readMailedCode, sql, stack, uniqueAppleId } from '../../web/tests/support/stack'
import { createAuth } from '../../web/app/data/auth'
import { createLibrary } from '../../web/app/data/library'
import { createCollections } from '../../web/app/data/collections'
import type { BookSnapshot } from '../../web/app/data/books'
import { isoDay } from '../../web/app/utils/dates'

// This file lives outside web/, so its own packages come from web/node_modules.
const web = new URL('../../web/', import.meta.url)
const require = createRequire(new URL('package.json', web))
const { chromium } = require('@playwright/test') as typeof import('@playwright/test')
const sharp = require('sharp') as typeof import('sharp')

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3102' },
    out: { type: 'string', default: new URL('../../docs/play/', import.meta.url).pathname },
    raw: { type: 'string', default: '/tmp/libellus-90/store-raw' },
    serial: { type: 'string', default: 'emulator-5554' },
  },
})
mkdirSync(args.out!, { recursive: true })
mkdirSync(args.raw!, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'play'

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, ['-s', args.serial!, ...command]).toString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------ the Library

type Wanted = { title: string; author: string; pages: number; year: number }
const READING: Wanted = { title: 'Piranesi', author: 'Susanna Clarke', pages: 272, year: 2020 }
const TO_READ: Wanted[] = [
  { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', pages: 303, year: 2021 },
  { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', pages: 304, year: 1969 },
  { title: 'Station Eleven', author: 'Emily St. John Mandel', pages: 333, year: 2014 },
  { title: 'A Psalm for the Wild-Built', author: 'Becky Chambers', pages: 160, year: 2021 },
]
const FINISHED: (Wanted & { rating: number; daysAgo: number })[] = [
  { title: 'Kindred', author: 'Octavia E. Butler', pages: 287, year: 1979, rating: 20, daysAgo: 12 },
  { title: 'The Remains of the Day', author: 'Kazuo Ishiguro', pages: 245, year: 1989, rating: 18, daysAgo: 40 },
  { title: 'Never Let Me Go', author: 'Kazuo Ishiguro', pages: 288, year: 2005, rating: 16, daysAgo: 75 },
  { title: 'The Dispossessed', author: 'Ursula K. Le Guin', pages: 387, year: 1974, rating: 18, daysAgo: 110 },
]

/** The cover Apple's book search shows for a title, at 600 px. */
async function appleCover(book: Wanted): Promise<string> {
  const url = new URL('https://itunes.apple.com/search')
  url.search = new URLSearchParams({ term: `${book.title} ${book.author}`, entity: 'ebook', limit: '1', country: 'us' }).toString()
  const answer = (await (await fetch(url)).json()) as { results: { artworkUrl100?: string }[] }
  const art = answer.results[0]?.artworkUrl100
  if (!art) throw new Error(`No cover for ${book.title}`)
  return art.replace(/\/\d+x\d+bb\./, '/600x600bb.')
}

async function snapshot(book: Wanted): Promise<BookSnapshot> {
  return {
    title: book.title,
    authors: [book.author],
    isbn13: null,
    isbn10: null,
    pageCount: book.pages,
    year: book.year,
    language: 'en',
    // No publisher: the book page shows it, and the test one is a domain.
    publisher: null,
    description: null,
    coverUrl: await appleCover(book),
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: seeded(uniqueAppleId()),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** The Books this run put into the Catalogue (made-up Apple ids), removed at the end. */
const seededAppleIds: string[] = []
const seeded = (appleId: string) => (seededAppleIds.push(appleId), appleId)

const daysAgo = (days: number) => isoDay(new Date(Date.now() - days * 86_400_000))

async function newMember() {
  const member = await signUpMember()
  await createAuth(member.client).setName('Ada')
  const library = createLibrary(member.client)
  const reading = await library.addToLibrary(await snapshot(READING), { status: 'reading', startedOn: daysAgo(9) })
  if (reading.error) throw new Error(`Seeding failed: ${reading.error}`)
  await library.updateProgress(reading.data.id, { page: 168 })
  // The Books by one author, for a collection.
  const ishiguros: { id: string }[] = []
  for (const book of TO_READ) {
    const added = await library.addToLibrary(await snapshot(book))
    if (added.error) throw new Error(`Seeding failed: ${added.error}`)
    if (book.author === 'Kazuo Ishiguro') ishiguros.push(added.data.book)
  }
  for (const book of FINISHED) {
    const added = await library.addToLibrary(await snapshot(book), {
      status: 'finished',
      startedOn: daysAgo(book.daysAgo + 14),
      endedOn: daysAgo(book.daysAgo),
      rating: book.rating,
    })
    if (added.error) throw new Error(`Seeding failed: ${added.error}`)
    if (book.author === 'Kazuo Ishiguro') ishiguros.push(added.data.book)
  }
  const collections = createCollections(member.client)
  const ishiguro = await collections.create('Ishiguro, all of him')
  if (ishiguro.error) throw new Error(`Seeding failed: ${ishiguro.error}`)
  for (const book of ishiguros) await collections.addEntry(ishiguro.data.id, book)
  return { email: member.email, id: member.id, reading: reading.data.book.id }
}

// ------------------------------------------------------------------ the device

/** Signs in through the screens, after forgetting whoever this Chrome had signed in on the origin. */
async function signIn(page: Page, email: string) {
  await page.goto(`${args.base}/sign-in`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle')
  await emailCooldown()
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await page.waitForURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(email, 2))
  await page.getByTestId('home.title').waitFor()
}

/** The page as the member sees it (Chrome's toolbar left out), at the phone's resolution. */
async function take(page: Page, name: string) {
  await sleep(1200)
  await page.screenshot({ path: join(args.raw!, `${name}.png`) })
}

// ------------------------------------------------------------------ the frames

const font = (file: string) => readFileSync(new URL(`node_modules/@fontsource/${file}`, web)).toString('base64')
const FONTS = `
@font-face { font-family: Newsreader; font-style: italic; font-weight: 400; src: url(data:font/woff2;base64,${font('newsreader/files/newsreader-latin-400-italic.woff2')}) format('woff2'); }
@font-face { font-family: Geist; font-weight: 400; src: url(data:font/woff2;base64,${font('geist/files/geist-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: Geist Mono; font-weight: 400; src: url(data:font/woff2;base64,${font('geist-mono/files/geist-mono-latin-400-normal.woff2')}) format('woff2'); }
`
// design D's room: the dark surface, the lamp's warm glow, cream type.
const ROOM = `background: radial-gradient(70% 45% at 68% 18%, rgba(239,183,104,.16), rgba(239,183,104,0) 70%), #0e0c0a; color: #f1e3c8;`

const FRAMES = [
  { shot: 'home-dark', caption: 'What you are reading, one tap from today.' },
  { shot: 'library-dark', caption: 'Every book you want, read and loved.' },
  { shot: 'book-dark', caption: 'Pages, dates and stars, kept quietly.' },
  { shot: 'search-dark', caption: 'Find any book and add it in a tap.' },
  { shot: 'home-light', caption: 'Light or dark, like a page by the lamp.' },
]

async function frame(tab: Page, shot: string, caption: string) {
  const png = readFileSync(join(args.raw!, `${shot}.png`)).toString('base64')
  await tab.setViewportSize({ width: 1080, height: 1920 })
  await tab.setContent(`<!doctype html><style>${FONTS}
    html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; ${ROOM} }
    .eyebrow { position: absolute; top: 96px; left: 0; right: 0; text-align: center; font: 400 26px 'Geist Mono'; letter-spacing: .32em; text-transform: uppercase; color: rgba(241,227,200,.55); }
    h1 { position: absolute; top: 150px; left: 90px; right: 90px; margin: 0; text-align: center; font: italic 400 72px/1.12 Newsreader; letter-spacing: -.01em; text-wrap: balance; }
    img { position: absolute; left: 50%; top: 420px; width: 700px; transform: translateX(-50%); border-radius: 44px; box-shadow: 0 0 0 2px rgba(241,227,200,.14), 0 40px 120px rgba(0,0,0,.6); }
  </style><div class="eyebrow">libellus</div><h1>${caption}</h1><img src="data:image/png;base64,${png}">`)
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: join(args.out!, `phone-${FRAMES.findIndex((f) => f.shot === shot) + 1}-${shot}.png`) })
}

/** The 1024 × 500 feature graphic: the room, the ribbons, the wordmark and the line from sign-in. */
async function featureGraphic(tab: Page) {
  const icon = readFileSync(new URL('../design/icons/app/favicon.svg', web), 'utf8')
  await tab.setViewportSize({ width: 1024, height: 500 })
  await tab.setContent(`<!doctype html><style>${FONTS}
    html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; ${ROOM} display: flex; align-items: center; justify-content: center; gap: 56px; }
    svg { width: 200px; height: 200px; filter: drop-shadow(0 24px 60px rgba(0,0,0,.55)); }
    .word { font: italic 400 124px/1 Newsreader; letter-spacing: -.02em; }
    p { margin: 18px 0 0; font: 400 30px Geist; color: rgba(241,227,200,.7); }
  </style>${icon}<div><div class="word">libellus</div><p>The books you read, kept quietly.</p></div>`)
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: join(args.out!, 'feature-graphic.png') })
}

// ------------------------------------------------------------------ the run

async function main() {
  const appPort = new URL(args.base!).port
  for (const port of [appPort, new URL(stack.url).port]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')

  const member = await newMember()
  try {
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `${args.base}/`, 'com.android.chrome')
    await sleep(3000)
    const browser = await chromium.connectOverCDP('http://localhost:9333')
    const page = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().startsWith(args.base!))
    if (!page) throw new Error('No Chrome tab on the app: open it on the device first.')
    // tsx wraps functions inside page.evaluate in a `__name` helper the page lacks.
    await page.context().addInitScript('window.__name = (fn) => fn')
    await page.evaluate('window.__name = (fn) => fn')
    await signIn(page, member.email)

    for (const scheme of ['dark', 'light'] as const) {
      // The app follows the device's appearance; Chrome is told which one over DevTools.
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`${args.base}/`)
      await page.getByTestId('home.title').waitFor()
      await take(page, `home-${scheme}`)
      if (scheme === 'light') break
      await page.goto(`${args.base}/library`)
      await page.getByTestId('library.title').waitFor()
      await take(page, `library-${scheme}`)
      await page.goto(`${args.base}/book/${member.reading}`)
      await page.getByTestId('book.title').waitFor()
      await take(page, `book-${scheme}`)
      // The local Catalogue holds the suites' test Books (titles ending in `[<run>]`); the store
      // shows only real ones.
      await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) => {
        const answer = await route.fetch()
        const rows = (await answer.json()) as { title: string }[]
        await route.fulfill({ response: answer, json: rows.filter((row) => !/\[[^\]]+\]$/.test(row.title)) })
      })
      await page.goto(`${args.base}/?search=1`)
      await page.getByTestId('search.query').fill('le guin')
      await sleep(4000)
      // The keyboard down, so the page has the whole screen again.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await take(page, `search-${scheme}`)
    }
    await browser.close()
  } finally {
    await sql('delete from auth.users where id = $1', [member.id])
    await sql('delete from public.books where apple_id = any($1)', [seededAppleIds])
  }

  const browser = await chromium.launch()
  const tab = await browser.newPage()
  for (const { shot, caption } of FRAMES) await frame(tab, shot, caption)
  await featureGraphic(tab)
  await browser.close()
  // Play takes PNG or JPEG up to 8 MB; PNGs this size stay well under, and keep the type crisp.
  for (const { shot } of FRAMES) {
    const file = join(args.out!, `phone-${FRAMES.findIndex((f) => f.shot === shot) + 1}-${shot}.png`)
    const meta = await sharp(file).metadata()
    console.log(file, `${meta.width}x${meta.height}`)
  }
}

await main()

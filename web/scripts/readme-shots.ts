/**
 * The README's screenshots (docs/images/*.jpg), taken from the running app, never by hand.
 *
 *   # the local stack running (`supabase start`), a dev server on any port, then:
 *   LIBELLUS_SHOTS_URL=http://localhost:3125 pnpm exec tsx scripts/readme-shots.ts
 *
 * Makes a throwaway member on the local stack (an @libellus.test address tagged `shots`), fills
 * her Library with a few classics whose Apple Books covers the sign-in wall already uses
 * (components/auth/wall.ts), gives her a name and two Book links, and shoots the
 * phone in WebKit at iPhone size, light and dark. Each shot is written as a JPEG at most 1000 px
 * tall, and the three phones side by side as docs/images/hero.jpg. Covers load from Apple's CDN,
 * so it needs the network; nothing else leaves the machine. Afterwards the member and exactly the
 * Catalogue Books this run made are deleted again.
 */
import { mkdirSync } from 'node:fs'
import { devices, webkit, type Browser, type Page } from '@playwright/test'
import sharp from 'sharp'
import { WALL_COVERS } from '../app/components/auth/wall'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { createLinkTemplates } from '../app/data/linkTemplates'
import { createAuth } from '../app/data/auth'
import { isoDay } from '../app/utils/dates'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'

process.env.LIBELLUS_TEST_RUN ??= 'shots'
const { readMailedCode, sweepRun, emailCooldown, sql, uniqueAppleId } = await import('../tests/support/stack')
const { signUpMember } = await import('../tests/support/member')

const BASE = process.env.LIBELLUS_SHOTS_URL ?? 'http://localhost:3020'
const OUT = new URL('../../docs/images/', import.meta.url)
const MAX = 1000

const cover = (title: string) => WALL_COVERS.find((book) => book.title === title)!

function snapshot(title: string, pages: number, year: number): BookSnapshot {
  const { author, cover: coverUrl } = cover(title)
  return {
    title,
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year,
    language: 'en',
    publisher: null,
    description: null,
    coverUrl,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** `YYYY-MM-DD`, this many days before today. */
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

/** The Catalogue Books this run made (source ids no real Apple Book has), deleted at the end. */
const made: string[] = []

async function seed() {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const add = async (book: BookSnapshot, options: Parameters<typeof library.addToLibrary>[1]) => {
    const result = await library.addToLibrary(book, options)
    if (result.error) throw new Error(`${book.title}: ${result.error}`)
    made.push(result.data.book.id)
    return result.data
  }

  const piranesi = await add(snapshot('Piranesi', 272, 2020), { status: 'finished', startedOn: daysAgo(40), endedOn: daysAgo(31), rating: 19, review: 'A house of endless halls and a tide that comes in on the stairs.' })
  await add(snapshot('Project Hail Mary', 496, 2021), { status: 'finished', startedOn: daysAgo(28), endedOn: daysAgo(17), rating: 18 })
  await add(snapshot('Small Gods', 400, 1992), { status: 'finished', startedOn: daysAgo(15), endedOn: daysAgo(9), rating: 17 })
  const reading = await add(snapshot('Hyperion', 482, 1989), { status: 'reading', startedOn: daysAgo(6) })
  for (const [day, page] of [[5, 44], [4, 97], [3, 131], [1, 188], [0, 232]] as const) {
    const done = await library.updateProgress(reading.id, { page }, undefined, daysAgo(day))
    if (done.error && done.error !== 'date_invalid') throw new Error(`progress: ${done.error}`)
  }
  for (const title of ['Roadside Picnic', 'Use of Weapons', 'Stoner', 'The Carpet Makers', 'Ubik']) {
    await add(snapshot(title, 250, 1970), { status: 'want_to_read' })
  }
  await createAuth(member.client).setName('Ida')
  await createLinkTemplates(member.client).save([
    { label: 'Open Library', url: 'https://openlibrary.org/search?q={title}+{author}' },
    { label: 'Library catalogue', url: 'https://catalogue.example.org/search?q={title}' },
  ])
  return { ...member, piranesi: piranesi.book.id }
}

async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await emailCooldown()
  await page.goto(`${BASE}/sign-in`)
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await page.waitForURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(email, 2))
  await page.getByTestId('home.title').waitFor()
  const state = await context.storageState()
  await context.close()
  return state
}

/** Covers in, fonts in, nothing moving. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true }) || img.addEventListener('error', r, { once: true })))))
  })
  await page.waitForTimeout(600)
}

async function shoot(page: Page, name: string): Promise<Buffer> {
  await settle(page)
  const png = await page.screenshot()
  const jpeg = await sharp(png).resize({ height: MAX, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  await sharp(jpeg).toFile(new URL(`${name}.jpg`, OUT).pathname)
  console.log(`docs/images/${name}.jpg`)
  return jpeg
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await webkit.launch()
  try {
    const member = await seed()
    const storageState = await signIn(browser, member.email)
    const phone = async (colorScheme: 'light' | 'dark') => {
      const context = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme, storageState })
      // A member who has been here before: the install hint was dismissed long ago.
      await context.addInitScript((key) => localStorage.setItem(key, String(Date.now())), INSTALL_HINT_KEY)
      return context.newPage()
    }

    const light = await phone('light')
    await light.goto(`${BASE}/`)
    await light.getByTestId('home.title').waitFor()
    const homeLight = await shoot(light, 'home-light')
    await light.goto(`${BASE}/library`)
    await light.getByTestId('library.title').waitFor()
    await shoot(light, 'library-light')

    const dark = await phone('dark')
    await dark.goto(`${BASE}/`)
    await dark.getByTestId('home.title').waitFor()
    await shoot(dark, 'home-dark')
    await dark.goto(`${BASE}/book/${member.piranesi}`)
    await dark.getByTestId('book.title').waitFor()
    await dark.getByTestId('book.link').first().waitFor()
    const bookDark = await shoot(dark, 'book-dark')
    await dark.goto(`${BASE}/profile`)
    await dark.getByTestId('profile.title').waitFor()
    // The throwaway address is nobody's: the Profile shows the name above it.
    await dark.addStyleTag({ content: '[data-testid="profile.email"] { visibility: hidden }' })
    const profileDark = await shoot(dark, 'profile-dark')

    // Three phones on one ground: Home light, the Book dark, the Profile dark.
    const phones = [homeLight, bookDark, profileDark]
    const meta = await sharp(homeLight).metadata()
    const width = meta.width!
    const height = meta.height!
    const gap = 40
    const margin = 60
    const hero = sharp({
      create: { width: margin * 2 + width * 3 + gap * 2, height: margin * 2 + height, channels: 3, background: '#e9e4da' },
    }).composite(phones.map((input, i) => ({ input, left: margin + i * (width + gap), top: margin })))
    const heroBuffer = await hero.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    await sharp(heroBuffer).resize({ width: MAX, withoutEnlargement: true }).toFile(new URL('hero.jpg', OUT).pathname)
    console.log('docs/images/hero.jpg')
  } finally {
    await browser.close()
    await sweepRun()
    if (made.length) {
      await sql('delete from public.books b where b.id = any($1) and not exists (select 1 from public.library_entries e where e.book_id = b.id)', [made])
    }
  }
}

await main()

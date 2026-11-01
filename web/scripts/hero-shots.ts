/**
 * The README hero: real screens of the running app, composed in HTML (design/readme/hero-*.html).
 *
 *   # the local stack running (`supabase start`), a dev server on any port, then (from web/):
 *   LIBELLUS_SHOTS_URL=http://localhost:3020 pnpm exec tsx scripts/hero-shots.ts shoot
 *   pnpm exec tsx scripts/hero-shots.ts compose [--out /tmp/hero-options] [--ship a|b|c]
 *
 * `shoot` makes a throwaway member on the local stack (an @libellus.test address tagged `hero`), gives her
 * a made-up year of reads (classics and well-known novels, the covers the sign-in wall already uses,
 * components/auth/wall.ts), and shoots the phone in WebKit at iPhone size, 2x, light and dark, into
 * design/readme/shots/ (gitignored). Afterwards the member and the Catalogue Books this run made are deleted.
 * Nobody real is in it: no member, no library, no address.
 *
 * `compose` lays those shots out in the three heroes (design/readme/hero-{a,b,c}.html), screenshots them
 * in Chromium and writes <out>/{a,b,c}.png and sheet.png. `--ship` also writes that one as docs/images/hero.jpg.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, devices, webkit, type Browser, type Page } from '@playwright/test'
import sharp from 'sharp'
import { WALL_COVERS } from '../app/components/auth/wall'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { createLinkTemplates } from '../app/data/linkTemplates'
import { createAuth } from '../app/data/auth'
import { isoDay } from '../app/utils/dates'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const SHOTS = path('../../design/readme/shots').replace(/\/$/, '')
const DESIGN = path('../../design/readme').replace(/\/$/, '')
const BASE = process.env.LIBELLUS_SHOTS_URL ?? 'http://localhost:3020'

const cover = (title: string) => WALL_COVERS.find((book) => book.title === title)!

function snapshot(title: string, pages: number, year: number, uniqueAppleId: () => string): BookSnapshot {
  const { author, cover: coverUrl } = cover(title)
  return {
    title, authors: [author], isbn13: null, isbn10: null, pageCount: pages, year, language: 'en', publisher: null,
    description: null, coverUrl, coverThumbhash: null, coverColors: null, source: 'apple', appleId: uniqueAppleId(),
    openLibraryEditionKey: null, openLibraryWorkKey: null,
  }
}

/** `YYYY-MM-DD`, this many days before today. */
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

/** A made-up year: [title, pages, first published, days ago it ended, days it took, rating in quarter stars (20 = 5)]. */
const FINISHED = [
  ['Tuesdays with Morrie', 192, 1997, 640, 6, 16],
  ['Red Rising', 382, 2014, 600, 9, 17],
  ['The Sandman: Preludes & Nocturnes', 240, 1989, 560, 5, 17],
  ['Flowers for Algernon', 311, 1966, 300, 8, 19],
  ['Stoner', 288, 1965, 270, 9, 19],
  ['Dune', 658, 1965, 232, 18, 18],
  ['Do Androids Dream of Electric Sheep?', 256, 1968, 205, 6, 16],
  ['Small Gods', 400, 1992, 176, 10, 17],
  ['Good Omens', 400, 1990, 146, 9, 17],
  ['Ubik', 224, 1969, 122, 5, 16],
  ['Roadside Picnic', 224, 1972, 98, 6, 18],
  ['The Word for World Is Forest', 189, 1972, 78, 4, 15],
  ['Project Hail Mary', 496, 2021, 52, 11, 18],
  ['Piranesi', 272, 2020, 24, 9, 20],
  ['There Is No Antimemetics Division', 288, 2021, 9, 7, 19],
] as const

const made: string[] = []

async function seed() {
  const { sql, uniqueAppleId } = await import('../tests/support/stack')
  const { signUpMember } = await import('../tests/support/member')
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const add = async (book: BookSnapshot, options: Parameters<typeof library.addToLibrary>[1]) => {
    const result = await library.addToLibrary(book, options)
    if (result.error) throw new Error(`${book.title}: ${result.error}`)
    made.push(result.data.book.id)
    return result.data
  }
  const ids: Record<string, string> = {}
  for (const [title, pages, year, ago, took, rating] of FINISHED) {
    const entry = await add(snapshot(title, pages, year, uniqueAppleId), {
      status: 'finished', startedOn: daysAgo(ago + took), endedOn: daysAgo(ago), rating,
      review: title === 'Piranesi' ? 'A house of endless halls and a tide that comes in on the stairs. I read it twice in one week.' : undefined,
    })
    ids[title] = entry.book.id
  }
  const reading = await add(snapshot('Hyperion', 482, 1989, uniqueAppleId), { status: 'reading', startedOn: daysAgo(6) })
  ids.Hyperion = reading.book.id
  for (const [day, page] of [[5, 44], [4, 97], [3, 131], [1, 188], [0, 232]] as const) {
    const done = await library.updateProgress(reading.id, { page }, undefined, daysAgo(day))
    if (done.error && done.error !== 'date_invalid') throw new Error(`progress: ${done.error}`)
  }
  for (const title of ['The Carpet Makers', 'Use of Weapons', 'Howling Dark', 'Ruin']) {
    await add(snapshot(title, 300, 2000, uniqueAppleId), { status: 'want_to_read' })
  }
  await createAuth(member.client).setName('Mara')
  await createLinkTemplates(member.client).save([
    { label: 'Open Library', url: 'https://openlibrary.org/search?q={title}+{author}' },
    { label: 'Library catalogue', url: 'https://catalogue.example.org/search?q={title}' },
  ])
  return { ...member, ids, sql }
}

async function signIn(browser: Browser, email: string) {
  const { readMailedCode, emailCooldown } = await import('../tests/support/stack')
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
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }) }))))
  })
  await page.waitForTimeout(800)
}

async function shoot() {
  process.env.LIBELLUS_TEST_RUN ??= 'hero'
  mkdirSync(SHOTS, { recursive: true })
  const { sweepRun } = await import('../tests/support/stack')
  const browser = await webkit.launch()
  let sql: Awaited<ReturnType<typeof seed>>['sql'] | undefined
  try {
    const member = await seed()
    sql = member.sql
    const storageState = await signIn(browser, member.email)
    const phone = async (colorScheme: 'light' | 'dark') => {
      const context = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme, storageState })
      await context.addInitScript((key) => localStorage.setItem(key, String(Date.now())), INSTALL_HINT_KEY)
      return context.newPage()
    }
    const snap = async (page: Page, name: string) => {
      // The dev server's own badge and inspector are not the app.
      await page.addStyleTag({ content: '#nuxt-devtools-container, nuxt-devtools-inspect-panel, #vue-tracer-overlay, .nuxt-devtools-frame { display: none !important }' })
      await settle(page)
      await page.screenshot({ path: `${SHOTS}/${name}.png` })
      console.log(`design/readme/shots/${name}.png`)
    }
    for (const scheme of ['light', 'dark'] as const) {
      const page = await phone(scheme)
      await page.goto(`${BASE}/`)
      await page.getByTestId('home.title').waitFor()
      await snap(page, `home-${scheme}`)
      await page.goto(`${BASE}/library`)
      await page.getByTestId('library.title').waitFor()
      await snap(page, `library-${scheme}`)
      for (const [name, title] of [['piranesi', 'Piranesi'], ['hyperion', 'Hyperion'], ['dune', 'Dune']] as const) {
        await page.goto(`${BASE}/book/${member.ids[title]}`)
        await page.getByTestId('book.title').waitFor()
        await snap(page, `book-${name}-${scheme}`)
      }
      await page.goto(`${BASE}/profile`)
      await page.getByTestId('profile.title').waitFor()
      // The throwaway address is nobody's: the Profile shows the name above it.
      await page.addStyleTag({ content: '[data-testid="profile.email"] { visibility: hidden }' })
      await snap(page, `profile-${scheme}`)
      await page.goto(`${BASE}/profile/${new Date().getFullYear()}`)
      await page.getByTestId('yearInReview.title').waitFor()
      await page.addStyleTag({ content: '[data-testid="profile.email"] { visibility: hidden }' })
      await snap(page, `year-${scheme}`)
      await page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && el.scrollHeight > el.clientHeight + 200) el.scrollTo(0, 430) })
      await snap(page, `year-scrolled-${scheme}`)
    }
  } finally {
    await browser.close()
    await sweepRun()
    if (made.length && sql) await sql('delete from public.books b where b.id = any($1) and not exists (select 1 from public.library_entries e where e.book_id = b.id)', [made])
  }
}

const VARIANTS = [
  { key: 'a', width: 800, height: 660, label: 'A · the lamp over one phone' },
  { key: 'b', width: 800, height: 450, label: 'B · two phones, light and dark' },
  { key: 'c', width: 800, height: 350, label: 'C · the banner' },
] as const

async function compose() {
  const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
  const out = flag('--out') ?? '/tmp/hero-options'
  const ship = flag('--ship')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const renders: Record<string, Buffer> = {}
  try {
    for (const v of VARIANTS) {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2 })
      const page = await context.newPage()
      await page.goto(`file://${DESIGN}/hero.html#${v.key}`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0))
      await page.waitForTimeout(400)
      renders[v.key] = await page.screenshot()
      // 8-bit palette keeps the PNG small; the grain dithers it.
      const png = await sharp(renders[v.key]).png({ palette: true, quality: 90, effort: 10, dither: 1 }).toBuffer()
      writeFileSync(`${out}/${v.key}.png`, png)
      console.log(`${out}/${v.key}.png  ${v.width * 2}x${v.height * 2}  ${Math.round(png.length / 1024)} KB`)
      await context.close()
    }
    // The contact sheet: all three at one height, on paper.
    const shown = VARIANTS.map((v) => ({ v, src: `data:image/png;base64,${renders[v.key].toString('base64')}`, w: Math.round((v.width / v.height) * 400) }))
    const sheet = await browser.newContext({ viewport: { width: shown.reduce((n, s) => n + s.w, 0) + 40 * (shown.length + 1), height: 520 }, deviceScaleFactor: 1 })
    const page = await sheet.newPage()
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; padding: 40px; background: #f4f0e9; display: flex; gap: 40px; font: 12px 'SF Mono', Menlo, monospace; color: #3c3251 }
      figure { margin: 0 } img { display: block; height: 400px; box-shadow: 0 2px 4px rgb(0 0 0 / .1), 0 14px 30px rgb(0 0 0 / .14) }
      figcaption { margin-top: 18px; letter-spacing: .08em; text-transform: uppercase }
    </style>${shown.map((s) => `<figure><img src="${s.src}" width="${s.w}"><figcaption>${s.v.label}</figcaption></figure>`).join('')}`)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/sheet.png` })
    console.log(`${out}/sheet.png`)
  } finally {
    await browser.close()
  }
  if (ship) {
    if (!renders[ship]) throw new Error(`--ship ${ship}: no such variant`)
    const target = path('../../docs/images/hero.jpg')
    await sharp(renders[ship]).jpeg({ quality: 84, mozjpeg: true }).toFile(target)
    console.log(`docs/images/hero.jpg  (${ship})  ${Math.round(readFileSync(target).length / 1024)} KB`)
  }
}

const command = process.argv[2]
if (command === 'shoot') await shoot()
else if (command === 'compose') await compose()
else { console.error('usage: hero-shots.ts shoot | compose [--out dir] [--ship a|b|c]'); process.exit(1) }


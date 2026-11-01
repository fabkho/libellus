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
import { describeCover } from '../app/data/covers'
import { createLibrary } from '../app/data/library'
import { createLinkTemplates } from '../app/data/linkTemplates'
import { createAuth } from '../app/data/auth'
import { isoDay } from '../app/utils/dates'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const SHOTS = path('../../design/readme/shots').replace(/\/$/, '')
const DESIGN = path('../../design/readme').replace(/\/$/, '')
const BASE = process.env.LIBELLUS_SHOTS_URL ?? 'http://localhost:3020'
/**
 * A phone's screen, 393 x 740 CSS px. Playwright's own iPhone 15 is 659 high (the browser's bars taken out) and the
 * full screen 852: this is in between, tall enough to read as a phone and short enough that the Stack fills it.
 * The frame in hero.html takes its shape from the shots' size, so nothing is ever stretched.
 */
const PHONE = { ...devices['iPhone 15'], viewport: { width: 393, height: 740 }, screen: { width: 393, height: 740 } }

const M = 'https://is1-ssl.mzstatic.com/image/thumb/'
/** Well-known books that are not on the sign-in wall: Apple Books covers, like the wall's. */
const MORE: Record<string, { author: string; cover: string }> = {
  'To Kill a Mockingbird': { author: 'Harper Lee', cover: `${M}Publication211/v4/f9/80/de/f980de12-09d5-6494-d79b-055ea5b5afc2/9780062368683.jpg/600x900bb.jpg` },
  'Brave New World': { author: 'Aldous Huxley', cover: `${M}Publication221/v4/5d/3d/7e/5d3d7ed2-2dc5-f1f8-c41d-0cc106f16304/1058039742.jpg/600x900bb.jpg` },
  'The Hobbit': { author: 'J. R. R. Tolkien', cover: `${M}Publication122/v4/8a/d8/61/8ad861cd-9c83-512c-d13e-022e625ef4b6/9780547951973.jpg/600x900bb.jpg` },
  'Fahrenheit 451': { author: 'Ray Bradbury', cover: `${M}Publication123/v4/93/e0/2b/93e02bc2-3438-5d55-a588-d20d16054489/9781439142677.jpg/600x900bb.jpg` },
  'Slaughterhouse-Five': { author: 'Kurt Vonnegut', cover: `${M}Publication123/v4/9d/6e/0e/9d6e0e88-3380-d95c-5fa3-26b521663b77/9780440339069.jpg/600x900bb.jpg` },
  Neuromancer: { author: 'William Gibson', cover: `${M}Publication124/v4/f7/cc/14/f7cc14cb-a7c3-46a1-dffa-1e6d3656462a/9781101146460.jpg/600x900bb.jpg` },
  'The Left Hand of Darkness': { author: 'Ursula K. Le Guin', cover: `${M}Publication211/v4/33/13/9c/33139cdd-1a27-94a4-1d8e-29c3bbf39b38/9781101665398.d.jpg/600x900bb.jpg` },
  'A Wizard of Earthsea': { author: 'Ursula K. Le Guin', cover: `${M}Publication126/v4/e6/b4/61/e6b4611c-6763-ed18-fbef-aa3842472ae0/9780544084377.jpg/600x900bb.jpg` },
  'Never Let Me Go': { author: 'Kazuo Ishiguro', cover: `${M}Publication211/v4/e3/7a/c3/e37ac3af-39f8-ae66-eea0-07aa36c5911c/9781400044832.d.jpg/600x900bb.jpg` },
  "The Handmaid's Tale": { author: 'Margaret Atwood', cover: `${M}Publication116/v4/61/f2/a0/61f2a0cb-71f7-e7e3-04f2-bbe93c5a2477/9780547345666.jpg/600x900bb.jpg` },
  Rebecca: { author: 'Daphne du Maurier', cover: `${M}Publication116/v4/6a/fa/2b/6afa2bae-ec76-c9e2-7300-8cda916ebb41/Hum-Books-Red-Cover.jpg/600x900bb.jpg` },
  'The Secret History': { author: 'Donna Tartt', cover: `${M}Publication123/v4/f8/8f/49/f88f4945-faf4-fa0e-c2ae-1242cc9fa53e/9780307765697.d.jpg/600x900bb.jpg` },
  Beloved: { author: 'Toni Morrison', cover: `${M}Publication126/v4/0d/15/ae/0d15aeb1-769b-a506-d4ee-2619bacba09c/9788490623404.jpg/600x900bb.jpg` },
  Solaris: { author: 'Stanisław Lem', cover: `${M}Publication124/v4/11/78/62/117862e8-ba96-c216-7da9-f0f197f132bd/Solaris.jpg/600x900bb.jpg` },
  'The Name of the Rose': { author: 'Umberto Eco', cover: `${M}Publication211/v4/26/f2/47/26f24799-02e7-2e8d-9410-8eb4b3b97e06/9780547575148.jpg/600x900bb.jpg` },
  'One Hundred Years of Solitude': { author: 'Gabriel García Márquez', cover: `${M}Publication221/v4/72/ef/93/72ef93c7-7fc7-3d0e-05e5-ac42cc566fc1/a391bb17-de3c-4152-9278-e78ef5773235_cover_image.jpg/600x900bb.jpg` },
  'Mrs Dalloway': { author: 'Virginia Woolf', cover: `${M}Publication211/v4/ee/8a/bb/ee8abb2a-fd99-da9b-5392-bfcf968b41a7/PDEN202100006.jpg/600x900bb.jpg` },
}

const cover = (title: string) => WALL_COVERS.find((book) => book.title === title) ?? MORE[title]!

/** What the app works out from a cover when a member adds it: its colours and thumbhash (the Stack's spines are in them). */
async function describe(url: string) {
  const image = sharp(Buffer.from(await (await fetch(url)).arrayBuffer()))
  const { data, info } = await image.resize({ width: 64, height: 96, fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { thumbhash, colors } = describeCover({ width: info.width, height: info.height, data })
  return { coverThumbhash: thumbhash, coverColors: colors }
}

async function snapshot(title: string, pages: number, year: number, uniqueAppleId: () => string): Promise<BookSnapshot> {
  const { author, cover: coverUrl } = cover(title)
  return {
    title, authors: [author], isbn13: null, isbn10: null, pageCount: pages, year, language: 'en', publisher: null,
    description: null, coverUrl, ...(await describe(coverUrl)), source: 'apple', appleId: uniqueAppleId(),
    openLibraryEditionKey: null, openLibraryWorkKey: null,
  }
}

/** `YYYY-MM-DD`, this many days before today. */
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

/** A made-up year and a half of reading: [title, pages, first published, days ago it ended, days it took, rating in quarter stars (20 = 5)]. */
const FINISHED = [
  ['Tuesdays with Morrie', 192, 1997, 640, 6, 16],
  ['Red Rising', 382, 2014, 600, 9, 17],
  ['The Sandman: Preludes & Nocturnes', 240, 1989, 560, 5, 17],
  ['To Kill a Mockingbird', 336, 1960, 500, 8, 19],
  ['Brave New World', 288, 1932, 450, 7, 16],
  ['Rebecca', 449, 1938, 400, 12, 18],
  ['Mrs Dalloway', 194, 1925, 372, 5, 15],
  ['The Hobbit', 310, 1937, 300, 9, 18],
  ['Flowers for Algernon', 311, 1966, 288, 6, 19],
  ['Stoner', 288, 1965, 274, 8, 19],
  ['Fahrenheit 451', 194, 1953, 262, 4, 17],
  ['Neuromancer', 271, 1984, 248, 9, 16],
  ['Dune', 658, 1965, 234, 18, 18],
  ['The Left Hand of Darkness', 304, 1969, 220, 8, 18],
  ['Do Androids Dream of Electric Sheep?', 256, 1968, 206, 6, 16],
  ['A Wizard of Earthsea', 183, 1968, 196, 5, 17],
  ['Small Gods', 400, 1992, 184, 10, 17],
  ['Slaughterhouse-Five', 275, 1969, 172, 6, 18],
  ['Good Omens', 400, 1990, 160, 9, 17],
  ['Never Let Me Go', 288, 2005, 150, 7, 19],
  ['Ubik', 224, 1969, 140, 5, 16],
  ['Solaris', 204, 1961, 128, 6, 17],
  ['Roadside Picnic', 224, 1972, 118, 6, 18],
  ['The Secret History', 559, 1992, 108, 14, 18],
  ["The Handmaid's Tale", 311, 1985, 96, 8, 17],
  ['Beloved', 321, 1987, 86, 9, 19],
  ['The Word for World Is Forest', 189, 1972, 78, 4, 15],
  ['The Name of the Rose', 536, 1980, 66, 15, 17],
  ['Project Hail Mary', 496, 2021, 54, 11, 18],
  ['One Hundred Years of Solitude', 417, 1967, 40, 13, 19],
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
    const entry = await add(await snapshot(title, pages, year, uniqueAppleId), {
      status: 'finished', startedOn: daysAgo(ago + took), endedOn: daysAgo(ago), rating,
      review: title === 'Piranesi' ? 'A house of endless halls and a tide that comes in on the stairs. I read it twice in one week.' : undefined,
    })
    ids[title] = entry.book.id
  }
  const reading = await add(await snapshot('Hyperion', 482, 1989, uniqueAppleId), { status: 'reading', startedOn: daysAgo(6) })
  ids.Hyperion = reading.book.id
  for (const [day, page] of [[5, 44], [4, 97], [3, 131], [1, 188], [0, 232]] as const) {
    const done = await library.updateProgress(reading.id, { page }, undefined, daysAgo(day))
    if (done.error && done.error !== 'date_invalid') throw new Error(`progress: ${done.error}`)
  }
  for (const title of ['The Carpet Makers', 'Use of Weapons', 'Howling Dark', 'Ruin']) {
    await add(await snapshot(title, 300, 2000, uniqueAppleId), { status: 'want_to_read' })
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
  const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 2, reducedMotion: 'reduce' })
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
      const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme, storageState })
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
      await page.goto(`${BASE}/profile/shelf`)
      await page.getByTestId('shelf.stage').waitFor()
      await page.getByTestId('shelf.stage').and(page.locator('.ready')).waitFor({ timeout: 30_000 })
      await page.waitForTimeout(3500)
      await snap(page, `stack-${scheme}`)
      // Tap a Book in the pile: it comes out over the room with its card.
      await page.mouse.click(196, 350)
      await page.waitForTimeout(3500)
      await snap(page, `stack-out-${scheme}`)
      await page.goto(`${BASE}/profile`)
      await page.getByTestId('profile.title').waitFor()
      // The throwaway address is nobody's: the Profile shows the name above it.
      await page.addStyleTag({ content: '[data-testid="profile.email"] { visibility: hidden }' })
      await snap(page, `profile-${scheme}`)
      await page.goto(`${BASE}/profile/${new Date().getFullYear()}`)
      await page.getByTestId('yearInReview.title').waitFor()
      await page.addStyleTag({ content: '[data-testid="profile.email"] { visibility: hidden }' })
      await snap(page, `year-${scheme}`)
    }
  } finally {
    await browser.close()
    await sweepRun()
    if (made.length && sql) await sql('delete from public.books b where b.id = any($1) and not exists (select 1 from public.library_entries e where e.book_id = b.id)', [made])
  }
}

const VARIANTS = [
  { key: 'a', width: 800, height: 690, label: 'A · a Book out of the Stack' },
  { key: 'b', width: 800, height: 520, label: 'B · the Stack, light and dark' },
  { key: 'c', width: 800, height: 400, label: 'C · the banner' },
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


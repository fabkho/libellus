import type { Page } from '@playwright/test'
import sharp from 'sharp'
import type { BookSnapshot } from '../../app/data/books'
import { createLibrary } from '../../app/data/library'
import { artworkOf } from '../../app/utils/cover'
import { signUpMember } from '../../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueEditionKey } from '../../tests/support/stack'
import { expect, test } from '../fixtures'
import { handSession, sessionStorageInMemory, untilStill } from '../support'

/**
 * One Book, one cover (docs/plans/covers-consistency.md): a list row and the Book's page show the
 * same image, whatever the row is (her Library, More from the author) and whatever happened to the
 * cover meanwhile (the Catalogue changed it, a size of it failed once). Local only, by hand
 * (`LIBELLUS_E2E_COVERS=1 pnpm e2e e2e/covers`), not in CI: it seeds the cases the analysis found
 * and compares, per case, the image the row shows with the one the page shows.
 *
 * The covers are drawn here, one colour and letter per cover id, so a screenshot says which is which.
 * `LIBELLUS_COVERS_SHOTS=<dir>` writes each case's row and page there.
 */

const SHOTS = process.env.LIBELLUS_COVERS_SHOTS

/** Open Library cover ids the cases use, and what each looks like. */
const ART: Record<number, { colour: string; letter: string }> = {
  9001: { colour: '#b3392f', letter: 'A' },
  9002: { colour: '#2f5fb3', letter: 'B' },
  9003: { colour: '#3a8a4a', letter: 'C' },
  9004: { colour: '#8a6a2f', letter: 'D' },
}
const SIDES = { S: [38, 58], M: [180, 270], L: [330, 500] } as const

const drawn = new Map<string, Buffer>()
async function draw(id: number, size: keyof typeof SIDES): Promise<Buffer> {
  const key = `${id}-${size}`
  const known = drawn.get(key)
  if (known) return known
  const [width, height] = SIDES[size]
  const art = ART[id] ?? { colour: '#555555', letter: '?' }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${art.colour}"/><text x="50%" y="58%" font-family="Helvetica" font-size="${Math.round(height / 3)}" fill="white" text-anchor="middle">${art.letter}</text></svg>`
  const image = await sharp(Buffer.from(svg)).jpeg().toBuffer()
  drawn.set(key, image)
  return image
}

const olCover = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`

/**
 * The sources behind the page, answered here: Open Library's covers drawn by id (a size in `failOnce`
 * answers 503 the first time it is asked), its edition records from `editions`, Apple with nothing.
 */
async function sources(page: Page, { editions = {}, failOnce = [] }: { editions?: Record<string, object>; failOnce?: string[] } = {}) {
  const failed = new Set<string>()
  await page.route('https://covers.openlibrary.org/**', async (route) => {
    const url = route.request().url()
    const match = /\/b\/id\/(\d+)-([SML])\.jpg/.exec(url)
    if (!match) return route.fulfill({ status: 404, body: '' })
    const key = `${match[1]}-${match[2]}`
    if (failOnce.includes(key) && !failed.has(key)) {
      failed.add(key)
      return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503 Service Unavailable</h1>' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: await draw(Number(match[1]), match[2] as keyof typeof SIDES),
    })
  })
  await page.route('https://itunes.apple.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"resultCount":0,"results":[]}' }),
  )
  await page.route('https://openlibrary.org/**', (route) => {
    const url = new URL(route.request().url())
    const isbn = /^\/isbn\/(\d+)\.json$/.exec(url.pathname)?.[1]
    if (isbn && editions[isbn]) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(editions[isbn]) })
    if (isbn) return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    // Search by ISBN (the page's lookup of an edition): the edition's search document, with the record's cover.
    const asked = url.pathname === '/search.json' ? url.searchParams.get('isbn') : null
    const record = asked ? (editions[asked] as { key: string; title: string; covers?: number[] } | undefined) : undefined
    if (record) {
      const doc = { key: '/works/OL90017W', title: record.title, author_name: ['Ada Example'], cover_i: record.covers?.[0], editions: { docs: [{ key: record.key, title: record.title, cover_i: record.covers?.[0], isbn: [asked] }] } }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ numFound: 1, docs: [doc] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"numFound":0,"docs":[]}' })
  })
}

function snapshot(title: string, coverId: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ada Example'],
    isbn13: null,
    isbn10: null,
    pageCount: 320,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: coverId ? olCover(coverId) : null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: uniqueEditionKey(),
    openLibraryWorkKey: null,
  }
}

async function member(page: Page) {
  const { kept, storage } = sessionStorageInMemory()
  const signedUp = await signUpMember(storage)
  await handSession(page, kept)
  return signedUp
}

/** The artwork a cover in `scope` shows once its image has loaded, or 'placeholder'. */
async function shownArtwork(page: Page, scope: string): Promise<string> {
  const cover = page.locator(scope).locator('[data-cover]').first()
  await expect(cover).toBeVisible()
  // Settled: an image that has loaded and faded in, or the cloth (no image).
  await expect
    .poll(async () =>
      cover.evaluate((sheet) => {
        const image = sheet.querySelector<HTMLImageElement>('img:not(.backing)')
        if (!image) return 'placeholder'
        return image.complete && image.naturalWidth > 0 && image.classList.contains('opacity-100') ? (image.currentSrc || image.src) : 'loading'
      }),
    )
    .not.toBe('loading')
  const src = await cover.evaluate((sheet) => {
    const image = sheet.querySelector<HTMLImageElement>('img:not(.backing)')
    return image ? image.currentSrc || image.src : 'placeholder'
  })
  return src === 'placeholder' ? src : artworkOf(src)
}

async function shot(page: Page, scope: string, name: string) {
  if (!SHOTS) return
  await page.locator(scope).first().screenshot({ path: `${SHOTS}/${name}.png` })
}

test.describe('one Book, one cover', () => {
  test.use({ locale: 'de-DE' })

  test('More from the author: the row shows the cover of the edition it opens', async ({ page }) => {
    const signedUp = await member(page)
    const library = createLibrary(signedUp.client)
    const held = (await library.addToLibrary(snapshot('Erstes Buch', 9003))).data!
    // The author, linked, with one more work: its English edition (the card opens it) has its own cover
    // (A, 9001); the work's own cover (B, 9002, the one Open Library shows for the work) is another
    // edition's. No German edition, so a German reader's card falls back past her language.
    const isbn = '9780000090010'
    const [author] = await sql<{ id: string }>(
      `insert into public.authors (openlibrary_key, name, fetched_at, works_fetched_at) values ($1, $2, now(), now()) returning id`,
      [`OL${Math.floor(1_000_000 + Math.random() * 9_000_000)}A`, runTitle('Ada Example')],
    )
    const work = async (title: string, editions: object, cover: string | null, bookId?: string) => {
      const [w] = await sql<{ id: string }>(
        `insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at) values ($1, $2, 2001, 'novel', $3, $4::jsonb, now()) returning id`,
        [`OL${Math.floor(1_000_000 + Math.random() * 9_000_000)}W`, title, cover, JSON.stringify(editions)],
      )
      await sql('insert into public.work_authors (work_id, author_id, position) values ($1, $2, 1)', [w!.id, author!.id])
      if (bookId) await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'title')`, [bookId, w!.id])
    }
    await work(held.book.title, {}, null, held.book.id)
    const other = runTitle('Zweites Buch')
    await work(other, { en: { title: other, isbn13: isbn, openlibrary_edition_key: 'OL90017M', cover_url: olCover(9001) } }, olCover(9002))
    await sql('insert into public.book_authors (book_id, position, author_id) values ($1, 1, $2)', [held.book.id, author!.id])
    await sources(page, {
      editions: { [isbn]: { key: '/books/OL90017M', title: other, covers: [9001], isbn_13: [isbn], works: [{ key: '/works/OL90017W' }] } },
    })

    await page.goto(`/book/${held.book.id}`)
    const row = page.getByTestId('book.authorMoreWork').filter({ hasText: 'Zweites Buch' })
    await row.scrollIntoViewIfNeeded()
    const inRow = await shownArtwork(page, '[data-testid="book.authorMoreWork"]:has-text("Zweites Buch")')
    await shot(page, '[data-testid="book.authorMore"]', 'work-card-row')
    await row.getByTestId('book.authorMoreWorkLink').click()
    await expect(page.getByTestId('book.title')).toHaveText(other)
    await untilStill(page)
    const onPage = await shownArtwork(page, '[data-testid="book.hero"]')
    await shot(page, '[data-testid="book.hero"]', 'work-card-page')
    expect(onPage, 'the page shows the edition the row opened').toBe(artworkOf(olCover(9001)))
    expect(inRow, 'the row shows the cover its page shows').toBe(onPage)
  })

  test('a work’s row: the page shows the row’s cover though a source names another picture of the edition', async ({ page }) => {
    const signedUp = await member(page)
    const library = createLibrary(signedUp.client)
    const held = (await library.addToLibrary(snapshot('Fünftes Buch', 9003))).data!
    // The edition the card opens has its own cover (A, 9001) in the work's record; asked again by its ISBN,
    // the source names another picture of it (D, 9004), as Apple's artwork by ISBN does for an Open Library card.
    const isbn = '9780000090027'
    const [author] = await sql<{ id: string }>(
      `insert into public.authors (openlibrary_key, name, fetched_at, works_fetched_at) values ($1, $2, now(), now()) returning id`,
      [`OL${Math.floor(1_000_000 + Math.random() * 9_000_000)}A`, runTitle('Bea Example')],
    )
    const work = async (title: string, editions: object, cover: string | null, bookId?: string) => {
      const [w] = await sql<{ id: string }>(
        `insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at) values ($1, $2, 2001, 'novel', $3, $4::jsonb, now()) returning id`,
        [`OL${Math.floor(1_000_000 + Math.random() * 9_000_000)}W`, title, cover, JSON.stringify(editions)],
      )
      await sql('insert into public.work_authors (work_id, author_id, position) values ($1, $2, 1)', [w!.id, author!.id])
      if (bookId) await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'title')`, [bookId, w!.id])
    }
    await work(held.book.title, {}, null, held.book.id)
    const other = runTitle('Sechstes Buch')
    await work(other, { en: { title: other, isbn13: isbn, openlibrary_edition_key: 'OL90027M', cover_url: olCover(9001) } }, olCover(9001))
    await sql('insert into public.book_authors (book_id, position, author_id) values ($1, 1, $2)', [held.book.id, author!.id])
    await sources(page, {
      editions: { [isbn]: { key: '/books/OL90027M', title: other, covers: [9004], isbn_13: [isbn], works: [{ key: '/works/OL90027W' }] } },
    })

    await page.goto(`/book/${held.book.id}`)
    const row = page.getByTestId('book.authorMoreWork').filter({ hasText: 'Sechstes Buch' })
    await row.scrollIntoViewIfNeeded()
    const inRow = await shownArtwork(page, '[data-testid="book.authorMoreWork"]:has-text("Sechstes Buch")')
    await shot(page, '[data-testid="book.authorMore"]', 'source-again-row')
    await row.getByTestId('book.authorMoreWorkLink').click()
    await expect(page.getByTestId('book.title')).toHaveText(other)
    await untilStill(page)
    const onPage = await shownArtwork(page, '[data-testid="book.hero"]')
    await shot(page, '[data-testid="book.hero"]', 'source-again-page')
    expect(inRow).toBe(artworkOf(olCover(9001)))
    expect(inRow, 'the row shows the cover its page shows').toBe(onPage)
  })

  test('Library: a cover the Catalogue changed shows the same in the row and on the page', async ({ page }) => {
    const signedUp = await member(page)
    const library = createLibrary(signedUp.client)
    const entry = (await library.addToLibrary(snapshot('Drittes Buch', 9001))).data!
    await sources(page)

    await page.goto('/library')
    expect(await shownArtwork(page, '[data-testid="library.entry"]')).toBe(artworkOf(olCover(9001)))
    // The Book's cover changes in the Catalogue after her device showed it, its hash dropped: what the check
    // did about a minute after an add until 20261029020000 (it now keeps a cover), and what a change of the
    // Catalogue's cover still is to a device that stored the old one.
    await sql('update public.books set cover_url = $2, cover_thumbhash = null, cover_dominant = null, cover_secondary = null where id = $1', [
      entry.book.id,
      olCover(9002),
    ])
    // The next start: the device's copy first, then the database's answer.
    await page.reload()
    await untilStill(page)
    // The lists' refresh has landed when the device's copy names the new cover.
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => (localStorage.getItem(key) ?? '').includes('/b/id/9002-'))))
      .toBe(true)
    const inRow = await shownArtwork(page, '[data-testid="library.entry"]')
    await shot(page, '[data-testid="library.entry"]', 'library-row')
    await page.getByTestId('library.entry').first().click()
    await expect(page.getByTestId('book.title')).toHaveText(entry.book.title)
    await untilStill(page)
    const onPage = await shownArtwork(page, '[data-testid="book.hero"]')
    await shot(page, '[data-testid="book.hero"]', 'library-page')
    expect(onPage).toBe(artworkOf(olCover(9002)))
    expect(inRow, 'the row shows the cover its page shows').toBe(onPage)
  })

  test('Library: a size of the cover failing once does not leave the row without it', async ({ page }) => {
    const signedUp = await member(page)
    const library = createLibrary(signedUp.client)
    const entry = (await library.addToLibrary(snapshot('Viertes Buch', 9004))).data!
    // The row's size (Open Library's 'M') answers 503 once, as archive.org does now and then.
    await sources(page, { failOnce: ['9004-M'] })

    await page.goto('/library')
    const inRow = await shownArtwork(page, '[data-testid="library.entry"]')
    await shot(page, '[data-testid="library.entry"]', 'failed-size-row')
    await page.getByTestId('library.entry').first().click()
    await expect(page.getByTestId('book.title')).toHaveText(entry.book.title)
    await untilStill(page)
    const onPage = await shownArtwork(page, '[data-testid="book.hero"]')
    await shot(page, '[data-testid="book.hero"]', 'failed-size-page')
    expect(onPage).toBe(artworkOf(olCover(9004)))
    expect(inRow, 'the row shows the cover its page shows').toBe(onPage)
  })
})

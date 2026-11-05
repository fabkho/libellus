import { expect, type Page, type Route } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { appleCover } from '../tests/support/apple'
import { sql } from '../tests/support/stack'
import { GOOGLE_BOOKS_FUNCTION } from '../app/data/googleBooks'
import type { GoogleVolume } from '../app/data/googleBooksRecord'
import { test } from './fixtures'
import { recordedApple, signedIn } from './support'

/**
 * Google Books as the last source (issue #305, docs/parity.md "Google Books"): a book only Google knows is found in the Search
 * Palette like any other, opened, and added, and nothing on the way says where it came from. The `google-books` function
 * is stubbed by this spec (the app's own e2e pattern for a function, `GOODREADS_FUNCTION` in e2e/fixtures.ts: the stack runs no
 * edge runtime here, and no flow reaches Google); Apple and Open Library answer from the recordings and know nothing of this
 * title; the Catalogue answers nothing. The cover is Google's image address, linked: served here by a stand-in.
 */

const GOOGLE_FUNCTION = `**/functions/v1/${GOOGLE_BOOKS_FUNCTION}`
/** Invented: an ISBN-13 of the 979-10 range and a title no recording has. */
const ISBN13 = '9791034567898'
const VOLUME: GoogleVolume = {
  id: 'ZZhit0001AAA',
  title: 'Das Leuchten der Nordsee',
  authors: ['Ida Beispiel'],
  isbn13: ISBN13,
  isbn10: null,
  pageCount: 412,
  year: 2019,
  language: 'de',
  publisher: 'Musterverlag',
  genres: ['thriller'],
  coverUrl: 'https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api',
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' }

/** The function as it answers with a key: words and an ISBN find the volume; `book` makes the Catalogue Book (as the service role would). */
async function stubGoogle(page: Page, { configured = true }: { configured?: boolean } = {}) {
  const asked: Record<string, unknown>[] = []
  await page.route(GOOGLE_FUNCTION, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = request.postDataJSON() as Record<string, unknown>
    asked.push(body)
    const answer = async (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(data) })
    if (!configured) return answer({ status: 'unavailable', reason: 'not_configured' })
    if (body.action === 'search') return answer({ status: 'ok', volumes: [VOLUME] })
    if (body.action === 'isbn') return answer({ status: 'found', volume: VOLUME })
    if (body.action === 'book') {
      const [made] = await sql(
        `insert into public.books (title, authors, isbn13, page_count, published_year, language, publisher, cover_url, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'import')
         on conflict do nothing returning *`,
        [VOLUME.title, VOLUME.authors, VOLUME.isbn13, VOLUME.pageCount, VOLUME.year, VOLUME.language, VOLUME.publisher, VOLUME.coverUrl],
      )
      const [book] = made ? [made] : await sql(`select * from public.books where isbn13 = $1 and owner_id is null`, [ISBN13])
      return answer({ status: 'found', book })
    }
    return answer({ status: 'not_found' })
  })
  // Google's cover image: the recorded stand-in, with the CDNs' CORS header.
  await page.route('https://books.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() }),
  )
  return asked
}

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // The Catalogue is shared with every other run on this stack: this flow is about a book only Google knows.
  await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) => route.fulfill({ response: await route.fetch(), body: '[]' }))
  await sql(`delete from public.books where isbn13 = $1 and owner_id is null and not exists (select 1 from public.library_entries e where e.book_id = books.id)`, [ISBN13])
})

test('a book only Google knows is found in Search, opened and added; nothing says where it came from', async ({ page }) => {
  const asked = await stubGoogle(page)
  const member = await signedIn(page)

  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Leuchten der Nordsee Beispiel')

  // The others find nothing: the list is Google's one result, a row like every other.
  const results = page.getByTestId('search.result')
  await expect(results).toHaveCount(1)
  await expect(page.getByTestId('search.resultTitle')).toHaveText('Das Leuchten der Nordsee')
  await expect(page.getByTestId('search.overlay')).not.toContainText(/google/i)
  await expect(page.getByTestId('search.overlay')).not.toContainText(/(^|\W)(apple|open ?library)(\W|$)/i)
  // The browser asked our function once, in words, and never Google (the stub would have refused: only the function and the image are routed).
  expect(asked.map((body) => body.action)).toEqual(['search'])
  expect(asked[0]).toMatchObject({ query: 'Leuchten der Nordsee Beispiel' })

  // Opened: the page shows its facts, and still not a word about the source.
  await results.first().click()
  await expect(page).toHaveURL(new RegExp(`/book/isbn-${ISBN13}$`))
  await expect(page.getByTestId('book.title')).toHaveText('Das Leuchten der Nordsee')
  await expect(page.getByTestId('book.authors')).toHaveText('Ida Beispiel')
  await expect(page.getByTestId('book.facts')).toContainText('2019')
  await expect(page.getByTestId('book.notInLibrary')).toHaveText(en.book.notInLibrary)
  await expect(page.locator('main, body').first()).not.toContainText(/google/i)

  // Added: the function makes the Catalogue Book (what Google says about the ISBN, nothing the app sends), and it lands on Want to read.
  await page.getByTestId('book.add').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  expect(asked.filter((body) => body.action === 'book')).toEqual([{ action: 'book', isbn13: ISBN13 }])

  // The Book is an `import` Book with Google's cover LINKED: never a copy in the cover store, never queued for one.
  const [stored] = await sql<{ source: string; cover_url: string; cover_key: string | null; language: string; page_count: number }>(
    `select b.source, b.cover_url, b.cover_key, b.language, b.page_count from public.library_entries e
       join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored).toMatchObject({ source: 'import', language: 'de', page_count: 412, cover_key: null })
  expect(stored!.cover_url).toBe(VOLUME.coverUrl)
  const [queued] = await sql<{ n: string }>(
    `select count(*)::text as n from private.cover_store_queue q join public.books b on b.id = q.book_id where b.isbn13 = $1 and b.owner_id is null`,
    [ISBN13],
  )
  expect(queued!.n).toBe('0')

  // Back in Search it is hers: the status where the + was, still without a word of its origin.
  await page.getByTestId('book.back').click()
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Leuchten der Nordsee Beispiel')
  await expect(page.getByTestId('search.resultStatus').first()).toHaveText(en.status.want_to_read)
})

test('while the function has no key the search is as it was: nothing found, no error, no word about it', async ({ page }) => {
  const asked = await stubGoogle(page, { configured: false })
  await signedIn(page)
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Leuchten der Nordsee Beispiel')
  await expect(page.getByTestId('search.result')).toHaveCount(0)
  await expect.poll(() => asked.length).toBeGreaterThan(0)
  await expect(page.getByTestId('search.overlay')).not.toContainText(/google|unavailable|error|failed/i)
  await expect(page.getByTestId('search.failed')).toHaveCount(0)
})

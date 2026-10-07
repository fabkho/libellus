import { expect, type Page, type Request } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { GOODREADS_FUNCTION, goodreadsAnswer, test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * Goodreads' rating on the book page (issue #69). The page asks the
 * `goodreads-rating` edge function once it shows and the line opens under the
 * facts: "4.3★ · 137.9K ratings · 6.1K reviews on Goodreads", the word linking
 * to the book's reviews there. Hidden when Goodreads does not know the Book,
 * when the function fails, and for a Book without an ISBN (which never asks).
 * A rating the Library's copy carries shows without the function, offline too.
 * The function is answered here (e2e/fixtures.ts); Goodreads is never reached.
 */

const FOUND = { status: 'found', matchedBy: 'isbn', goodreadsId: '6388978', rating: 4.32, ratingsCount: 137875, reviewsCount: 6116 }

/** A count's copy from en.json, its plural form ("{count} rating | {count} ratings"). */
const many = (key: 'ratings' | 'reviews', count: string) => en.book.goodreads[key].split(' | ')[1]!.replace('{count}', count)
const on = en.book.goodreads.on.replace('{goodreads}', en.book.goodreads.name)

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** A valid ISBN-13 nobody has (979…), so the run never meets a real Book or cached rating. */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    const taken = await sql(
      'select 1 from public.books where isbn13 = $1 union all select 1 from public.goodreads_ratings where isbn13 = $1',
      [isbn],
    )
    if (!taken.length) return isbn
  }
}

function book(title: string, isbn13: string | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Terry Pratchett'],
    isbn13,
    isbn10: null,
    pageCount: 400,
    year: 1992,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Goodreads${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Answers the function with `answer` and keeps what the page asked. */
async function answerGoodreads(page: Page, answer: () => ReturnType<typeof goodreadsAnswer>) {
  const asked: Request[] = []
  await page.route(GOODREADS_FUNCTION, (route) => {
    if (route.request().method() === 'POST') asked.push(route.request())
    return route.fulfill(answer())
  })
  return asked
}

async function openFromLibrary(page: Page, title: string) {
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.entry').filter({ hasText: runTitle(title) }).click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle(title))
}

const cached: string[] = []
test.afterAll(async () => {
  if (cached.length) await sql('delete from public.goodreads_ratings where isbn13 = any($1)', [cached])
})

test('the rating fades in under the facts and links to Goodreads; no ISBN, no line', async ({ page }) => {
  const member = await signedIn(page)
  const isbn13 = await unusedIsbn13()
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Small Gods', isbn13))
  await library.addToLibrary(book('Unnumbered', null))
  const asked = await answerGoodreads(page, () => goodreadsAnswer(FOUND))

  await openFromLibrary(page, 'Small Gods')
  const line = page.getByTestId('book.goodreads')
  await expect(line).toBeVisible()
  await expect(page.getByTestId('book.goodreadsRating')).toHaveText('4.3★')
  await expect(page.getByTestId('book.goodreadsRatings')).toHaveText(many('ratings', '137.9K'))
  await expect(page.getByTestId('book.goodreadsReviews')).toHaveText(`${many('reviews', '6.1K')} ${on}`)
  await expect(page.getByTestId('book.goodreadsRating')).toHaveAttribute(
    'aria-label',
    en.book.goodreads.ratingLabel.replace('{rating}', '4.3'),
  )
  const link = page.getByTestId('book.goodreadsLink')
  await expect(link).toHaveText(en.book.goodreads.name)
  await expect(link).toHaveAttribute('href', 'https://www.goodreads.com/book/show/6388978#CommunityReviews')
  await expect(link).toHaveAttribute('target', '_blank')
  // Under the facts, inside the hero. Both read in one look, once the page has
  // arrived: two looks apart, the page rising in moves between them.
  await expect(page.getByTestId('book.hero').getByTestId('book.goodreads')).toBeVisible()
  await untilStill(page)
  const [facts, lineTop] = await page.evaluate(() =>
    ['book.facts', 'book.goodreads'].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top),
  )
  expect(lineTop).toBeGreaterThan(facts!)

  // Asked once, by ISBN, with what a title search needs.
  expect(asked).toHaveLength(1)
  expect(asked[0]!.postDataJSON()).toEqual({ isbn13, title: runTitle('Small Gods'), authors: ['Terry Pratchett'] })

  // A Book without an ISBN: nothing to ask with, no line.
  await page.getByTestId('book.back').click()
  await openFromLibrary(page, 'Unnumbered')
  await expect(page.getByTestId('book.facts')).toBeVisible()
  await expect(page.getByTestId('book.goodreads')).toBeHidden()
  expect(asked).toHaveLength(1)
})

test('unknown to Goodreads, failing, or without ratings: no line', { tag: '@full' }, async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const titles = ['Unknown', 'Failing', 'Unrated']
  for (const title of titles) await library.addToLibrary(book(title, await unusedIsbn13()))
  const answers: Record<string, ReturnType<typeof goodreadsAnswer>> = {
    [runTitle('Unknown')]: goodreadsAnswer({ status: 'not_found' }),
    [runTitle('Failing')]: goodreadsAnswer({ error: 'goodreads_unavailable' }, 502),
    [runTitle('Unrated')]: goodreadsAnswer({ ...FOUND, rating: 0, ratingsCount: 0, reviewsCount: 0 }),
  }
  const asked: string[] = []
  await page.route(GOODREADS_FUNCTION, (route) => {
    const title = route.request().postDataJSON()?.title as string | undefined
    if (title) asked.push(title)
    return route.fulfill(title ? answers[title]! : goodreadsAnswer({}))
  })

  for (const title of titles) {
    await openFromLibrary(page, title)
    await expect.poll(() => asked).toContain(runTitle(title))
    await expect(page.getByTestId('book.goodreads')).toBeHidden()
    await page.getByTestId('book.back').click()
  }
})

test('a rating the Library carries shows without the function, offline too', { tag: '@full' }, async ({ page }) => {
  const member = await signedIn(page)
  const isbn13 = await unusedIsbn13()
  cached.push(isbn13)
  await sql(
    `insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
     values ($1, 'found', 'title', '32109569', 4.24, 146833, null)`,
    [isbn13],
  )
  await createLibrary(member.client).addToLibrary(book('We Are Legion', isbn13))
  const asked = await answerGoodreads(page, () => goodreadsAnswer({ error: 'busy' }, 503))

  // The function is busy; the Library's copy has the rating (found by title: no review count).
  await openFromLibrary(page, 'We Are Legion')
  await expect.poll(() => asked.length).toBe(1)
  await expect(page.getByTestId('book.goodreadsRating')).toHaveText('4.2★')
  await expect(page.getByTestId('book.goodreadsRatings')).toHaveText(`${many('ratings', '146.8K')} ${on}`)
  await expect(page.getByTestId('book.goodreadsReviews')).toBeHidden()

  // Offline: the same, and nothing is asked.
  await page.getByTestId('book.back').click()
  await page.context().setOffline(true)
  await openFromLibrary(page, 'We Are Legion')
  await expect(page.getByTestId('book.goodreadsRatings')).toHaveText(`${many('ratings', '146.8K')} ${on}`)
  expect(asked).toHaveLength(1)
  await page.context().setOffline(false)
})

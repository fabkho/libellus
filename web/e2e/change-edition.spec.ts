import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createCollections } from '../app/data/collections'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn } from './support'

/**
 * Changing an edition (#41): a member's finished book has the Placeholder
 * cover; from the book page's options she opens Change edition, picks another
 * edition of the work (OpenLibrary's work editions answer from the recording,
 * e2e/support.ts), and the book page shows its cover, while the read, its
 * Rating and review and the book's Collection stay. An edition she already
 * has as another book is refused with a clear message. The Library is the real
 * local stack; the entries are made through the repository so the Book has
 * the work key the recordings know. With docs/parity.md this is the
 * behavioural reference for Change edition.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const PIRANESI_WORK = 'OL20893680W'
/** Two editions in the recording: the Spanish one (2021, 272 pages) and the Italian one, both with a cover. */
const SPANISH = { isbn13: '9788418363283', cover: 'https://covers.openlibrary.org/b/id/15240267-L.jpg' }
const ITALIAN = { isbn13: '9791259670021' }

function piranesi(fields: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle('Piranesi'),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 245,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // No image: the Placeholder cover, as the owner's imported books have.
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: PIRANESI_WORK,
    ...fields,
  }
}

test('a member changes the edition of a finished book: the cover changes, its read and collection stay', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const today = isoDay()
  const entry = (await library.addToLibrary(piranesi(), {
    status: 'finished', startedOn: addDays(today, -40), endedOn: addDays(today, -30), rating: 18, review: 'The House is kind.',
  })).data as LibraryEntry
  const collections = createCollections(member.client)
  const shelf = (await collections.create(runTitle('Favourites'))).data!
  expect((await collections.addEntry(shelf.id, entry.book)).error).toBeNull()

  await page.goto(`/book/${entry.book.id}`)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  // The Placeholder cover: no image on the page yet.
  await expect(page.getByTestId('book.hero').locator('img')).toHaveCount(0)

  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()

  // The current edition is first, marked and picked; Change waits for another.
  const candidates = page.getByTestId('edition.candidate')
  await expect(candidates.first()).toContainText(en.book.edition.current)
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('edition.action')).toBeDisabled()
  // The work's editions arrive, the Spanish one with its language, year and pages.
  const spanish = candidates.filter({ hasText: 'Spanish' })
  await expect(spanish).toHaveCount(1)
  await expect(spanish.getByTestId('edition.candidateFacts')).toHaveText(/Spanish.*2021.*272 pages/)
  await expect(page.getByTestId('edition.loading')).toBeHidden()
  // The recording's 23 editions, three of them listed twice, besides the current one.
  expect(await candidates.count()).toBeGreaterThanOrEqual(20)
  // No source is ever named.
  await expect(page.getByTestId('edition')).not.toContainText(/Apple|Open ?Library/)

  await spanish.click()
  await expect(spanish).toHaveAttribute('aria-checked', 'true')
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()

  // The page is the new Book's now, with its cover; the read and the collection are still there.
  const [changed] = await sql<{ book_id: string; isbn13: string; cover_url: string; cover_thumbhash: string | null }>(
    `select e.book_id, b.isbn13, b.cover_url, b.cover_thumbhash from public.library_entries e
       join public.books b on b.id = e.book_id where e.id = $1`,
    [entry.id],
  )
  expect(changed).toMatchObject({ isbn13: SPANISH.isbn13, cover_url: SPANISH.cover, cover_thumbhash: expect.any(String) })
  await expect(page).toHaveURL(new RegExp(`/book/${changed!.book_id}$`))
  await expect(page.getByTestId('book.hero').locator('img').first()).toHaveAttribute('src', /covers\.openlibrary\.org\/b\/id\/15240267/)
  await expect(page.getByTestId('book.facts')).toContainText('272 pages')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toBeVisible()
  await expect(page.getByTestId('history.session')).toHaveCount(1)
  await expect(page.getByTestId('history')).toContainText('The House is kind.')
  await expect(page.getByTestId('book.collection')).toHaveText(runTitle('Favourites'))

  // The Library and the Collection show the new cover too.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entry').first().locator('img')).toHaveAttribute('src', /15240267/)
  const [kept] = await sql<{ reads: number; on_shelf: boolean }>(
    `select (select count(*)::int from public.reading_sessions where entry_id = $1) as reads,
            exists (select 1 from public.collection_entries where entry_id = $1 and collection_id = $2) as on_shelf`,
    [entry.id, shelf.id],
  )
  expect(kept).toEqual({ reads: 1, on_shelf: true })
})

test('an edition she already has as another book is refused, and the book keeps its edition', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  // Its own title and author, so the other flow's Catalogue search never finds these Books.
  const entry = (await library.addToLibrary(piranesi({ title: runTitle('Kindred'), authors: ['Ada Example'] }))).data!
  // She holds the Italian edition already, as another book.
  const other = await library.addToLibrary(piranesi({
    title: runTitle('Kindred, in Italian'), authors: ['Ada Example'], isbn13: ITALIAN.isbn13, language: 'it', openLibraryWorkKey: null,
  }))
  expect(other.error).toBeNull()

  await page.goto(`/book/${entry.book.id}`)
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  const italian = page.getByTestId('edition.candidate').filter({ hasText: 'Italian' })
  await italian.click()
  await page.getByTestId('edition.action').click()

  await expect(page.getByTestId('edition.error')).toHaveText(en.library.error.edition_in_library)
  await expect(page.getByTestId('edition')).toBeVisible()
  await page.getByTestId('edition.cancel').click()
  await expect(page).toHaveURL(new RegExp(`/book/${entry.book.id}$`))
  expect((await library.entry(entry.id)).data!.book.id).toBe(entry.book.id)
})

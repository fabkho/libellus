import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, recordedApple, signedIn } from './support'

/**
 * "My edition isn't listed" (Change edition). The owner's case: his I Am
 * Legend is ISBN 978-1-399-60773-5 (Gollancz/Orion, 2022), which OpenLibrary
 * knows (the recording, tests/fixtures/openlibrary) and Apple does not. From
 * the book page's Change edition she goes on to find her edition by its ISBN,
 * sees it with its facts, says it is a paperback and uses it: the book page
 * shows the edition, her read stays. An ISBN no source knows leads to her own
 * edition: the format is required, and the rest is what she types. Her format
 * for the edition she has is set in Change edition itself. With
 * docs/parity.md the behavioural reference for the flow.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function legend(fields: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle('I Am Legend'),
    authors: ['Richard Matheson'],
    isbn13: null,
    isbn10: null,
    pageCount: 312,
    year: 2011,
    language: null,
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...fields,
  }
}

async function finishedLegend(page: Parameters<typeof signedIn>[0]) {
  const member = await signedIn(page)
  const today = isoDay()
  const entry = (await createLibrary(member.client).addToLibrary(legend(), {
    status: 'finished', startedOn: addDays(today, -40), endedOn: addDays(today, -30), rating: 16,
  })).data as LibraryEntry
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  return entry
}

async function openMissing(page: Parameters<typeof signedIn>[0]) {
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()
  await expect(page.getByTestId('edition.missing')).toHaveText(en.book.edition.missing)
  await page.getByTestId('edition.missing').click()
  await expect(page.getByTestId('edition')).toBeHidden()
  await expect(page.getByTestId('ownEdition')).toBeVisible()
  await expect(page.getByTestId('ownEdition.isbnStep')).toBeVisible()
}

test('her edition is found by its ISBN, said to be a paperback, and used', async ({ page }) => {
  const entry = await finishedLegend(page)
  // An Apple edition: the page says it is an ebook.
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.ebook)
  await openMissing(page)

  // Not an ISBN: the check digit is off.
  await page.getByTestId('ownEdition.isbn').fill('978-1-399-60773-6')
  await page.getByTestId('ownEdition.lookUp').click()
  await expect(page.getByTestId('ownEdition.isbnInvalid')).toHaveText(en.ownEdition.invalid.isbn)

  await page.getByTestId('ownEdition.isbn').fill('978-1-399-60773-5')
  await page.getByTestId('ownEdition.lookUp').click()
  await expect(page.getByTestId('ownEdition.foundStep')).toBeVisible()
  await expect(page.getByTestId('ownEdition.foundTitle')).toHaveText('I Am Legend')
  await expect(page.getByTestId('ownEdition.foundFacts')).toHaveText(/English.*2022.*176 pages.*Orion Publishing Group/)
  // No source is ever named.
  await expect(page.getByTestId('ownEdition')).not.toContainText(/Apple|Open ?Library/)
  // OpenLibrary does not say its format: none is picked until she says it.
  await expect(page.getByTestId('ownEdition.foundFormat').getByRole('radio', { checked: true })).toHaveCount(0)
  await page.getByTestId('ownEdition.foundFormat.paperback').click()
  await expect(page.getByTestId('ownEdition.foundFormat.paperback')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('ownEdition.foundFacts')).toContainText(en.book.formatFact.paperback)

  await page.getByTestId('ownEdition.use').click()
  await expect(page.getByTestId('ownEdition')).toBeHidden()
  await expect(page.getByTestId('book.title')).toHaveText('I Am Legend')
  await expect(page.getByTestId('book.facts')).toContainText('2022')
  await expect(page.getByTestId('book.facts')).toContainText('176 pages')
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.paperback)
  await expect(page.getByTestId('book.facts')).toContainText('Orion Publishing Group')
  // The read and its Rating stay with the book, now under the new edition's address.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toBeVisible()
  await expect(page).not.toHaveURL(new RegExp(entry.book.id))
})

test('an ISBN no source knows becomes her own edition, with the format she must give', async ({ page }) => {
  const entry = await finishedLegend(page)
  await openMissing(page)

  // 979-0 is music's range: no book has it.
  await page.getByTestId('ownEdition.isbn').fill('979-0-000042-01-8')
  await page.getByTestId('ownEdition.lookUp').click()
  await expect(page.getByTestId('ownEdition.notFound')).toHaveText(en.ownEdition.notFound)
  await expect(page.getByTestId('ownEdition.startOwn')).toHaveText(en.ownEdition.makeOwn)
  await page.getByTestId('ownEdition.startOwn').click()

  await expect(page.getByTestId('ownEdition.ownStep')).toBeVisible()
  await expect(page.getByTestId('ownEdition.isbn')).toHaveValue('979-0-000042-01-8')
  // Without a format nothing is sent.
  await page.getByTestId('ownEdition.submit').click()
  await expect(page.getByTestId('ownEdition.invalid')).toHaveText(en.ownEdition.invalid.format)
  await page.getByTestId('ownEdition.format.hardcover').click()
  await page.getByTestId('ownEdition.year').fill('1999')
  await page.getByTestId('ownEdition.publisher').fill('Tor Books')
  await page.getByTestId('ownEdition.pageCount').fill('288')
  await page.getByTestId('ownEdition.language').selectOption('en')
  await expect(page.getByTestId('ownEdition.private')).toHaveText(en.ownEdition.private)
  await page.getByTestId('ownEdition.submit').click()

  await expect(page.getByTestId('ownEdition')).toBeHidden()
  await expect(page.getByTestId('book.title')).toHaveText(entry.book.title)
  await expect(page.getByTestId('book.facts')).toContainText('1999')
  await expect(page.getByTestId('book.facts')).toContainText('288 pages')
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.hardcover)
  await expect(page.getByTestId('book.facts')).toContainText('Tor Books')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page).not.toHaveURL(new RegExp(entry.book.id))

  // Change edition lists it as her edition, a hardcover.
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  const current = page.getByTestId('edition.candidate').first()
  await expect(current).toContainText(en.book.edition.current)
  await expect(current.getByTestId('edition.candidateFacts')).toContainText(en.book.formatFact.hardcover)
})

test('she says what format the edition she has is, in Change edition', async ({ page }) => {
  await finishedLegend(page)
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()

  // Her edition is picked and says what its source said: an ebook. Nothing to save yet.
  await expect(page.getByTestId('edition.format.ebook')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('edition.action')).toBeDisabled()
  await page.getByTestId('edition.format.paperback').click()
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.save)
  await expect(page.getByTestId('edition.candidate').first().getByTestId('edition.candidateFacts')).toContainText(en.book.formatFact.paperback)
  await page.getByTestId('edition.action').click()

  await expect(page.getByTestId('edition')).toBeHidden()
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.paperback)
  await expect(page.getByTestId('book.facts')).not.toContainText(en.book.formatFact.ebook)
})

import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn } from './support'

/**
 * Reading progress (#39): a member starts a book, records page 120 in the
 * Update progress sheet, sees it on the book page and on Home's card, changes
 * it from Home, and finishes the book; the last page offers Finish; a book
 * without a page count counts in percent. The Library is the real local stack;
 * the Books are made through the repository so they have the page counts the
 * recorded Apple answers lack. With docs/parity.md this is the behavioural
 * reference for progress.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, pageCount: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // Answered by the recorded cover (e2e/support.ts, recordedApple).
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Progress${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

test('a member starts a book, records page 120, sees it on Home, and finishes it', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Piranesi', 480))

  // Want to read: no progress anywhere yet.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.entry').first().click()
  await expect(page.getByTestId('book.progress')).toBeHidden()
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()

  // Currently reading, nothing recorded yet.
  await expect(page.getByTestId('book.progress')).toBeVisible()
  await expect(page.getByTestId('book.progressValue')).toHaveText(en.book.progress.none)
  await page.getByTestId('book.updateProgress').click()

  // Pages, because the edition has a page count; quick buttons count on from what is typed.
  await expect(page.getByTestId('progress')).toBeVisible()
  await expect(page.getByTestId('progress.mode.page')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('progress.reached')).toBeHidden()
  await page.getByTestId('progress.plus25').click()
  await page.getByTestId('progress.plus10').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('35')
  await page.getByTestId('progress.value').fill('120')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // The book page shows it: the bar, "p. 120 of 480" and the 25 % it is.
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 120 of 480')
  await expect(page.getByTestId('book.progressPercent')).toHaveText('25 %')
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuenow', '25')

  // Stored on the open read, as a page and nothing else.
  const [session] = await sql<{ progress_page: number; progress_percent: number | null; stamped: boolean }>(
    `select s.progress_page, s.progress_percent, s.progress_updated_at is not null as stamped
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [member.email],
  )
  expect(session).toEqual({ progress_page: 120, progress_percent: null, stamped: true })

  // Home's card shows the same; tapping the value opens the sheet, with the page in it.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('Piranesi'))
  await expect(page.getByTestId('home.progress')).toHaveText('p. 120 of 480')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '25')
  await page.getByTestId('home.progress').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('120')
  await page.getByTestId('progress.value').fill('300')
  await page.getByTestId('progress.value').press('Enter')
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progress')).toHaveText('p. 300 of 480')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '63')

  // Finish still works from the card, and the closed read keeps the last page.
  await page.getByTestId('home.finish').click()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)
  const [closed] = await sql<{ outcome: string; progress_page: number }>(
    `select s.outcome::text, s.progress_page
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [member.email],
  )
  expect(closed).toEqual({ outcome: 'finished', progress_page: 300 })
})

test('the last page asks "Finished it?" and opens the Finish sheet with the progress saved', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Jonathan Strange', 200), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.progress').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('')
  await expect(page.getByTestId('home.progress')).toHaveText(en.home.progressAdd)
  await page.getByTestId('progress.value').fill('199')
  await expect(page.getByTestId('progress.reached')).toBeHidden()
  await page.getByTestId('progress.value').fill('200')
  await expect(page.getByTestId('progress.reached')).toBeVisible()
  await page.getByTestId('progress.finish').click()

  await expect(page.getByTestId('finish')).toBeVisible()
  await expect(page.getByTestId('progress')).toBeHidden()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()

  // On the book page of the finished read there is no progress block any more.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await page.getByTestId('library.entry').first().click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.progress')).toBeHidden()
  const [closed] = await sql<{ progress_page: number }>(
    `select s.progress_page from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [member.email],
  )
  expect(closed).toEqual({ progress_page: 200 })
})

test('a book without a page count counts in percent; a toggle carries the place over when there is one', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('No pages', null), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.progress').click()
  // No toggle: percent is all there is.
  await expect(page.getByTestId('progress.mode.page')).toBeHidden()
  await page.getByTestId('progress.value').fill('101')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.error')).toHaveText(en.book.progress.invalid.replace('{max}', '100'))
  await page.getByTestId('progress.value').fill('45')
  await expect(page.getByTestId('progress.error')).toBeHidden()
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progress')).toHaveText('45 %')

  // A book with a page count: switch to percent and the page becomes the percent it is.
  await library.addToLibrary(book('Two ways', 400), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  const card = page.getByTestId('home.readingCard').filter({ hasText: runTitle('Two ways') })
  await card.getByTestId('home.progress').click()
  await page.getByTestId('progress.value').fill('100')
  await page.getByTestId('progress.mode.percent').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('25')
  await page.getByTestId('progress.plus10').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('35')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(card.getByTestId('home.progress')).toHaveText('35 %')

  // Opened again it starts in percent, because that is what is stored; pages convert back.
  await card.getByTestId('home.progress').click()
  await expect(page.getByTestId('progress.mode.percent')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('progress.mode.page').click()
  await expect(page.getByTestId('progress.value')).toHaveValue('140')
  await page.getByTestId('progress.value').fill('401')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.error')).toHaveText(en.book.progress.invalid.replace('{max}', '400'))
})

test('a failed save says why and tries again', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Retry', 300), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.progress').click()
  await page.getByTestId('progress.value').fill('50')
  await page.route('**/rest/v1/rpc/update_progress', (route) => route.abort('failed'))
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.failure')).toHaveText(en.library.error.unknown)
  await expect(page.getByTestId('progress.submit')).toHaveText(en.book.progress.retry)
  await expect(page.getByTestId('home.progress')).toHaveText(en.home.progressAdd)

  await page.unroute('**/rest/v1/rpc/update_progress')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progress')).toHaveText('p. 50 of 300')
})

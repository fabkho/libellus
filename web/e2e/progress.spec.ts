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

test('an ebook with its own page count: a page past the edition\'s, "of 480" edited in the sheet, cleared back to the edition\'s', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Ebook', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  const stored = () =>
    sql<{ page_count_override: number | null; progress_page: number | null }>(
      `select e.page_count_override, s.progress_page
         from public.library_entries e
         join public.reading_sessions s on s.entry_id = e.id
         join auth.users u on u.id = e.member_id
        where u.email = $1`,
      [member.email],
    )

  // The edition's total, tappable beside the page; the page past it is refused.
  await page.getByTestId('home.progress').click()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '480'))
  await expect(page.getByTestId('progress.totalGroup')).toBeHidden()
  await page.getByTestId('progress.value').fill('500')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.error')).toHaveText(en.book.progress.invalid.replace('{max}', '480'))

  // Tapping "of 480" opens the total with the edition's as its placeholder and a hint; her own total fits the page.
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.totalValue')).toBeFocused()
  await expect(page.getByTestId('progress.totalValue')).toHaveAttribute('placeholder', '480')
  await expect(page.getByTestId('progress.totalHint')).toHaveText(en.book.progress.totalHint.replace('{count}', '480'))
  await expect(page.getByTestId('progress.totalReset')).toBeHidden()
  await page.getByTestId('progress.totalValue').fill('0')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.totalError')).toHaveText(en.book.progress.totalInvalid)
  await page.getByTestId('progress.totalValue').fill('560')
  await expect(page.getByTestId('progress.totalError')).toBeHidden()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '560'))
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // Home, the book page and the database all use it.
  await expect(page.getByTestId('home.progress')).toHaveText('p. 500 of 560')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '89')
  expect(await stored()).toEqual([{ page_count_override: 560, progress_page: 500 }])
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 500 of 560')
  await expect(page.getByTestId('book.progressPercent')).toHaveText('89 %')
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuenow', '89')

  // The sheet opens with her total in place; the last page is hers too.
  await page.getByTestId('book.updateProgress').click()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '560'))
  await page.getByTestId('progress.value').fill('559')
  await expect(page.getByTestId('progress.reached')).toBeHidden()
  await page.getByTestId('progress.value').fill('560')
  await expect(page.getByTestId('progress.reached')).toBeVisible()

  // Back to the edition's: the total emptied (or "Use the edition's 480"); a page past 480 is refused again.
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.totalValue')).toHaveValue('560')
  await page.getByTestId('progress.totalReset').click()
  await expect(page.getByTestId('progress.totalValue')).toHaveValue('')
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '480'))
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.error')).toHaveText(en.book.progress.invalid.replace('{max}', '480'))
  await page.getByTestId('progress.value').fill('300')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 300 of 480')
  expect(await stored()).toEqual([{ page_count_override: null, progress_page: 300 }])
})

test('a book without a page count can be given one, and the total can change on its own', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book('Bare ebook', null), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.progress').click()
  // Percent only, with the way to pages.
  await expect(page.getByTestId('progress.mode.page')).toBeHidden()
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.mode.page')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('progress.totalHint')).toHaveText(en.book.progress.totalHintNone)
  await expect(page.getByTestId('progress.totalReset')).toBeHidden()
  await page.getByTestId('progress.value').fill('100')
  await page.getByTestId('progress.totalValue').fill('250')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progress')).toHaveText('p. 100 of 250')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '40')

  // The total alone, with the page left as it is; a lower one cuts the page back to it.
  await page.getByTestId('home.progress').click()
  await page.getByTestId('progress.total').click()
  await page.getByTestId('progress.totalValue').fill('320')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('home.progress')).toHaveText('p. 100 of 320')
  await page.getByTestId('home.progress').click()
  await page.getByTestId('progress.total').click()
  await page.getByTestId('progress.totalValue').fill('80')
  // The page in the field (100) does not fit 80: said so, nothing saved.
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('progress.error')).toHaveText(en.book.progress.invalid.replace('{max}', '80'))
  await page.getByTestId('progress.value').fill('')
  await page.getByTestId('progress.submit').click()
  await expect(page.getByTestId('home.progress')).toHaveText('p. 80 of 80')

  // Moving to an edition with its own page count keeps her total.
  const moved = await library.changeEdition(added.data!.id, book('Bare ebook, paper', 300))
  expect(moved.data).toMatchObject({ pageCountOverride: 80, latestSession: { progressPage: 80 } })
})

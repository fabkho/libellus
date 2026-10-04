import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { signedIn } from './support'

/**
 * The Profile (issue #78): the avatar opens it, a pushed screen with the hero
 * (the address while she has no name, since when she reads, the Library in one
 * line), the year pills (All first and lit), the four figures, the books by
 * year (a year opens its review) or by month (a month opens its books), the
 * reading days, the ratings (a row opens the books rated so, a second read
 * marked), the records, the authors read more than once, the years in review,
 * and the account. A year in review: its figures, its months as covers, the
 * favourite, the years either side. The reads are written as an import would
 * (dates in the past). With docs/parity.md (Profile, Year in review) this is
 * the behavioural reference.
 */

function book(title: string, author: string, pages: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year: 1965,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

type Read = [started: string | null, ended: string, rating: number | null, outcome?: 'finished' | 'abandoned']

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
/** The plural form of a `one | many` message. */
const plural = (template: string, count: number, values: Record<string, string | number> = {}) =>
  fill(template.split(' | ')[count === 1 ? 0 : 1]!, { count, ...values })

async function seed(page: Page, client: Parameters<typeof createLibrary>[0]) {
  const library = createLibrary(client)
  const add = async (snapshot: BookSnapshot, reads: Read[]) => {
    const entry = (await library.addToLibrary(snapshot)).data!
    for (const [started, ended, rating, outcome = 'finished'] of reads) {
      await sql('insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, $4, $5)', [
        entry.id,
        started,
        ended,
        outcome,
        rating,
      ])
    }
    return entry
  }
  await add(book('Dune', 'Frank Herbert', 896), [['2025-04-12', '2025-05-17', 16]])
  await add(book('Dune Messiah', 'Frank Herbert', 336), [['2025-05-22', '2025-07-23', 19]])
  await add(book('Piranesi', 'Susanna Clarke', 272), [
    ['2024-11-27', '2024-12-29', 20],
    ['2025-08-31', '2025-09-09', 20],
  ])
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  // Being read, with a day of progress today.
  const eden = await add(book('East of Eden', 'John Steinbeck', 608), [])
  await library.startReading(eden.id, addDays(isoDay(), -2))
  const [read] = await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [eden.id])
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 24)', [read!.id, isoDay()])
  await page.reload()
}

test('the avatar opens the Profile: the figures of all years and of one, the sheets, the year in review', async ({ page }) => {
  const member = await signedIn(page)
  await seed(page, member.client)

  // The avatar opens the Profile, pushed: the hero, All lit.
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('profile.title')).toHaveText(member.email)
  await expect(page.getByTestId('profile.since')).toHaveText(fill(en.profile.since, { date: 'November 2024' }))
  await expect(page.getByTestId('profile.library')).toHaveText(fill(en.profile.library, { read: 3, reading: 1, want: 1 }))
  await expect(page.getByTestId('profile.year.all')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profile.years').getByRole('button')).toHaveText([en.profile.all, '2025', '2024'])

  // All: four finished reads (a re-read counts), the re-read and the DNF under them.
  await expect(page.getByTestId('profile.books')).toHaveText('4')
  await expect(page.getByTestId('profile.booksLine')).toHaveText(
    `${fill(en.profile.figures.rereads, { count: 1 })} · ${fill(en.profile.figures.dnf, { count: 1 })}`,
  )
  await expect(page.getByTestId('profile.pages')).toHaveText('1,776')
  await expect(page.getByTestId('profile.average')).toHaveText('4.7')
  await expect(page.getByTestId('profile.daysABook')).toHaveText('35') // 10, 33, 36, 63: the middle two's mean, rounded
  await expect(page.getByTestId('profile.daysRead')).toHaveText('1/30')
  await expect(page.getByTestId('profile.pagesADay')).toHaveText('24')
  await expect(page.getByTestId('profile.record.longest').getByTestId('profile.readTitle')).toHaveText(runTitle('Dune'))
  await expect(page.getByTestId('profile.authorName')).toHaveText(['Susanna Clarke', 'Frank Herbert']) // a re-read is a return too
  await expect(page.getByTestId('profile.yearCard.2025')).toBeVisible()

  // A star row opens the books rated so, best first; the second read is marked.
  await page.getByTestId('profile.stars.5').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(plural(en.profile.sheet.stars, 5, { year: en.profile.sheet.allYears }))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Piranesi'), runTitle('Piranesi')])
  await expect(page.getByTestId('profileReads.read').first().getByTestId('profile.readAgain')).toHaveText(en.history.ordinal.second)
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // Under All, a year's column opens its review; back is the Profile.
  await page.getByTestId('profile.columns.2024').click()
  await expect(page).toHaveURL(/\/profile\/2024$/)
  await expect(page.getByTestId('yearInReview.title')).toHaveText('2024')
  await page.getByTestId('yearInReview.back').click()
  await expect(page).toHaveURL(/\/profile$/)

  // One year: its figures; a month opens its books, and a book its page.
  await page.getByTestId('profile.year.2025').click()
  await expect(page.getByTestId('profile.books')).toHaveText('3')
  await expect(page.getByTestId('profile.columns.6')).toBeDisabled()
  await page.getByTestId('profile.columns.5').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(fill(en.profile.sheet.month, { month: 'May', year: 2025 }))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Dune')])
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Dune'))
  // Back from the book: the Profile with the sheet it was opened from, open again.
  await page.goBack()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(fill(en.profile.sheet.month, { month: 'May', year: 2025 }))
  await expect(page.getByTestId('profile.year.2025')).toHaveAttribute('aria-pressed', 'true')
  // The book page's own back does the same, from a star row's sheet; Cancel then closes it for good.
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()
  await page.getByTestId('profile.stars.5').click()
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Piranesi'))
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(plural(en.profile.sheet.stars, 5, { year: '2025' }))
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()
  // Opened afresh (not by Back from its book), the Profile starts without a sheet.
  await page.getByTestId('profile.back').click()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.year.2025')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // "2025 in review": its months as covers, the favourite, the year before (in place of this one).
  await page.getByTestId('profile.inReview').click()
  await expect(page).toHaveURL(/\/profile\/2025$/)
  await expect(page.getByTestId('yearInReview.month.5').getByTestId('yearInReview.read')).toHaveCount(1)
  await expect(page.getByTestId('yearInReview.month.6').getByTestId('yearInReview.read')).toHaveCount(0)
  await expect(page.getByTestId('yearInReview.favouriteTitle')).toHaveText(runTitle('Piranesi'))
  await expect(page.getByTestId('yearInReview.after')).toHaveCount(0)
  await page.getByTestId('yearInReview.before').click()
  await expect(page).toHaveURL(/\/profile\/2024$/)
  await expect(page.getByTestId('yearInReview.after')).toBeVisible()
  await page.getByTestId('yearInReview.back').click()
  await expect(page).toHaveURL(/\/profile$/)

  // Back from the Profile is where it was opened.
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('a member with nothing finished yet sees the empty Profile and her account', async ({ page }) => {
  const member = await signedIn(page)
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.empty')).toContainText(en.profile.empty.title)
  await expect(page.getByTestId('profile.figures')).toHaveCount(0)
  await expect(page.getByTestId('profile.library')).toHaveText(fill(en.profile.library, { read: 0, reading: 0, want: 0 }))
  await expect(page.getByTestId('profile.email')).toHaveText(member.email)
  await expect(page.getByTestId('profile.nameValue')).toHaveText(en.account.nameNone)
  await expect(page.getByTestId('profile.import')).toHaveAttribute('href', '/import')
})

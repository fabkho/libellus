import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, daysBetween, isoDay, mondayOf } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * The Profile's chart by month or by week (WP-08, backlog #11b/#11c): the capsule switches the mode and steps the
 * window, a bar opens that month's or week's books, the ends stop, and the mode and window survive a trip to a Book
 * and back. The windows' arithmetic (ISO weeks, New Year, week 53, daylight saving, the ends) is
 * tests/stats-chart.test.ts; this is the flow. Reduce Motion is on, so the unfold is instant here.
 */
test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const today = isoDay()
const thisYear = Number(today.slice(0, 4))

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Finished reads 3, 10 (two), 45, 200 and 420 days ago: this week or the last, an older week, a month, last year's. */
async function someReads(page: Page) {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const reads = [
    ['Piranesi', -3],
    ['Dune', -10],
    ['Emma', -10],
    ['Kafka on the Shore', -45],
    ['Middlemarch', -200],
    ['Beloved', -420],
  ] as const
  for (const [title, back] of reads) {
    await library.addToLibrary(book(title), { status: 'finished', startedOn: addDays(today, back - 7), endedOn: addDays(today, back) })
  }
  return member
}

test('the chart steps by year and by quarter, stops at both ends, opens a week and remembers where it was', async ({ page }) => {
  await someReads(page)
  await openProfile(page)

  const period = page.getByTestId('profile.chart.period')
  const prev = page.getByTestId('profile.chart.prev')
  const next = page.getByTestId('profile.chart.next')

  // Months of this year, to begin with: nothing after today, and her first finish (420 days ago) is in an earlier year.
  await expect(period).toContainText(String(thisYear))
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(12)
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)

  // Back by years down to the one holding her first finish, where ‹ stops.
  const firstYear = Number(addDays(today, -420).slice(0, 4))
  for (let year = thisYear - 1; year >= firstYear; year--) {
    await prev.click()
    await expect(period).toContainText(String(year))
  }
  await expect(prev).toBeDisabled()
  await expect(next).toBeEnabled()
  for (let year = firstYear + 1; year <= thisYear; year++) await next.click()
  await expect(period).toContainText(String(thisYear))
  await expect(next).toBeDisabled()

  // Weeks: thirteen of them, the newest window, its dates under the chart.
  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(period).toContainText(/\d+–\d+ · \d{4}/)
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(13)
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()
  await expect(page.getByTestId('profile.chart.alt')).toContainText('Week')
  await expectAccessible(page, 'the chart by week')

  // The figures under the chart follow the window: the reads of the last 13 weeks (91 days) are 4 of the 6.
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')

  // The week 10 days ago holds Dune and Emma: its bar opens them.
  const monday = mondayOf(addDays(today, -10))
  const key = 13 - daysBetween(monday, mondayOf(today)) / 7
  await page.getByTestId(`profile.columns.${key}`).click()
  await expect(page.getByTestId('profileReads.row')).toHaveCount(2)
  await expect(page.getByTestId('profileReads.sheetTitle')).toContainText(/^Week of /)
  await untilStill(page)

  // A Book opened from the sheet, and back: the chart is still by week, on the same window.
  await page.getByTestId('profileReads.read').first().click()
  await expect(page.getByTestId('book.title')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('profileReads.row')).toHaveCount(2)
  await page.getByTestId('profileReads.cancel').click()
  await untilStill(page)
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await expect(next).toBeDisabled()

  // A quarter back holds none of them, two back holds Middlemarch (200 days ago); › comes back to the newest.
  await prev.click()
  await expect(next).toBeEnabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('0')
  await prev.click()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('1')
  await next.click()
  await next.click()
  await expect(next).toBeDisabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')

  // Months again: the year she left.
  await page.getByTestId('profile.chart.mode.months').click()
  await expect(period).toContainText(String(thisYear))
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
})

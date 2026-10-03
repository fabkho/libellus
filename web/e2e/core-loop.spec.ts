import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, settledBox, signedIn } from './support'

/**
 * The smoke flow of the whole loop Libellus promises (#16), start to end in one
 * session: sign in → search → add → start → finish with a Rating and a review →
 * counted on Home and under Finished. Apple answers from the recordings
 * (e2e/support.ts); the Library is the real local stack, fresh in CI. The
 * per-screen details live in the other specs; this one fails first when the
 * loop itself breaks. With docs/parity.md it is the reference for the flow.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // The Catalogue is shared with every flow running alongside, which may have
  // put another edition of Piranesi there just now; the loop starts from the
  // book Apple Books found, so the Catalogue answers nothing here.
  await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) =>
    route.fulfill({ response: await route.fetch(), body: '[]' }),
  )
})

test('sign in, search, add, start, finish with a rating and a review: counted on Home and under Finished', async ({
  page,
}) => {
  const member = await signedIn(page)
  const year = isoDay().slice(0, 4)

  // Nothing read yet this year.
  await expect(page.getByTestId('home.emptyTitle')).toHaveText(en.home.emptyTitle)

  // Search → open the first result → add it to Want to read.
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)

  // Start reading, then Finish with four stars and a review.
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await page.getByTestId('book.finish').click()
  const rating = page.getByTestId('finish.rating')
  const box = await settledBox(rating)
  // A tap on the fourth star: whole stars, 44 wide with 12 between.
  await page.mouse.click(box.x + 3 * 56 + 22, box.y + box.height / 4)
  await expect(rating).toHaveAttribute('aria-valuenow', '4')
  await page.getByTestId('finish.review').fill('A house of tides and statues.')
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toContainText('4')

  // Home: one read this year, nothing being read.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.tallyCount')).toHaveText('1')
  await expect(page.getByTestId('home.tallyLabel')).toHaveText(en.home.readIn.replace('{year}', year))
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)

  // Finished: under this year, with its Rating.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.yearTitle')).toHaveText([year])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entryRating')).toHaveAttribute(
    'aria-label',
    en.rating.label.replace('{value}', '4.00'),
  )

  // The Rating and the review were stored as typed.
  const [session] = await sql<{ rating: number; review: string }>(
    `select s.rating, s.review from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
      where e.member_id = $1`,
    [member.id],
  )
  expect(session).toEqual({ rating: 16, review: 'A house of tides and statues.' })
})

import { expect, test, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { endFromBook, recordedApple, signedIn } from './support'

/**
 * Reading history and removing (#11): a Book is finished and its read shows in
 * the history; its rating is edited in the Edit sheet; the read is deleted
 * after a confirmation and the Book is back on Want to read. A Book on a
 * Collection is removed from the Library after a confirmation and is gone from
 * the Library and from the Collection. Apple answers from the recordings; the
 * Library is the real local stack. With docs/parity.md this is the behavioural
 * reference for the history block, the Edit sheet and the removal.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Search, open the first result and add it to Want to read. */
async function addPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
}

const readsOf = (memberId: string) =>
  sql<{ outcome: string | null; rating: number | null; review: string | null }>(
    `select s.outcome::text, s.rating, s.review from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id where e.member_id = $1`,
    [memberId],
  )

test('a member finishes a book, edits its rating, deletes the read and the book is on Want to read again', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await addPiranesi(page)

  // Start, then finish with two stars and a review.
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  // One counting rule: the history says "day 1" like the status line.
  await expect(page.getByTestId('book.since')).toContainText('day 1')
  await expect(page.getByTestId('history.days')).toHaveText(en.history.day.replace('{day}', '1'))
  await endFromBook(page, 'finish')
  await page.getByTestId('finish.rating').focus()
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('finish.rating')).toHaveAttribute('aria-valuenow', '2')
  await page.getByTestId('finish.review').fill('A house of tides.')
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()

  // The history shows the one read: its name, outcome, dates, days, rating and review.
  await expect(page.getByTestId('history')).toBeVisible()
  await expect(page.getByTestId('history.count')).toHaveText('1 read')
  await expect(page.getByTestId('history.session')).toHaveCount(1)
  await expect(page.getByTestId('history.name')).toHaveText(en.history.thisRead)
  await expect(page.getByTestId('history.outcome')).toHaveText(en.status.finished)
  // Started and finished today: one date, one day.
  await expect(page.getByTestId('history.days')).toHaveText(en.history.days.split(' | ')[0]!)
  await expect(page.getByTestId('history.dates')).not.toContainText('–')
  await expect(page.getByTestId('history.rating')).toHaveAttribute('aria-label', '2.00 of 5 stars')
  await expect(page.getByTestId('history.review')).toHaveText('A house of tides.')

  // Edit: the sheet starts from the read; five stars, saved.
  await page.getByTestId('history.edit').click()
  await expect(page.getByTestId('editSession')).toBeVisible()
  await expect(page.getByTestId('editSession.ended')).toHaveValue(today)
  await expect(page.getByTestId('editSession.rating')).toHaveAttribute('aria-valuenow', '2')
  await expect(page.getByTestId('editSession.review')).toHaveValue('A house of tides.')
  await page.getByTestId('editSession.rating').focus()
  await page.keyboard.press('End')
  await expect(page.getByTestId('editSession.rating')).toHaveAttribute('aria-valuenow', '5')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession')).toBeHidden()

  // The page shows it without a reload: the status line and the history; the database has it.
  await expect(page.getByTestId('history.rating')).toHaveAttribute('aria-label', '5.00 of 5 stars')
  await expect(page.getByTestId('book.rating')).toHaveAttribute('aria-label', '5.00 of 5 stars')
  expect(await readsOf(member.id)).toEqual([{ outcome: 'finished', rating: 20, review: 'A house of tides.' }])

  // A day in the future is refused in the sheet, which stays open.
  await page.getByTestId('history.edit').click()
  await page.getByTestId('editSession.ended').fill('2999-01-01')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession.error')).toHaveText(en.library.error.date_in_future)
  await expect(page.getByTestId('editSession')).toBeVisible()

  // Delete: it asks first, and Cancel leaves the read alone.
  await page.getByTestId('editSession.delete').click()
  await expect(page.getByTestId('deleteSession')).toBeVisible()
  await expect(page.getByTestId('deleteSession.text')).toContainText(en.deleteSession.only)
  await page.getByTestId('deleteSession.cancel').click()
  await expect(page.getByTestId('deleteSession')).toBeHidden()
  expect(await readsOf(member.id)).toHaveLength(1)

  await page.getByTestId('editSession.delete').click()
  await page.getByTestId('deleteSession.confirm').click()
  await expect(page.getByTestId('deleteSession')).toBeHidden()
  await expect(page.getByTestId('editSession')).toBeHidden()

  // The only read is gone: Want to read again, Start reading offered, no history.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.start')).toBeVisible()
  await expect(page.getByTestId('history')).toBeHidden()
  expect(await readsOf(member.id)).toEqual([])

  // In the Library it is on Want to read, not Finished.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.segment.want_to_read')).toContainText('1')
  await expect(page.getByTestId('library.segment.finished')).toContainText('0')
})

test('a member removes a book that is on a collection: it is gone from the Library and the collection', async ({ page }) => {
  const member = await signedIn(page)
  await addPiranesi(page)

  // A read and a place on a collection to lose.
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await page.getByTestId('book.addToCollection').click()
  await page.getByTestId('picker.new').click()
  await page.getByTestId('picker.newName').fill('Houses')
  await page.getByTestId('picker.create').click()
  // Done once the new Collection is made and ticked (it is not, a moment after the tap).
  await expect(page.getByTestId('picker.collection').filter({ hasText: 'Houses' })).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('picker.action').click()
  await expect(page.getByTestId('book.collection')).toHaveText(['Houses'])
  await expect(page.getByTestId('history.session')).toHaveCount(1)

  // Remove asks first; Cancel keeps everything.
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.remove').click()
  await expect(page.getByTestId('removeEntry')).toBeVisible()
  await expect(page.getByTestId('removeEntry.title')).toContainText('Piranesi')
  await page.getByTestId('removeEntry.cancel').click()
  await expect(page.getByTestId('removeEntry')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)

  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.remove').click()
  await page.getByTestId('removeEntry.confirm').click()
  await expect(page.getByTestId('book.title')).toBeHidden()

  // Gone from the Library...
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.emptyTitle')).toHaveText(en.library.emptyTitle)
  await expect(page.getByTestId('library.collectionsCount')).toHaveText('1')

  // ...and from the collection, which stays, empty.
  await page.getByTestId('library.collections').click()
  await expect(page.getByTestId('collections.itemCount')).toHaveText('0 books')
  await page.getByTestId('collections.item').click()
  await expect(page.getByTestId('collection.title')).toHaveText('Houses')
  await expect(page.getByTestId('collection.entryTitle')).toHaveCount(0)

  // In the database: no entry, no read, no membership; the collection is still there.
  const [left] = await sql<{ entries: string; reads: string; places: string; collections: string }>(
    `select (select count(*) from public.library_entries where member_id = $1) as entries,
            (select count(*) from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.member_id = $1) as reads,
            (select count(*) from public.collection_entries ce join public.collections c on c.id = ce.collection_id where c.member_id = $1) as places,
            (select count(*) from public.collections where member_id = $1) as collections`,
    [member.id],
  )
  expect(left).toEqual({ entries: '0', reads: '0', places: '0', collections: '1' })
})

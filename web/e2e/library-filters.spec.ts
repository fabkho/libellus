import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The Library's filters and sort, and the member's "Read as" (#169, part of #166): Read as, author,
 * rating, year read and page range filters that combine, five sorts, the filters as quiet chips
 * under the segments with the count and Clear, the last choice remembered per member on the
 * device; and Read as on a Book, from its page, the options sheet and the Finish sheet. With
 * docs/parity.md this is the behavioural reference for both. The Library is the real local
 * stack, seeded directly; Apple answers from the recordings. (No layout shift with filters set:
 * e2e/layout-shift.spec.ts.)
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

type Shelved = { title: string; author: string; pages: number | null; ended: string | null; rating: number | null; readAs: string | null }

/** The five finished reads the flows filter and sort, newest end date first. */
const FINISHED: Shelved[] = [
  { title: 'Dune', author: 'Frank Herbert', pages: 612, ended: '2026-05-02', rating: 20, readAs: 'physical' },
  { title: 'Emma', author: 'Jane Austen', pages: 474, ended: '2026-02-10', rating: 12, readAs: 'ebook' },
  { title: 'Hyperion', author: 'Dan Simmons', pages: 482, ended: '2025-11-20', rating: null, readAs: 'audiobook' },
  { title: 'Piranesi', author: 'Susanna Clarke', pages: 272, ended: '2025-03-03', rating: 16, readAs: null },
  { title: 'Earthsea', author: 'Ursula K. Le Guin', pages: 183, ended: '2024-06-01', rating: 8, readAs: 'physical' },
]

async function shelve(memberId: string, books: Shelved[], status: 'finished' | 'want_to_read' | 'reading' = 'finished') {
  for (const [i, b] of books.entries()) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id, page_count) values ($1, $2, 'manual', $3, $4) returning id`,
      [b.title, [b.author], memberId, b.pages],
    )
    const [entry] = await sql<{ id: string }>(
      `insert into public.library_entries (member_id, book_id, status, added_at, read_as)
         values ($1, $2, $3, now() - make_interval(mins => $4), $5) returning id`,
      [memberId, book!.id, status, i, b.readAs],
    )
    if (status === 'finished')
      await sql(
        `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating)
           values ($1, $2::date - 5, $2, 'finished', $3)`,
        [entry!.id, b.ended, b.rating],
      )
    if (status === 'reading')
      await sql(`insert into public.reading_sessions (entry_id, started_on) values ($1, $2)`, [entry!.id, b.ended])
  }
}

const titles = (page: Page) => page.getByTestId('library.entryTitle').allTextContents()

async function openLibrary(page: Page, finished = true) {
  await page.getByTestId('shell.tab.library').click()
  if (finished) await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.view')).toBeVisible()
  await untilStill(page)
}

async function applyFilter(page: Page, choose: () => Promise<void>) {
  await page.getByTestId('library.view.filter').click()
  await expect(page.getByTestId('libraryFilter')).toBeVisible()
  await untilStill(page)
  await choose()
  await page.getByTestId('libraryFilter.action').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await untilStill(page)
}

test('a member filters and sorts what she has finished, and the Library remembers it', async ({ page }) => {
  const member = await signedIn(page)
  await shelve(member.id, FINISHED)
  await openLibrary(page)

  // Quiet by default: Filter and Sort, the count, no chips.
  await expect(page.getByTestId('library.view.count')).toHaveText('5 books')
  await expect(page.getByTestId('library.view.chips')).toBeHidden()
  await expect(page.getByTestId('library.view.filter')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('library.view.sort')).toHaveText(en.library.view.sortBy.replace('{sort}', en.library.view.sortKey.dateRead))
  expect(await titles(page)).toEqual(['Dune', 'Emma', 'Hyperion', 'Piranesi', 'Earthsea'])
  await expect(page.getByTestId('library.year')).toHaveCount(3)

  // Read as: physical. The sheet counts what it would leave before anything is applied.
  await page.getByTestId('library.view.filter').click()
  await expect(page.getByTestId('libraryFilter.count')).toHaveText('5 books')
  // Clear all is there from the start, out of reach and unseen: choosing the first filter moves nothing.
  const clear = page.getByTestId('libraryFilter.clear')
  await expect(clear.locator('..')).toHaveAttribute('inert', '')
  await untilStill(page)
  const before = await page.getByTestId('libraryFilter.section.readAs').boundingBox()
  await page.getByTestId('libraryFilter.readAs.physical').click()
  await expect(clear.locator('..')).not.toHaveAttribute('inert', '')
  expect((await page.getByTestId('libraryFilter.section.readAs').boundingBox())!.y).toBe(before!.y)
  await expect(page.getByTestId('libraryFilter.readAs.physical')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('libraryFilter.count')).toHaveText('2 books')
  expect(await titles(page)).toEqual(['Dune', 'Emma', 'Hyperion', 'Piranesi', 'Earthsea'])
  await page.getByTestId('libraryFilter.action').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Dune', 'Earthsea'])
  await expect(page.getByTestId('library.view.count')).toHaveText('2 of 5 books')
  await expect(page.getByTestId('library.view.chip')).toHaveText([en.library.view.readAs.physical])
  await expect(page.getByTestId('library.view.filter')).toHaveAttribute('aria-pressed', 'true')

  // Cancel leaves the Library as it was.
  await page.getByTestId('library.view.filter').click()
  await page.getByTestId('libraryFilter.readAs.ebook').click()
  await page.getByTestId('libraryFilter.cancel').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Dune', 'Earthsea'])

  // Combined with a rating: 4 stars and up leaves one.
  await applyFilter(page, () => page.getByTestId('libraryFilter.rating.4').click())
  expect(await titles(page)).toEqual(['Dune'])
  await expect(page.getByTestId('library.view.count')).toHaveText('1 of 5 books')
  await expect(page.getByTestId('library.view.chip')).toHaveCount(2)

  // A chip's × takes one filter off, the other stays.
  await page.getByTestId('library.view.chip').first().click()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Dune', 'Piranesi'])
  await expect(page.getByTestId('library.view.chip')).toHaveText([en.library.view.rating.min.replace('{stars}', '4')])

  // Sorting: by title the year groups give way to one list; the same row again turns it round.
  await page.getByTestId('library.view.clear').click()
  await untilStill(page)
  await page.getByTestId('library.view.sort').click()
  await page.getByTestId('librarySort.title').click()
  await expect(page.getByTestId('librarySort')).toBeHidden()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Dune', 'Earthsea', 'Emma', 'Hyperion', 'Piranesi'])
  await expect(page.getByTestId('library.year')).toHaveCount(1)
  await expect(page.getByTestId('library.yearTitle')).toHaveCount(0)
  await expect(page.getByTestId('library.view.sort')).toHaveText(en.library.view.sortBy.replace('{sort}', en.library.view.sortKey.title))
  await page.getByTestId('library.view.sort').click()
  await expect(page.getByTestId('librarySort.title.dir')).toHaveText(en.library.view.sortDir.title.asc)
  await page.getByTestId('librarySort.title').click()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Piranesi', 'Hyperion', 'Emma', 'Earthsea', 'Dune'])

  // By pages, by rating (unrated last), by author.
  // (An author is sorted by the last word of the name: Austen, Clarke, Guin, Herbert, Simmons.)
  for (const [key, order] of [
    ['pages', ['Dune', 'Hyperion', 'Emma', 'Piranesi', 'Earthsea']],
    ['rating', ['Dune', 'Piranesi', 'Emma', 'Earthsea', 'Hyperion']],
    ['author', ['Emma', 'Piranesi', 'Earthsea', 'Dune', 'Hyperion']],
  ] as const) {
    await page.getByTestId('library.view.sort').click()
    await page.getByTestId(`librarySort.${key}`).click()
    await untilStill(page)
    expect(await titles(page)).toEqual(order)
  }

  // Author and page range, then the pages chip.
  await applyFilter(page, async () => {
    await page.getByTestId('libraryFilter.pagesMin').fill('400')
    await page.getByTestId('libraryFilter.pagesMax').fill('500')
  })
  expect(await titles(page)).toEqual(['Emma', 'Hyperion'])
  await expect(page.getByTestId('library.view.chip')).toHaveText([en.library.view.pages.chip.replace('{min}', '400').replace('{max}', '500')])
  await applyFilter(page, () => page.getByTestId('libraryFilter.author').filter({ hasText: 'Jane Austen' }).click())
  expect(await titles(page)).toEqual(['Emma'])

  // Year read.
  await page.getByTestId('library.view.clear').click()
  await applyFilter(page, () => page.getByTestId('libraryFilter.year').filter({ hasText: '2025' }).click())
  expect(await titles(page)).toEqual(['Piranesi', 'Hyperion'])

  // Remembered: a reload opens the Library as she left it, filtered and sorted, from the first frame.
  await page.reload()
  await openLibrary(page)
  expect(await titles(page)).toEqual(['Piranesi', 'Hyperion'])
  await expect(page.getByTestId('library.view.chip')).toHaveText(['2025'])
  await expect(page.getByTestId('library.view.count')).toHaveText('2 of 5 books')

  // Nothing matches: a way out, not an empty list.
  await applyFilter(page, async () => {
    await page.getByTestId('libraryFilter.pagesMin').fill('900')
  })
  await expect(page.getByTestId('library.viewEmpty')).toBeVisible()
  await expect(page.getByTestId('library.entry')).toHaveCount(0)
  await page.getByTestId('library.viewEmpty.clear').click()
  await untilStill(page)
  // Clear leaves the sort she chose.
  expect(await titles(page)).toEqual(['Emma', 'Piranesi', 'Earthsea', 'Dune', 'Hyperion'])
  await expect(page.getByTestId('library.view.chips')).toBeHidden()
  await expect(page.getByTestId('library.view.count')).toHaveText('5 books')
})

test('each segment has its own filters and sort, kept on the device by member', async ({ page }) => {
  const member = await signedIn(page)
  await shelve(member.id, FINISHED)
  await shelve(
    member.id,
    [
      { title: 'Ubik', author: 'Philip K. Dick', pages: 202, ended: null, rating: null, readAs: 'ebook' },
      { title: 'Solaris', author: 'Stanislaw Lem', pages: 204, ended: null, rating: null, readAs: null },
    ].map((b) => ({ ...b, ended: null })),
    'want_to_read',
  )
  await openLibrary(page, false)

  // Want to read offers no rating or year, and nothing set in Finished shows here.
  await expect(page.getByTestId('library.view.count')).toHaveText('2 books')
  await page.getByTestId('library.view.filter').click()
  await expect(page.getByTestId('libraryFilter.section.rating')).toHaveCount(0)
  await expect(page.getByTestId('libraryFilter.section.year')).toHaveCount(0)
  await page.getByTestId('libraryFilter.readAs.ebook').click()
  await page.getByTestId('libraryFilter.action').click()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Ubik'])

  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await expect(page.getByTestId('library.view.chips')).toBeHidden()
  await expect(page.getByTestId('library.view.count')).toHaveText('5 books')
  await page.getByTestId('library.segment.want_to_read').click()
  await expect(page.getByTestId('library.view.chip')).toHaveText([en.library.view.readAs.ebook])

  // What the device keeps is this member's, by her id, outside what signing out clears.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('libellus-library-view') ?? '{}'))
  expect(Object.keys(stored)).toEqual([member.id])
  expect(stored[member.id].want_to_read.readAs).toEqual(['ebook'])
})

test('Not finished is a filter of Finished like the others: no row of its own, and it combines', async ({ page }) => {
  const member = await signedIn(page)
  await shelve(member.id, FINISHED.slice(0, 3))
  const [book] = await sql<{ id: string }>(`insert into public.books (title, authors, source, owner_id, page_count) values ('Ruin', '{"John Gwynne"}', 'manual', $1, 800) returning id`, [member.id])
  const [entry] = await sql<{ id: string }>(`insert into public.library_entries (member_id, book_id, status) values ($1, $2, 'finished') returning id`, [member.id, book!.id])
  await sql(`insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values ($1, '2026-01-01', '2026-01-04', 'abandoned')`, [entry!.id])
  await openLibrary(page)

  // One row under the segments, whatever the segment: the Filter and Sort pills and the count.
  const bar = await page.getByTestId('library.view').boundingBox()
  expect(bar!.height).toBeLessThan(50)
  await expect(page.getByTestId('library.view.count')).toHaveText('4 books')

  await applyFilter(page, async () => {
    await expect(page.getByTestId('libraryFilter.status.finished')).toContainText('3')
    await page.getByTestId('libraryFilter.status.notFinished').click()
    await expect(page.getByTestId('libraryFilter.count')).toHaveText('1 book')
  })
  expect(await titles(page)).toEqual(['Ruin'])
  await expect(page.getByTestId('library.view.count')).toHaveText('1 of 4 books')
  await expect(page.getByTestId('library.entryNotFinished')).toHaveCount(1)

  // Combined with the others, inside the sheet.
  await page.getByTestId('library.view.filter').click()
  await page.getByTestId('libraryFilter.pagesMin').fill('900')
  await expect(page.getByTestId('libraryFilter.count')).toHaveText('0 books')
  await page.getByTestId('libraryFilter.clear').click()
  await expect(page.getByTestId('libraryFilter.count')).toHaveText('4 books')
  await page.getByTestId('libraryFilter.status.finished').click()
  await expect(page.getByTestId('libraryFilter.count')).toHaveText('3 books')
  await page.getByTestId('libraryFilter.cancel').click()
  await untilStill(page)
  expect(await titles(page)).toEqual(['Ruin'])

  // The chip takes it off.
  await page.getByTestId('library.view.chip').click()
  await untilStill(page)
  await expect(page.getByTestId('library.view.count')).toHaveText('4 books')
})

test('Read as: said on the Book page, in its options and when finishing, and the Library filters by it', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await shelve(member.id, [{ title: 'Hyperion', author: 'Dan Simmons', pages: 482, ended: today, rating: null, readAs: null }], 'reading')
  const readAs = () => sql<{ read_as: string | null }>(`select e.read_as from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1 and b.title = 'Hyperion'`, [member.id]).then((rows) => rows[0]!.read_as)

  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.reading').click()
  await page.getByTestId('library.readingCard').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Hyperion')

  // Nothing said: no segment lit. Ebook is hers once tapped, and tapping it again takes it back.
  for (const way of ['physical', 'ebook', 'audiobook'])
    await expect(page.getByTestId(`book.readAs.${way}`)).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('book.readAs.ebook').click()
  await expect(page.getByTestId('book.readAs.ebook')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(readAs).toBe('ebook')
  await page.getByTestId('book.readAs.audiobook').click()
  await expect(page.getByTestId('book.readAs.ebook')).toHaveAttribute('aria-checked', 'false')
  await expect.poll(readAs).toBe('audiobook')
  await page.getByTestId('book.readAs.audiobook').click()
  await expect.poll(readAs).toBeNull()

  // One row of segments, a radio group: the arrow keys move the choice and set it. The row is
  // disabled while the choice above is being saved (ReadAs.vue's `busy`: another is refused while
  // one is on its way), and unlike a tap — Playwright waits for a tap to land on an enabled
  // control, not for `focus()` — a `focus()` into that row lands on nothing, so the key goes to
  // the page and nothing is chosen. The database answers before the app has taken the answer in
  // (the poll above watches the row, not the app), so wait for the row to be live again.
  await expect(page.getByTestId('book.readAs.physical')).toBeEnabled()
  await page.getByTestId('book.readAs.physical').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('book.readAs.ebook')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(readAs).toBe('ebook')
  await page.getByTestId('book.readAs.ebook').click()
  await expect.poll(readAs).toBeNull()

  // The options sheet says the same, and sets it too.
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('bookOptions.readAs.physical').click()
  await expect(page.getByTestId('bookOptions.readAs.physical')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('book.readAs.physical')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(readAs).toBe('physical')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('bookOptions')).toBeHidden()
  await untilStill(page)

  // Finishing says it with the finish: it starts from what she said, and changing it goes along.
  await page.getByTestId('book.finish').click()
  await expect(page.getByTestId('finish')).toBeVisible()
  await untilStill(page)
  await expect(page.getByTestId('finish.readAs.physical')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('finish.readAs.audiobook').click()
  await expect(page.getByTestId('finish.readAs.audiobook')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('finish.readAs.physical')).toHaveAttribute('aria-checked', 'false')
  // Nothing is saved until she finishes.
  expect(await readAs()).toBe('physical')
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect.poll(readAs).toBe('audiobook')
  await expect(page.getByTestId('book.readAs.audiobook')).toHaveAttribute('aria-checked', 'true')

  // The Library's Read as filter finds it.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await applyFilter(page, () => page.getByTestId('libraryFilter.readAs.audiobook').click())
  expect(await titles(page)).toEqual(['Hyperion'])
})

test('Read as is the member\'s own, not the edition\'s: a format alone lights nothing she did not choose', async ({ page }) => {
  // Offline, setting it is refused in the open instead of looking saved.
  const member = await signedIn(page)
  await shelve(member.id, FINISHED.slice(3, 4), 'want_to_read')
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.entry').first().click()
  await expect(page.getByTestId('book.readAs')).toBeVisible()
  await page.context().setOffline(true)
  await expect(page.getByTestId('book.readAs.offline')).toHaveText(en.readAs.offline)
  await expect(page.getByTestId('book.readAs.ebook')).toBeDisabled()
  await page.context().setOffline(false)
  await expect(page.getByTestId('book.readAs.ebook')).toBeEnabled()
})

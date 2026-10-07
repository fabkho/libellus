import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill, goto } from './support'
import { test } from './fixtures'

/**
 * Genres in the app (#168, part of #166): up to three chips on the Book page, below the facts
 * line, hers where she chose them and the computed ones otherwise; the sheet that sets,
 * corrects and resets them; the Library's genre filter; the Profile's figures by genre (the
 * year in view or all time, a row opens the Library filtered by it) and the genres of a year
 * in review. The genres are written as the enrich function stores them (`book_genres`); her
 * own through the app. With docs/parity.md (Genres) this is the behavioural reference.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const label = (id: string) => (en.genre as Record<string, string>)[id]!

type Shelved = { title: string; author: string; genres: string[]; ended: string | null; status?: 'finished' | 'want_to_read' }

/** Puts Books on the member's shelf with computed genres; answers their Book and entry ids by title. */
async function shelve(memberId: string, books: Shelved[]) {
  const ids: Record<string, { book: string; entry: string }> = {}
  for (const [i, b] of books.entries()) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id, page_count) values ($1, $2, 'manual', $3, 300) returning id`,
      [b.title, [b.author], memberId],
    )
    for (const [rank, genre] of b.genres.entries())
      await sql(
        `insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version) values ($1, $2, $3, 'wikidata', 1, 1)`,
        [book!.id, genre, rank + 1],
      )
    const status = b.status ?? 'finished'
    const [entry] = await sql<{ id: string }>(
      `insert into public.library_entries (member_id, book_id, status, added_at) values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
      [memberId, book!.id, status, i],
    )
    if (status === 'finished' && b.ended)
      await sql(
        `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2::date - 5, $2, 'finished', 16)`,
        [entry!.id, b.ended],
      )
    ids[b.title] = { book: book!.id, entry: entry!.id }
  }
  return ids
}

const SHELF: Shelved[] = [
  { title: 'Hyperion', author: 'Dan Simmons', genres: ['sci-fi', 'thriller'], ended: '2024-11-20' },
  { title: 'Dune', author: 'Frank Herbert', genres: ['sci-fi', 'fantasy'], ended: '2024-05-02' },
  { title: 'Earthsea', author: 'Ursula K. Le Guin', genres: ['fantasy'], ended: '2024-03-03' },
  { title: 'Emma', author: 'Jane Austen', genres: ['classics', 'romance'], ended: '2023-02-10' },
  { title: 'Piranesi', author: 'Susanna Clarke', genres: [], ended: '2023-03-03' },
]

const chips = (page: Page) => page.getByTestId('book.genre')

test('a Book shows its genres under the facts, and she corrects them, and takes them back', async ({ page }) => {
  const member = await signedIn(page)
  const ids = await shelve(member.id, SHELF)
  await goto(page, `/book/${ids.Hyperion!.book}`)
  await expect(page.getByTestId('book.title')).toBeVisible()

  // Computed, in the order the source ranked them: right under the facts line, not in the title block.
  await expect(chips(page)).toHaveText([label('sci-fi'), label('thriller')])
  await untilStill(page)
  const facts = await page.getByTestId('book.facts').boundingBox()
  const row = await page.getByTestId('book.genres').boundingBox()
  expect(row!.y).toBeGreaterThanOrEqual(facts!.y + facts!.height)
  await expect(page.getByTestId('book.genresEdit')).toHaveText(en.genre.book.edit)

  // The sheet starts from what the Book has, counts, and lets no fourth in.
  await page.getByTestId('book.genresEdit').click()
  await expect(page.getByTestId('genreSheet')).toBeVisible()
  await untilStill(page)
  await expect(page.getByTestId('genreSheet.genre.sci-fi')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('genreSheet.genre.fantasy')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('genreSheet.count')).toHaveText('2 of 3 chosen')
  await expect(page.getByTestId('genreSheet.reset').locator('..')).toHaveAttribute('inert', '')
  await page.getByTestId('genreSheet.genre.fantasy').click()
  await expect(page.getByTestId('genreSheet.count')).toHaveText('3 of 3 chosen')
  await expect(page.getByTestId('genreSheet.genre.horror')).toBeDisabled()
  // Thriller off, horror in: her own choice, in her order.
  await page.getByTestId('genreSheet.genre.thriller').click()
  await expect(page.getByTestId('genreSheet.genre.horror')).toBeEnabled()
  await page.getByTestId('genreSheet.genre.horror').click()
  await page.getByTestId('genreSheet.action').click()
  await expect(page.getByTestId('genreSheet')).toBeHidden()
  await expect(chips(page)).toHaveText([label('sci-fi'), label('fantasy'), label('horror')])

  // It persisted: another load of the page, and her own choice is what is asked of the database.
  await page.reload()
  await expect(chips(page)).toHaveText([label('sci-fi'), label('fantasy'), label('horror')])
  const [row2] = await sql<{ genre_ids: string[] }>('select genre_ids from public.entry_genres where entry_id = $1', [ids.Hyperion!.entry])
  expect(row2!.genre_ids).toEqual(['sci-fi', 'fantasy', 'horror'])

  // Back to suggested: only offered while the choice is hers.
  await page.getByTestId('book.genresEdit').click()
  await untilStill(page)
  await expect(page.getByTestId('genreSheet.reset').locator('..')).not.toHaveAttribute('inert', '')
  await page.getByTestId('genreSheet.reset').click()
  await expect(page.getByTestId('genreSheet')).toBeHidden()
  await expect(chips(page)).toHaveText([label('sci-fi'), label('thriller')])
  expect(await sql('select 1 from public.entry_genres where entry_id = $1', [ids.Hyperion!.entry])).toHaveLength(0)
})

test('a Book without genres offers to add them, and a Book outside her Library only shows them', async ({ page }) => {
  const member = await signedIn(page)
  const ids = await shelve(member.id, SHELF)
  await goto(page, `/book/${ids.Piranesi!.book}`)
  await expect(chips(page)).toHaveCount(0)
  await expect(page.getByTestId('book.genresEdit')).toHaveText(en.genre.book.add)
  await page.getByTestId('book.genresEdit').click()
  await untilStill(page)
  await page.getByTestId('genreSheet.genre.literary').click()
  await page.getByTestId('genreSheet.genre.fantasy').click()
  await page.getByTestId('genreSheet.action').click()
  await expect(chips(page)).toHaveText([label('literary'), label('fantasy')])

  // A Catalogue Book she does not have: the chips, nothing to edit with.
  const [other] = await sql<{ id: string }>(
    `insert into public.books (title, authors, source, apple_id, publisher, page_count) values ($1, '{"Anna Burns"}', 'apple', $2, $3, 100) returning id`,
    [runTitle('Milkman'), uniqueAppleId(), TEST_PUBLISHER],
  )
  await sql(`insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version) values ($1, 'literary', 1, 'apple', 1, 1)`, [other!.id])
  await goto(page, `/book/${other!.id}`)
  await expect(page.getByTestId('book.notInLibrary')).toBeVisible()
  await expect(chips(page)).toHaveText([label('literary')])
  await expect(page.getByTestId('book.genresEdit')).toHaveCount(0)
})

test('genres are not changed offline: the sheet says so', async ({ page }) => {
  const member = await signedIn(page)
  const ids = await shelve(member.id, SHELF)
  await goto(page, `/book/${ids.Hyperion!.book}`)
  await expect(chips(page)).toHaveCount(2)
  await page.getByTestId('book.genresEdit').click()
  await untilStill(page)
  await page.context().setOffline(true)
  await expect(page.getByTestId('genreSheet.action')).toHaveText(en.common.offline)
  await expect(page.getByTestId('genreSheet.action')).toBeDisabled()
  await page.context().setOffline(false)
  await expect(page.getByTestId('genreSheet.action')).toHaveText(en.genre.sheet.save)
})

test('the Library filters by genre, and the filter is hers: it follows her own choice', async ({ page }) => {
  const member = await signedIn(page)
  const ids = await shelve(member.id, SHELF)
  // She calls Emma fantasy, for herself.
  await goto(page, `/book/${ids.Emma!.book}`)
  await page.getByTestId('book.genresEdit').click()
  await untilStill(page)
  await page.getByTestId('genreSheet.genre.classics').click()
  await page.getByTestId('genreSheet.genre.romance').click()
  await page.getByTestId('genreSheet.genre.fantasy').click()
  await page.getByTestId('genreSheet.action').click()
  await expect(chips(page)).toHaveText([label('fantasy')])

  await goto(page, '/library')
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await page.getByTestId('library.view.filter').click()
  await untilStill(page)
  // The genres of her books, the most read first (fantasy 3, sci-fi 2, ...), each with its count.
  await expect(page.getByTestId('libraryFilter.section.genre')).toBeVisible()
  const pills = page.getByTestId('libraryFilter.genre')
  await expect(pills.first()).toContainText(label('fantasy'))
  await expect(pills.first()).toContainText('3')
  await expect(pills.filter({ hasText: label('romance') })).toHaveCount(0)
  await pills.filter({ hasText: label('sci-fi') }).click()
  await page.getByTestId('libraryFilter.action').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await untilStill(page)
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Hyperion', 'Dune'])
  await expect(page.getByTestId('library.view.chip')).toHaveText([label('sci-fi')])

  // Another genre adds to it (any of them passes), and a chip's × takes it off.
  await page.getByTestId('library.view.filter').click()
  await untilStill(page)
  await page.getByTestId('libraryFilter.genre').filter({ hasText: label('fantasy') }).click()
  await page.getByTestId('libraryFilter.action').click()
  await untilStill(page)
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Hyperion', 'Dune', 'Earthsea', 'Emma'])
  await page.getByTestId('library.view.chip').first().click()
  await untilStill(page)
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Dune', 'Earthsea', 'Emma'])

  // Remembered on the device, genres and all.
  await page.reload()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.view.chip')).toHaveText([label('fantasy')])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Dune', 'Earthsea', 'Emma'])
})

test('the Profile counts her reading by genre, a row opens the Library filtered, and the year in review has them too', async ({ page }) => {
  const member = await signedIn(page)
  await shelve(member.id, SHELF)
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)

  // All time: five books, four of them placed. Sci-fi and fantasy in two of the four.
  const genres = page.getByTestId('profile.genres')
  await expect(genres).toBeVisible()
  await expect(page.getByTestId('profile.genresPlaced')).toHaveText('Of 4 books · 1 without a genre')
  await expect(genres.locator('[data-testid^="profile.genre."]')).toHaveCount(5)
  await expect(page.getByTestId('profile.genre.sci-fi')).toContainText('50%')
  await expect(page.getByTestId('profile.genre.fantasy')).toContainText('50%')
  await expect(page.getByTestId('profile.genre.sci-fi')).toHaveAccessibleName(/Science fiction: 50% of your books, 2 books/)

  // A year: 2024 is Hyperion, Dune and Earthsea.
  await page.getByTestId('profile.year.2024').click()
  await untilStill(page)
  await expect(page.getByTestId('profile.genresPlaced')).toHaveText('Of 3 books')
  await expect(page.getByTestId('profile.genre.fantasy')).toContainText('67%')
  await expect(page.getByTestId('profile.genre.thriller')).toContainText('33%')

  // Its row opens the Library, Finished, that genre and that year.
  await page.getByTestId('profile.genre.fantasy').click()
  await expect(page).toHaveURL(/\/library$/)
  await untilStill(page)
  await expect(page.getByTestId('library.segment.finished')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('library.view.chip')).toHaveText(['2024', label('fantasy')])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Dune', 'Earthsea'])

  // A year in review: its top three, the same rows.
  await goto(page, '/profile/2023')
  await expect(page.getByTestId('yearInReview.title')).toHaveText('2023')
  await untilStill(page)
  await expect(page.getByTestId('profile.genresPlaced')).toHaveText('Of 1 book · 1 without a genre')
  await expect(page.getByTestId('profile.genre.classics')).toContainText('100%')
  await page.getByTestId('profile.genre.romance').click()
  await expect(page).toHaveURL(/\/library$/)
  await untilStill(page)
  await expect(page.getByTestId('library.view.chip')).toHaveText(['2023', label('romance')])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Emma'])
})

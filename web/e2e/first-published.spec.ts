import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { shelveBook, sharedBook } from '../tests/support/notes'
import { test } from './fixtures'
import { goto, signedIn, untilStill } from './support'

/**
 * The two years on the Book page (docs/proposals/first-published-data-2026-11-15.md §4, `utils/publishedYear.ts`):
 * the facts row says when the *work* was first published, and a quiet line under About says which edition this is and
 * when it was printed — but only where the two differ, so nothing is said twice.
 *
 * A Book that enrich matched is what this needs: a Book in the Catalogue with a `book_works` row whose work carries an
 * earlier `first_year` than the edition's `published_year`. Nothing in the e2e fixtures made one (they cover reading,
 * not enrichment), so the smallest one that does is made here — two Books of one Work, one member's, swept with the
 * run like the rest (tests/support/stack.ts, `sweepRun` removes works by the run's title tag).
 */

/** The work's year, well before the edition's: a reprint, the case the hero exists for. */
const FIRST_YEAR = 1949
/** The edition she holds: a 2023 reprint. */
const EDITION_YEAR = 2023

/** Links the Book to a work first published in `firstYear` (`works_identified` wants an OL key or a Wikidata id). */
async function linkWork(bookId: string, title: string, firstYear: number) {
  const key = `OL${String(Math.floor(Math.random() * 8_000_000) + 1_000_000)}W`
  const [work] = await sql<{ id: string }>(
    `insert into public.works (title, openlibrary_key, first_year) values ($1, $2, $3) returning id`,
    [title, key, firstYear],
  )
  await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'openlibrary')`, [bookId, work!.id])
}

test.describe.configure({ mode: 'serial' })

test('a Book whose work predates its edition shows the work’s year, and the edition line under About', async ({ page }) => {
  const member = await signedIn(page)

  const snapshot = sharedBook('First Published')
  const title = snapshot.title
  const bookId = await shelveBook(member, snapshot, 'reading')
  // A publisher and a year this edition really has, so the line has both parts and the facts row has a contrast.
  await sql('update public.books set published_year = $2, publisher = $3 where id = $1', [bookId, EDITION_YEAR, 'Penguin'])
  await linkWork(bookId, `${title} (the work)`, FIRST_YEAR)

  await goto(page, `/book/${bookId}`)
  // The facts row says the work's year, not the edition's.
  await expect(page.getByTestId('book.facts')).toContainText(String(FIRST_YEAR))
  await expect(page.getByTestId('book.facts')).not.toContainText(String(EDITION_YEAR))
  // …and the line under About says which edition this is and when it was printed.
  await expect(page.getByTestId('book.thisEdition')).toHaveText(
    en.book.thisEdition.replace('{publisher}', 'Penguin').replace('{year}', String(EDITION_YEAR)),
  )
  await untilStill(page)

  // G1: a work dated after its own edition is a wrong link, so the hero keeps the edition's year and the line says nothing.
  await sql('update public.works set first_year = $2 where title = $1', [`${title} (the work)`, EDITION_YEAR + 10])
  await goto(page, `/book/${bookId}`)
  await expect(page.getByTestId('book.facts')).toContainText(String(EDITION_YEAR))
  await expect(page.getByTestId('book.thisEdition')).toHaveCount(0)
})

test('a Book no work was ever matched to keeps today’s year and has no edition line', async ({ page }) => {
  const member = await signedIn(page)

  const snapshot = sharedBook('No Work')
  const bookId = await shelveBook(member, snapshot, 'want_to_read')

  await goto(page, `/book/${bookId}`)
  // The edition's own year, as before: no work, so nothing better to show.
  await expect(page.getByTestId('book.title')).toHaveText(snapshot.title)
  await expect(page.getByTestId('book.facts')).toContainText(String(snapshot.year))
  // The same number would only be repeated under the description, so there is no line at all.
  await expect(page.getByTestId('book.thisEdition')).toHaveCount(0)
})

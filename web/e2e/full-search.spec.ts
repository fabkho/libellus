import { expect, test, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'

/**
 * Full search (#12): the own Catalogue, Apple Books and OpenLibrary behind one
 * field and one list. Apple and OpenLibrary answer from the recordings
 * (e2e/support.ts); the Catalogue and the Library are the real local stack.
 * Where a result comes from is never shown. With docs/parity.md (Search) this
 * is the behavioural reference for search.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

async function searchFor(page: Page, query: string) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill(query)
}

/** The result rows' titles, best match first (the list is drawn bottom-up). */
const titles = (page: Page) => page.getByTestId('search.resultTitle').allInnerTexts()

test('one list from every source, best match next to the query, sources never shown', async ({ page }) => {
  const member = await signedIn(page)
  await searchFor(page, 'Piranesi')

  const results = page.getByTestId('search.result')
  await expect(results.first()).toContainText('Susanna Clarke')
  // Every source has answered once a book only OpenLibrary knows is in the list.
  await expect(page.getByTestId('search.resultTitle').filter({ hasText: /^Piranesi As Designer$/ })).toHaveCount(1)

  const listed = await titles(page)
  expect(listed[0]).toBe('Piranesi')
  // The novel is one row, not one per edition; Gibbon's histories come after every title match.
  expect((await results.filter({ hasText: 'Susanna Clarke' }).allInnerTexts()).filter((row) => row.startsWith('Piranesi\n'))).toHaveLength(1)
  const firstGibbon = listed.findIndex((title) => title.includes('Decline and Fall'))
  const lastTitleMatch = listed.findLastIndex((title) => title.toLowerCase().startsWith('piranesi'))
  expect(firstGibbon).toBeGreaterThan(lastTitleMatch)
  // The best match sits nearest the query, at the bottom.
  const best = (await results.first().boundingBox())!
  const next = (await results.nth(1).boundingBox())!
  expect(best.y).toBeGreaterThan(next.y)
  // No source is ever named.
  await expect(page.getByTestId('search.overlay')).not.toContainText(/Apple|Open ?Library/)

  // A book only OpenLibrary has opens and goes into the Library like any other.
  await page.getByTestId('search.result').filter({ hasText: 'Piranesi As Designer' }).click()
  await expect(page).toHaveURL(/\/book\/(ol-OL11381152M|[0-9a-f-]{36})$/)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi As Designer')
  await expect(page.getByTestId('book.facts')).toContainText('2008')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)

  // Its cover came from OpenLibrary, large, with its thumbhash and colours.
  const [stored] = await sql<{ cover_url: string; cover_thumbhash: string | null; openlibrary_edition_key: string }>(
    `select b.cover_url, b.cover_thumbhash, b.openlibrary_edition_key from public.library_entries e
       join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored).toMatchObject({
    cover_url: 'https://covers.openlibrary.org/b/id/2684687-L.jpg',
    cover_thumbhash: expect.any(String),
    openlibrary_edition_key: 'OL11381152M',
  })

  // Searching again, it comes from the Catalogue, once, with its status.
  await searchFor(page, 'piranesi as des')
  const row = page.getByTestId('search.result').filter({ hasText: 'Piranesi As Designer' })
  await expect(row).toHaveCount(1)
  await expect(page.getByTestId('search.resultStatus').first()).toHaveText(en.status.want_to_read)
})

test('an ISBN is looked up, not searched', async ({ page }) => {
  await signedIn(page)
  await searchFor(page, '978-3-641-26486-4')
  await expect(page.getByTestId('search.resultTitle')).toHaveText(['Piranesi'])
  await page.getByTestId('search.result').click()
  await expect(page).toHaveURL(/\/book\/(apple-1506831259|[0-9a-f-]{36})$/)
})

test('a failing source is silent; another edition in the Library is pointed out', async ({ page }) => {
  const member = await signedIn(page)
  // The member reads an edition of Piranesi none of the sources lists: her own
  // Manual book, so no other member (no flow running alongside) ever sees it.
  // It goes with her when the run's members are removed.
  const [book] = await sql<{ id: string }>(
    `insert into public.books (title, authors, source, owner_id) values ('Piranesi', '{"Susanna Clarke"}', 'manual', $1)
     returning id`,
    [member.id],
  )
  await sql(`insert into public.library_entries (member_id, book_id, status) values ($1, $2, 'want_to_read')`, [
    member.id,
    book!.id,
  ])
  // The Catalogue does not answer (it would have brought her edition along).
  await page.route(/\/rest\/v1\/rpc\/search_books/, (route) => route.fulfill({ status: 503, body: '{}' }))

  await searchFor(page, 'Piranesi')
  const clarke = page.getByTestId('search.result').first()
  await expect(clarke).toContainText('Susanna Clarke')
  await expect(clarke.getByTestId('search.resultOtherEdition')).toHaveText(en.search.otherEdition)
  // It is not her edition, so it can still be added.
  await expect(page.getByTestId('search.add').first()).toBeVisible()
  await expect(page.getByTestId('search.resultOtherEdition')).toHaveCount(1)
  await expect(page.getByTestId('search.failed')).toHaveCount(0)
})

test('only when every source fails does the member see one note', async ({ page }) => {
  await signedIn(page)
  await page.route('https://itunes.apple.com/**', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.route('https://openlibrary.org/**', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.route(/\/rest\/v1\/rpc\/search_books/, (route) => route.fulfill({ status: 503, body: '{}' }))

  await searchFor(page, 'Piranesi')
  await expect(page.getByTestId('search.failed')).toContainText(en.search.failedTitle)
  await expect(page.getByTestId('search.result')).toHaveCount(0)
})

test('offline, search answers from her own Library at once and says so (#15)', async ({ page, context }) => {
  await signedIn(page)
  await context.setOffline(true)
  await searchFor(page, 'Piranesi')
  // A new member's Library is empty: nothing found there, and no source is asked.
  await expect(page.getByTestId('search.noResults')).toContainText(en.search.offlineNoResults.replace('{query}', 'Piranesi'))
  await expect(page.getByTestId('search.offline')).toHaveText(en.search.offlineNote)
  await expect(page.getByTestId('search.failed')).toBeHidden()
  await context.setOffline(false)
})

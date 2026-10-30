import { expect } from '@playwright/test'
import { test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { goto, signedIn } from './support'

/**
 * Offline (#15) as the screens say it: with no connection the writes that can
 * wait stay available (#93 — Finish on the Library, Remove on her Book's page),
 * every action that needs the connection is disabled and says "Offline" instead
 * of failing quietly (Change edition), search answers from her own Library with
 * one quiet note and offers no Manual add, and back online both are there again
 * without a reload.
 *
 * What the device's copy is made of — the Library kept after a load, read back on
 * the next start, one member's, cleared on sign-out, a write refused offline — is
 * tests/offline.test.ts's and tests/device-data.test.ts's, and offline-sync.spec.ts
 * and delete-account-offline.spec.ts take a reload offline to show it on Home and on
 * the Profile. This flow reloads nothing, so it needs no stand-in for the service
 * worker (e2e/offlineShell.ts): the dev server has none, and a page load answered
 * from a route is what WebKit cannot do while the context is offline.
 */
function book(title: string, author: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // Answered by the recorded cover (e2e/fixtures.ts, noLiveApis).
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Offline${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

test('offline the actions that need the connection say so, search finds her own books, and both come back online', async ({ page }) => {
  const member = await signedIn(page)

  // Her Library: one Book on each Status.
  const library = createLibrary(member.client)
  const today = isoDay()
  await library.addToLibrary(book('Halls of Tide', 'Odile Marsh'))
  await library.addToLibrary(book('The Night Lamp', 'Pell Ravenscar'), { status: 'reading', startedOn: today })
  await library.addToLibrary(book('Winter Pages', 'Ilse Varga'), { status: 'finished', endedOn: today, rating: 18 })

  // Loaded online once: the Library, and a Book's page (so its code is on the device too).
  await goto(page, '/library')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Halls of Tide'))
  await page.getByTestId('library.entry').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Halls of Tide'))
  await page.goBack()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Halls of Tide'))

  // No connection from here on, and no reload: what the screens say while the device has none.
  await page.context().setOffline(true)

  // Finishing can wait to sync (#93): the shortcut stays, and does not say Offline.
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('The Night Lamp'))
  await expect(page.getByTestId('library.finish')).toBeEnabled()
  await expect(page.getByTestId('library.finish')).toHaveText(en.book.finish)

  // Search answers from her own Library, and says so once.
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('halls')
  await expect(page.getByTestId('search.resultTitle')).toHaveText([runTitle('Halls of Tide')])
  await expect(page.getByTestId('search.resultStatus')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('search.offline')).toHaveText(en.search.offlineNote)
  await expect(page.getByTestId('search.failed')).toBeHidden()
  // By author as well; a Book she does not have is not found, and nothing offers to add one.
  await page.getByTestId('search.query').fill('varga')
  await expect(page.getByTestId('search.resultTitle')).toHaveText([runTitle('Winter Pages')])
  await page.getByTestId('search.query').fill('Dune')
  await expect(page.getByTestId('search.noResults')).toContainText(en.search.offlineNoResults.replace('{query}', 'Dune'))
  await expect(page.getByTestId('search.offline')).toHaveText(en.search.offlineNote)
  await expect(page.getByTestId('search.addManually')).toBeHidden()

  // Her Book's page opens from what search found (it remembers the Books it showed);
  // Remove can wait to sync (#93), and Change edition looks editions up: it needs the connection.
  await page.getByTestId('search.query').fill('halls')
  await page.getByTestId('search.result').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Halls of Tide'))
  await expect(page.getByTestId('book.start')).toBeEnabled()
  await expect(page.getByTestId('book.start')).toHaveText(en.book.start)
  await expect(page.getByTestId('book.addToCollection')).toBeEnabled()
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.remove')).toBeEnabled()
  await expect(page.getByTestId('bookOptions.changeEdition')).toBeDisabled()
  await expect(page.getByTestId('bookOptions.changeEdition')).toContainText(en.common.offline)
  await page.getByTestId('bookOptions.cancel').click()
  await expect(page.getByTestId('bookOptions')).toBeHidden()

  // Back online: Change edition is back, without a reload.
  await page.context().setOffline(false)
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.changeEdition')).toBeEnabled()
  await page.getByTestId('bookOptions.cancel').click()
  await expect(page.getByTestId('bookOptions')).toBeHidden()
  // The flow ends with nothing in flight, so the context closes on a page that has drawn.
  await page.waitForLoadState('networkidle', { timeout: 5_000 })
})

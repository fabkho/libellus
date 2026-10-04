import { expect, test, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'

/**
 * Offline (#15): the member loads her Library online, the device loses its
 * connection and the app is opened again. Her Library is still there (from
 * the device's copy), every action that writes is disabled and says
 * "Offline", and search finds her own Books with one quiet note. Back online,
 * the actions are back, a Book removed leaves the copy at once, and signing
 * out leaves no copy behind.
 *
 * The dev server has no service worker, so this flow plays its part: every
 * file of the app the page loaded online is kept and answers the same address
 * offline (`keepShell`). The real service worker and its precache are the
 * build's (nuxt.config.ts, pwa); docs/parity.md (Offline) says how that was
 * checked. Supabase is out of reach offline, as on a phone.
 *
 * Chromium, unlike the other flows: WebKit's driver cannot answer a page load
 * from a route while the context is offline ("WebKit encountered an internal
 * error"), and a reload without a connection is the point here.
 */
test.use({
  browserName: 'chromium',
  // A page the route answered has no address of its own, so Chromium's local
  // network checks would keep it from the local stack on 127.0.0.1. On a phone
  // the app and Supabase are both on the internet.
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
})

/** The service worker's part (see above). Returns how to go offline and back. */
async function keepShell(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  type Kept = { status: number; headers: Record<string, string>; body: Buffer }
  const shell = new Map<string, Kept>()
  // Any address opens the app, as the service worker's navigateFallback does.
  let appPage: Kept | undefined
  let offline = false
  await page.route(
    (url) => url.origin === origin,
    async (route) => {
      const request = route.request()
      if (offline) {
        const kept = shell.get(request.url()) ?? (request.isNavigationRequest() ? appPage : undefined)
        return kept ? route.fulfill(kept) : route.abort('internetdisconnected')
      }
      const response = await route.fetch()
      const kept = { status: response.status(), headers: response.headers(), body: await response.body() }
      if (request.method() === 'GET') shell.set(request.url(), kept)
      if (request.isNavigationRequest()) appPage = kept
      await route.fulfill(kept)
    },
  )
  return {
    async goOffline() {
      offline = true
      await page.context().setOffline(true)
    },
    async goOnline() {
      offline = false
      await page.context().setOffline(false)
    },
  }
}

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
    // Answered by the recorded cover (e2e/support.ts, recordedApple).
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Offline${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

test('the Library opens offline, nothing writes, and search finds her own books', async ({ page, baseURL }) => {
  await recordedApple(page)
  const network = await keepShell(page, baseURL!)
  const member = await signedIn(page)

  // Her Library: one Book on each Status.
  const library = createLibrary(member.client)
  const today = isoDay()
  await library.addToLibrary(book('Halls of Tide', 'Odile Marsh'))
  await library.addToLibrary(book('The Night Lamp', 'Pell Ravenscar'), { status: 'reading', startedOn: today })
  await library.addToLibrary(book('Winter Pages', 'Ilse Varga'), { status: 'finished', endedOn: today, rating: 18 })

  // Loaded online once: the Library, and a book page (so its code is on the device too).
  await page.goto('/library')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Halls of Tide'))
  await page.getByTestId('library.entry').click()
  await expect(page.getByTestId('book.start')).toHaveText(en.book.start)
  await page.goBack()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Halls of Tide'))

  // No connection, and the app opened again.
  await network.goOffline()
  await page.reload()

  // The Library as it was, from the device.
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Halls of Tide'))
  await expect(page.getByTestId('library.loadError')).toBeHidden()
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('The Night Lamp'))
  await expect(page.getByTestId('library.finish')).toBeDisabled()
  await expect(page.getByTestId('library.finish')).toHaveText(en.common.offline)
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Winter Pages'))
  await expect(page.getByTestId('library.entryRating')).toBeVisible()

  // Home, from the same copy: Update on the card (#68) is disabled too; the Book's progress itself stays shown.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('The Night Lamp'))
  await expect(page.getByTestId('home.update')).toBeDisabled()
  await expect(page.getByTestId('home.update')).toHaveText(en.common.offline)
  await expect(page.getByTestId('home.progressValue')).toHaveText(en.book.progress.none)

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

  // Her Book's page opens from the device's copy; its action is disabled.
  await page.getByTestId('search.query').fill('halls')
  await page.getByTestId('search.result').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Halls of Tide'))
  await expect(page.getByTestId('book.start')).toBeDisabled()
  await expect(page.getByTestId('book.start')).toHaveText(en.common.offline)
  await expect(page.getByTestId('book.addToCollection')).toBeDisabled()
  // Removing it from the Library (#11) as well.
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.remove')).toBeDisabled()
  await expect(page.getByTestId('bookOptions.remove')).toContainText(en.common.offline)
  await page.getByTestId('bookOptions.cancel').click()
  await expect(page.getByTestId('bookOptions')).toBeHidden()

  // Back online: the action is back, without a reload.
  await network.goOnline()
  await expect(page.getByTestId('book.start')).toBeEnabled()
  await expect(page.getByTestId('book.start')).toHaveText(en.book.start)

  // Removed from the Library (#11): the device's copy forgets it at once too.
  const savedTitles = () =>
    page.evaluate(() => {
      const lists = JSON.parse(localStorage.getItem('libellus.library') ?? '{}').data?.lists ?? {}
      return Object.values(lists).flat().map((entry) => (entry as { book: { title: string } }).book.title).sort()
    })
  expect(await savedTitles()).toContain(runTitle('Halls of Tide'))
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.remove').click()
  await page.getByTestId('removeEntry.confirm').click()
  await expect(page.getByTestId('book.title')).toBeHidden()
  await expect.poll(savedTitles).toEqual([runTitle('The Night Lamp'), runTitle('Winter Pages')])

  // Signing out leaves no copy of her Library on the device.
  await page.getByTestId('shell.tab.home').click()
  await page.getByTestId('shell.avatar').click()
  await page.getByTestId('shell.signOut').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('libellus.')))).toEqual([])
})

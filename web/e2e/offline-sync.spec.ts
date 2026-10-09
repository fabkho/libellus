import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { keepShell } from './offlineShell'
import { goto, openProfile, recordedApple, signedIn } from './support'

/**
 * Save offline, sync later (#93). The member updates her progress without a
 * connection: the card shows it at once, a quiet chip says it waits to sync, a
 * reload (still offline) keeps both, and once the connection is back it reaches
 * the database by itself and the chip goes. A change the database refuses on
 * sync (the read was ended on another device meanwhile) is undone on screen and
 * stays as a failure she can read and dismiss.
 *
 * Chromium with the files the page loaded kept for offline (`keepShell`), as in
 * offline.spec.ts.
 */
test.use({
  browserName: 'chromium',
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

function book(title: string, pageCount = 300): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Odile Marsh'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Sync${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

const readOf = (email: string, title: string) =>
  sql<{ outcome: string | null; progress_page: number | null; status: string }>(
    `select s.outcome::text, s.progress_page, e.status::text
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
       join auth.users u on u.id = e.member_id
      where u.email = $1 and b.title = $2
      order by s.created_at desc limit 1`,
    [email, runTitle(title)],
  )

const waiting = (count: number) => en.sync.chip.replace('{count}', String(count))

test('progress saved offline survives a reload and syncs once the connection is back', async ({ page, baseURL }) => {
  await recordedApple(page)
  const network = await keepShell(page, baseURL!)
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('The Tidal Clock'), { status: 'reading', startedOn: addDays(isoDay(), -2) })
  await goto(page, '/')
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('The Tidal Clock'))
  await expect(page.getByTestId('shell.sync')).toBeHidden()

  await network.goOffline()
  await page.reload()
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('The Tidal Clock'))

  // Update progress, offline: shown at once, and the chip says it waits.
  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.wheel').click()
  await page.getByTestId('progress.wheelInput').fill('64')
  await page.getByTestId('progress.wheelInput').press('Enter')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 64 of 300')
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))
  expect((await readOf(member.email, 'The Tidal Clock'))[0]!.progress_page).toBeNull()

  // Opened again, still offline: the change and the chip are still there.
  await page.reload()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 64 of 300')
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))
  // The sheet names what waits.
  await page.getByTestId('shell.sync').click()
  await expect(page.getByTestId('sync.waiting')).toContainText('1 change')
  await expect(page.getByTestId('sync.item')).toHaveCount(1)
  await expect(page.getByTestId('sync.item')).toContainText(en.sync.action.update_progress)
  await expect(page.getByTestId('sync.itemAbout')).toHaveText(runTitle('The Tidal Clock'))
  await page.getByTestId('sync.cancel').click()
  await expect(page.getByTestId('sync')).toBeHidden()

  // Back online: it syncs by itself, the chip goes, the card keeps the value.
  await network.goOnline()
  await expect(page.getByTestId('shell.sync')).toBeHidden()
  await expect.poll(async () => (await readOf(member.email, 'The Tidal Clock'))[0]!.progress_page).toBe(64)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 64 of 300')
})

/** Saves `page` as the progress of the Book on Home's card. */
async function saveProgress(page: import('@playwright/test').Page, value: number) {
  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.wheel').click()
  await page.getByTestId('progress.wheelInput').fill(String(value))
  await page.getByTestId('progress.wheelInput').press('Enter')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
}

const outboxDatabases = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).filter((name) => name === 'libellus'))

test('signing out with changes waiting asks first; offline only "Sign out anyway" is offered, and it drops them', async ({ page, baseURL }) => {
  await recordedApple(page)
  const network = await keepShell(page, baseURL!)
  // Through the screens: the sign-in page's code is then among the files kept, and it is where
  // signing out offline lands (an installed app has it from its service worker's precache).
  const member = await signedIn(page, { throughTheScreens: true })
  await createLibrary(member.client).addToLibrary(book('Salt Letters'), { status: 'reading', startedOn: isoDay() })
  // The Profile loaded once online, so it opens offline.
  await goto(page, '/profile')
  await expect(page.getByTestId('profile.signOut')).toBeVisible()
  await goto(page, '/')
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('Salt Letters'))

  await network.goOffline()
  await saveProgress(page, 40)
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))

  await openProfile(page)
  await page.getByTestId('profile.signOut').click()
  await expect(page.getByTestId('signOutUnsynced.title')).toHaveText(en.profile.signOutUnsynced.title.split(' | ')[0]!.replace('{count}', '1'))
  await expect(page.getByTestId('signOutUnsynced.text')).toHaveText(en.profile.signOutUnsynced.text.split(' | ')[0]!)
  // Offline there is nothing to sync with.
  await expect(page.getByTestId('signOutUnsynced.alternative')).toBeHidden()
  await expect(page.getByTestId('signOutUnsynced.confirm')).toHaveText(en.profile.signOutUnsynced.signOut)
  // Cancel keeps her signed in, with the change still waiting.
  await page.getByTestId('signOutUnsynced.cancel').click()
  await expect(page.getByTestId('signOutUnsynced')).toBeHidden()
  await expect(page.getByTestId('profile.signOut')).toBeVisible()
  expect(await outboxDatabases(page)).toEqual(['libellus'])

  // Sign out anyway: the change is gone with the device's copy, never sent.
  await page.getByTestId('profile.signOut').click()
  await page.getByTestId('signOutUnsynced.confirm').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect.poll(() => outboxDatabases(page)).toEqual([])
  await network.goOnline()
  expect((await readOf(member.email, 'Salt Letters'))[0]!.progress_page).toBeNull()
})

test('"Sync first" sends the waiting changes, then signs out; if they cannot go, it says so', async ({ page }) => {
  await recordedApple(page)
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Glass Orchard'), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('Glass Orchard'))

  // The connection is there but the server fails the sync call: the change keeps waiting.
  await page.route('**/rest/v1/rpc/sync_write', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'The server fell over.' }) }))
  await page.context().setOffline(true)
  await saveProgress(page, 72)
  await page.context().setOffline(false)
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))

  await openProfile(page)
  await page.getByTestId('profile.signOut').click()
  await expect(page.getByTestId('signOutUnsynced.alternative')).toHaveText(en.profile.signOutUnsynced.syncFirst)
  await page.getByTestId('signOutUnsynced.alternative').click()
  await expect(page.getByTestId('signOutUnsynced.error')).toHaveText(en.profile.signOutUnsynced.failed)
  await expect(page.getByTestId('signOutUnsynced')).toBeVisible()
  expect((await readOf(member.email, 'Glass Orchard'))[0]!.progress_page).toBeNull()

  // It gets through now: synced, then signed out.
  await page.unroute('**/rest/v1/rpc/sync_write')
  await page.getByTestId('signOutUnsynced.alternative').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect((await readOf(member.email, 'Glass Orchard'))[0]!.progress_page).toBe(72)
})

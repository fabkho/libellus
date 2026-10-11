import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { authUserExists, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { keepShell } from './offlineShell'
import { goto, recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Delete your account (#101), the connection's part: offline the Profile's row
 * is disabled and says "Offline" (deleting is online-only); a change still
 * waiting to sync is named in the Confirm and discarded with the account.
 * Chromium with the files the page loaded kept for offline (`keepShell`), as in
 * offline-sync.spec.ts.
 */
test.use({
  browserName: 'chromium',
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

const waitingBook = () => ({
  title: runTitle('Salt Letters'),
  authors: ['Odile Marsh'],
  isbn13: null,
  isbn10: null,
  pageCount: 300,
  year: 2020,
  language: 'en',
  publisher: TEST_PUBLISHER,
  description: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple' as const,
  appleId: uniqueAppleId(),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

test('offline the row is disabled and says so; a change still waiting is named, then discarded with the account', async ({ page, baseURL }) => {
  await recordedApple(page)
  const network = await keepShell(page, baseURL!)
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(waitingBook(), { status: 'reading', startedOn: addDays(isoDay(), -1) })
  await goto(page, '/profile')
  await expect(page.getByTestId('profile.delete')).toBeEnabled()
  await goto(page, '/')
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('Salt Letters'))

  // Offline: one change waits; the row cannot be used and says "Offline".
  await network.goOffline()
  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.wheel').click()
  await page.getByTestId('progress.wheelInput').fill('40')
  await page.getByTestId('progress.wheelInput').press('Enter')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('shell.sync')).toBeVisible()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.delete')).toBeDisabled()
  await expect(page.getByTestId('profile.delete')).toContainText(en.common.offline)

  // Back online, but the sync call fails on the server: the change keeps waiting. (An aborted
  // request is silence, which the app reads as still offline since #105, so the row would stay
  // disabled; a 500 is an answer that the outbox retries later.)
  await page.route('**/rest/v1/rpc/sync_write', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'The server fell over.' }) }),
  )
  // Back online: the Confirm names the waiting change, and deleting discards it.
  await network.goOnline()
  await expect(page.getByTestId('profile.delete')).toBeEnabled()
  await page.getByTestId('profile.delete').click()
  await expect(page.getByTestId('deleteAccount.text')).toHaveText(
    `${en.profile.deleteAccount.text} ${en.profile.deleteAccount.unsynced.split(' | ')[0]}`,
  )
  await page.getByTestId('deleteAccount.confirm').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByTestId('signIn.deleted')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).filter((name) => name === 'libellus'))).toEqual([])
  expect(await authUserExists(member.email)).toBe(false)
})

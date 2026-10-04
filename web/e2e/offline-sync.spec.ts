import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { keepShell } from './offlineShell'
import { goto, recordedApple, signedIn } from './support'

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

test('a change the database refuses on sync is undone and stays as a failure to dismiss', async ({ page, baseURL }) => {
  await recordedApple(page)
  const network = await keepShell(page, baseURL!)
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book('Lantern Year'), { status: 'reading', startedOn: addDays(isoDay(), -3) })
  await goto(page, '/library')
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Lantern Year'))

  // Finished offline: on Finished at once, waiting to sync.
  await network.goOffline()
  await page.getByTestId('library.finish').click()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Lantern Year'))

  // Meanwhile, on another device, she gave the read up.
  await library.abandon(added.data!.id, { endedOn: isoDay(), reason: 'Lost the thread.' })

  // Back online: the finish is refused (nothing is open to finish), the Library
  // shows what the database has, and the chip says what could not sync.
  await network.goOnline()
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(en.sync.chipFailed.replace('{count}', '1'))
  expect((await readOf(member.email, 'Lantern Year'))[0]!.outcome).toBe('abandoned')
  await page.getByTestId('library.filter.notFinished').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Lantern Year'))

  await page.getByTestId('shell.sync').click()
  await expect(page.getByTestId('sync.failure')).toHaveCount(1)
  await expect(page.getByTestId('sync.failureAbout')).toHaveText(runTitle('Lantern Year'))
  await expect(page.getByTestId('sync.failureText')).toHaveText(en.sync.failedItem.replace('{action}', en.sync.action.finish_reading))
  await expect(page.getByTestId('sync.failureReason')).toHaveText(en.library.error.not_reading)
  await page.getByTestId('sync.dismiss').click()
  await expect(page.getByTestId('sync.allSynced')).toHaveText(en.sync.allSynced)
  await page.getByTestId('sync.cancel').click()
  await expect(page.getByTestId('shell.sync')).toBeHidden()

  // Dismissed for good: a reload does not bring it back.
  await page.reload()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(runTitle('Lantern Year'))
  await expect(page.getByTestId('shell.sync')).toBeHidden()
})

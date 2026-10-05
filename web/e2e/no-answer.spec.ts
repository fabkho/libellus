import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { goto, recordedApple, signedIn } from './support'

/**
 * A connection that answers nothing (#105). The browser says it is online, the
 * backend's writes never come back. The member saves her progress: after a few
 * seconds without an answer the write is not reported as "Couldn't sync", it waits
 * in the outbox (the card shows it, the chip says it waits), and once the backend
 * answers again it syncs by itself.
 *
 * The write is a REST call the test routes to hang: the route never fulfils.
 * Reads and the reachability probe still go through, as on a bad connection that
 * lets some things in.
 */
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
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Silent${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

const progressOf = async (email: string, title: string) =>
  (
    await sql<{ progress_page: number | null }>(
      `select s.progress_page
         from public.reading_sessions s
         join public.library_entries e on e.id = s.entry_id
         join public.books b on b.id = e.book_id
         join auth.users u on u.id = e.member_id
        where u.email = $1 and b.title = $2
        order by s.created_at desc limit 1`,
      [email, runTitle(title)],
    )
  )[0]!.progress_page

const waiting = (count: number) => en.sync.chip.replace('{count}', String(count))

test('a write the backend never answers waits in the outbox, and syncs once it answers', async ({ page }) => {
  test.setTimeout(120_000)
  await recordedApple(page)
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('The Quiet Line'), { status: 'reading', startedOn: addDays(isoDay(), -2) })
  await goto(page, '/')
  await expect(page.getByTestId('home.entryTitle')).toHaveText(runTitle('The Quiet Line'))
  await expect(page.getByTestId('shell.sync')).toBeHidden()

  // The progress write and the sync that would follow it both hang.
  const writes = '**/rest/v1/rpc/{update_progress,sync_write}'
  await page.route(writes, () => {
    // Never fulfilled, never continued, never aborted: silence.
  })

  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.wheel').click()
  await page.getByTestId('progress.wheelInput').fill('64')
  await page.getByTestId('progress.wheelInput').press('Enter')
  await page.getByTestId('progress.action').click()

  // After the write timeout it is queued: the card has it, the chip says it waits, nothing says it failed.
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1), { timeout: 30_000 })
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 64 of 300')
  await expect(page.getByText(en.sync.chipFailed.replace('({count})', '').trim())).toHaveCount(0)
  expect(await progressOf(member.email, 'The Quiet Line')).toBeNull()

  // Still no answer: it keeps waiting, and the card keeps the value.
  await page.waitForTimeout(3_000)
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))
  expect(await progressOf(member.email, 'The Quiet Line')).toBeNull()

  // The backend answers again: it syncs by itself.
  await page.unroute(writes)
  await expect(page.getByTestId('shell.sync')).toBeHidden({ timeout: 60_000 })
  await expect.poll(() => progressOf(member.email, 'The Quiet Line')).toBe(64)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 64 of 300')
})

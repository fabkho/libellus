import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { UPGRADE_LISTS_KEY } from '../app/utils/coverUpgradeList'
import { signUpMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, signedIn } from './support'

/**
 * The import runs on the server (proposal #329, docs/parity.md "The import as a server job"): the member picks the file, the app reads it
 * on the device and sends its books up, and from then on the page and the pill show the JOB: waiting in line, looking the books up,
 * finding covers, adding them, done, or stopped (and tried again). Live over Realtime, no reload, no polling. The flows play the
 * runner (the `import-job` edge function) with SQL: the stack has no function kicked, so the job waits in line until a flow moves it.
 */

// One queue for the whole database: the flows take turns.
test.describe.configure({ mode: 'serial' })

const FILE = readFileSync(new URL('../tests/fixtures/goodreads/library_export.csv', import.meta.url))
const words = (plural: string, index: number) => plural.split(' | ')[index]!

/** Somebody else's import is running: a row that has the slot and whose last beat is far ahead, so it never expires during the flow. */
async function someoneElseRuns() {
  // The queue is one for the whole database: nothing of an earlier flow is in line.
  await sql('delete from public.import_queue')
  const other = await signUpMember()
  await sql(
    `insert into public.import_queue (member_id, holder, rows, done, started_at, beat_at)
     values ($1, 'device:someone-else-0001', 200, 0, now(), now() + interval '1 hour')`,
    [other.id],
  )
  return other
}

async function chooseTheFile(page: Page) {
  await page.goto('/import')
  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
}

/** The job of this member, and what the "runner" does to it. */
const jobOf = async (memberId: string) => (await sql<{ id: string; total: number; state: string }>('select id, total, state from public.import_jobs where member_id = $1 order by created_at desc limit 1', [memberId]))[0]!
async function runnerSets(jobId: string, set: string) {
  await sql(`update public.import_jobs set ${set} where id = $1`, [jobId])
}

test.afterEach(async () => {
  await sql(`delete from public.import_queue where holder = 'device:someone-else-0001'`)
})

test('she picks a file and watches the server: in line, looking up, covers, adding, done: live, with no review step', async ({ page }) => {
  const member = await signedIn(page)
  const other = await someoneElseRuns()
  await chooseTheFile(page)

  // In line behind the other import: the job's own words, and what to do meanwhile.
  const running = page.getByTestId('import.running')
  await expect(running).toBeVisible()
  await expect(running).toHaveAttribute('data-kind', 'queued')
  await expect(page.getByTestId('import.progress.label')).toHaveText(words(en.import.ambient.queued, 1))
  await expect(running).toContainText(en.import.serverNote)
  // Nothing to review, nothing to choose: there is no preview at all.
  for (const gone of ['import.preview', 'import.start', 'import.attention', 'import.matched', 'import.finishNow', 'import.another'])
    await expect(page.getByTestId(gone)).toHaveCount(0)
  const job = await jobOf(member.id)
  expect(job.state).toBe('queued')
  // One polite status says the phase, and not the counts.
  await expect(page.getByTestId('import.say')).toHaveText(en.import.ambient.say.queued)

  // It is the server's turn: the page follows over Realtime, without a reload.
  await sql('delete from public.import_queue where member_id = $1', [other.id])
  await runnerSets(job.id, `state = 'running', done = 3`)
  await expect(running).toHaveAttribute('data-kind', 'matching')
  await expect(page.getByTestId('import.progress.label')).toHaveText(en.import.ambient.matching.replace('{done}', '3').replace('{total}', String(job.total)))
  await expect(page.getByTestId('import.say')).toHaveText(en.import.ambient.say.matching)
  await expectAccessible(page, 'import running')

  // Away from the page: the pill says the same.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'matching')
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.matching.replace('{done}', '3').replace('{total}', String(job.total)))
  await runnerSets(job.id, `done = ${job.total}, cover_edition = 1, cover_none = 1`)
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'covers')
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.covers.replace('{done}', '2').replace('{total}', String(job.total)))
  await runnerSets(job.id, `cover_edition = ${job.total}, cover_none = 0, added = 4`)
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'writing')
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.writing.replace('{done}', '4').replace('{total}', String(job.total)))

  // Done: what was added, with what was there already and what failed when there is some.
  await runnerSets(job.id, `state = 'done', finished_at = now(), added = ${job.total - 2}, kept = 1, failed = 1`)
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'done')
  await expect(page.getByTestId('shell.import.label')).toHaveText(
    `${words(en.import.ambient.done, 2).replace('{count}', String(job.total - 2))} · ${en.import.ambient.doneKept.replace('{count}', '1')} · ${en.import.ambient.doneFailed.replace('{count}', '1')}`,
  )
  await page.getByTestId('shell.import.open').click()
  await expect(page.getByTestId('import.done')).toBeVisible()
  await expect(page.getByTestId('import.added')).toContainText(String(job.total - 2))
  await expect(page.getByTestId('import.failedCount')).toContainText('1')
  await expect(page.getByTestId('import.toLibrary')).toBeVisible()
  await expect(page.getByTestId('shell.import')).toHaveCount(0)
})

test('the pill is back after the app is closed and opened again: the job went on without it, and its end is told once', async ({ page }) => {
  const member = await signedIn(page)
  await chooseTheFile(page)
  await expect(page.getByTestId('import.running')).toBeVisible()
  const job = await jobOf(member.id)

  // The app is closed (a reload) while the job runs on the server.
  await page.getByTestId('shell.tab.library').click()
  await runnerSets(job.id, `state = 'running', done = 2`)
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'matching')
  await page.reload()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'matching')
  // The one read at start, then the socket: it goes on live.
  await runnerSets(job.id, `done = 5`)
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.matching.replace('{done}', '5').replace('{total}', String(job.total)))

  // It ends while the app is closed.
  await runnerSets(job.id, `state = 'done', finished_at = now(), added = 4`)
  await sql(`delete from public.import_queue where holder = 'job:' || $1`, [job.id])
  await page.reload()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'done')
  await page.getByTestId('shell.import.dismiss').click()
  await expect(page.getByTestId('shell.import')).toHaveCount(0)
  // Seen: not told again.
  await page.reload()
    await expect(page.getByTestId('shell.import')).toHaveCount(0)
})

test('another start within two minutes says so; cancelling stops the job', async ({ page }) => {
  const member = await signedIn(page)
  await chooseTheFile(page)
  await expect(page.getByTestId('import.running')).toBeVisible()

  await page.getByTestId('import.cancel').click()
  await page.getByTestId('import.cancelConfirm.confirm').click()
  await expect(page.getByTestId('import.choose')).toBeVisible()
  expect((await jobOf(member.id)).state).toBe('cancelled')

  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
  await expect(page.getByTestId('import.startError')).toHaveText(en.import.startError.import_too_soon)
  await expect(page.getByTestId('import.startError')).toHaveAttribute('data-code', 'import_too_soon')
})

test('a job that stopped is tried again from its own rows, with no file', async ({ page }) => {
  const member = await signedIn(page)
  await chooseTheFile(page)
  await expect(page.getByTestId('import.running')).toBeVisible()
  const job = await jobOf(member.id)

  // The server gave up (long ago enough for another start).
  await sql(`update public.import_jobs set state = 'failed', error = 'stalled', finished_at = now(), created_at = created_at - interval '1 hour' where id = $1`, [job.id])
  await sql(`delete from public.import_queue where holder = 'job:' || $1`, [job.id])
  await expect(page.getByTestId('import.failedJob')).toBeVisible()
  await expect(page.getByTestId('import.failedTitle')).toHaveText(en.import.failedTitle)
  await expect(page.getByTestId('import.say')).toHaveText(en.import.ambient.say.failed)
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'failed')
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.failed)
  await page.getByTestId('shell.import.open').click()

  await page.getByTestId('import.retry').click()
  await expect(page.getByTestId('import.running')).toBeVisible()
  const again = await jobOf(member.id)
  expect(again.id).not.toBe(job.id)
  expect(again.total).toBe(job.total)
})

test('when the job is done, the one-time Apple cover upgrade lists the books it added, and only those', async ({ page }) => {
  // Apple is not asked here: the list waits on the device, as it does when Apple refuses.
  await page.route('**/itunes.apple.com/**', (route) => route.abort())
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const book = (title: string): BookSnapshot => ({
    title: runTitle(title), authors: ['A. Author'], isbn13: null, isbn10: null, pageCount: null, year: null, language: null,
    publisher: TEST_PUBLISHER, description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'apple',
    appleId: uniqueAppleId(), openLibraryEditionKey: null, openLibraryWorkKey: null,
  })
  const added = (await library.addToLibrary(book('Added by the import'))).data!
  const held = (await library.addToLibrary(book('Held before the import'))).data!

  await chooseTheFile(page)
  await expect(page.getByTestId('import.running')).toBeVisible()
  const job = await jobOf(member.id)
  await sql(`update public.import_job_rows set state = 'done', outcome = 'added', entry_id = $2 where job_id = $1 and idx = 0`, [job.id, added.id])
  await sql(`update public.import_job_rows set state = 'done', outcome = 'in_library', entry_id = $2 where job_id = $1 and idx = 1`, [job.id, held.id])
  await runnerSets(job.id, `state = 'done', finished_at = now(), added = 1, kept = 1`)
  await expect(page.getByTestId('import.done')).toBeVisible()

  const lists = async () =>
    page.evaluate((key) => {
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as { members?: Record<string, { id: string; rows: { bookId: string }[] }[]> }
      return Object.values(all.members ?? {}).flat()
    }, UPGRADE_LISTS_KEY)
  await expect.poll(async () => (await lists()).map((list) => list.id)).toEqual([`import-${job.id}`])
  const [list] = await lists()
  expect(list!.rows.map((row) => row.bookId)).toEqual([added.book.id])
})

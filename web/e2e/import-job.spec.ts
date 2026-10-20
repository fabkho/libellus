import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { UPGRADE_LISTS_KEY } from '../app/utils/coverUpgradeList'
import { signUpMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, goto, signedIn } from './support'

/**
 * The import runs on the server (proposal #329, docs/parity.md "The import as a server job"): the member picks the file, the app reads it
 * on the device and sends its books up, and from then on the page and the pill show the JOB: waiting in line, looking the books up,
 * finding covers, adding them, done, or stopped (and tried again). Live over Realtime, no reload, no polling (one fallback: a read when
 * the socket said nothing for 30 s while the job is live, for a socket that is open but deaf). The flows play the
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
  await goto(page, '/import')
  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
}

/** The job of this member, and what the "runner" does to it. */
const jobOf = async (memberId: string) => (await sql<{ id: string; total: number; state: string }>('select id, total, state from public.import_jobs where member_id = $1 order by created_at desc limit 1', [memberId]))[0]!
async function runnerSets(jobId: string, set: string) {
  await sql(`update public.import_jobs set ${set} where id = $1`, [jobId])
}

/** The job is over and out of the line, so the next flow's job is not behind it. */
async function runnerEnds(jobId: string) {
  await runnerSets(jobId, `state = 'done', finished_at = now()`)
  await sql(`delete from public.import_queue where holder = 'job:' || $1`, [jobId])
}

/**
 * Realtime as a project whose Realtime was idle served it (20 October 2026): Playwright stands between the page and the stack's
 * socket. The join is answered at once, but the server's `postgres_changes` do not reach the page while `deaf`, and with
 * `holdSystem` its word that her changes are subscribed (`system`, "Subscribed to PostgreSQL") is kept back until `release()`.
 * `sockets` counts the sockets the page opened (a reconnect is one more), `missed` the changes that did not reach it; `joinedAt` is
 * when the join of her channel was answered.
 */
async function realtimeBetween(page: Page, { holdSystem = false } = {}) {
  const gate = { sockets: 0, deaf: true, holdSystem, held: [] as string[], subscribed: 0, missed: 0, joinedAt: null as number | null, release: () => {} }
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    gate.sockets++
    const server = ws.connectToServer()
    // What the page sends goes on untouched; what the server sends is looked at (Phoenix v2: [join_ref, ref, topic, event, payload]).
    server.onMessage((message) => {
      let event: unknown = null
      let topic: unknown = null
      if (typeof message === 'string') {
        try {
          const frame = JSON.parse(message) as unknown[]
          topic = frame[2]
          event = frame[3]
        } catch {}
      }
      if (event === 'postgres_changes' && gate.deaf) return void gate.missed++
      if (event === 'system' && typeof message === 'string') {
        if (gate.holdSystem) return void gate.held.push(message)
        gate.subscribed++
      }
      ws.send(message)
      if (event === 'phx_reply' && typeof topic === 'string' && topic.startsWith('realtime:import-job:')) gate.joinedAt ??= Date.now()
    })
    gate.release = () => {
      gate.deaf = false
      gate.holdSystem = false
      for (const message of gate.held.splice(0)) {
        gate.subscribed++
        ws.send(message)
      }
    }
  })
  return gate
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

test('the job moves in the moment between the join and the server subscribing her changes: the page reads it then (it stayed on "Starting soon")', async ({ page }) => {
  // 20 October 2026, production: the join's read saw the job queued, the job went running 0.6 s later, before the server had her
  // changes subscribed, and that change was never pushed. Here the server's word that it is subscribed is held back meanwhile.
  const realtime = await realtimeBetween(page, { holdSystem: true })
  // When the page read her job (each read is the job's one row).
  const reads: number[] = []
  page.on('response', (response) => {
    if (response.url().includes('/rest/v1/import_jobs?')) reads.push(Date.now())
  })
  const member = await signedIn(page)
  await chooseTheFile(page)
  const running = page.getByTestId('import.running')
  await expect(running).toHaveAttribute('data-kind', 'queued')
  const job = await jobOf(member.id)
  // Joined, and the join's read made (it saw the job queued); the server is still setting her changes up: the runner starts the job now.
  await expect.poll(() => realtime.joinedAt !== null && reads.some((at) => at >= realtime.joinedAt!)).toBe(true)
  await expect.poll(() => realtime.held.length).toBeGreaterThan(0)
  await runnerSets(job.id, `state = 'running', done = 3`)
  await expect.poll(() => realtime.missed).toBeGreaterThan(0)

  // The server says her changes are subscribed: the page reads the job once and shows it as it is.
  realtime.release()
  const label = page.getByTestId('import.progress.label')
  await expect(running).toHaveAttribute('data-kind', 'matching')
  await expect(label).toHaveText(en.import.ambient.matching.replace('{done}', '3').replace('{total}', String(job.total)))
  // Live from then on, on the same socket.
  await runnerSets(job.id, `done = 5`)
  await expect(label).toHaveText(en.import.ambient.matching.replace('{done}', '5').replace('{total}', String(job.total)))
  expect(realtime.sockets).toBe(1)
  await runnerEnds(job.id)
})

test('a socket that is open but deaf: after 30 s with no word the page reads the job once (the silence net, not a poll)', async ({ page }) => {
  // The page's own clock, so the 30 s pass at once (time otherwise runs as it does).
  await page.clock.install()
  const realtime = await realtimeBetween(page)
  const member = await signedIn(page)
  await chooseTheFile(page)
  const running = page.getByTestId('import.running')
  await expect(running).toHaveAttribute('data-kind', 'queued')
  const job = await jobOf(member.id)
  await expect.poll(() => realtime.subscribed).toBeGreaterThan(0)

  // The server runs the job; none of it reaches the page.
  await runnerSets(job.id, `state = 'running', done = 3`)
  await expect.poll(() => realtime.missed).toBeGreaterThan(0)
  await page.clock.fastForward('00:10')
  await expect(running).toHaveAttribute('data-kind', 'queued')
  // 30 s of silence: one read.
  await page.clock.fastForward('00:21')
  await expect(running).toHaveAttribute('data-kind', 'matching')
  await expect(page.getByTestId('import.progress.label')).toHaveText(en.import.ambient.matching.replace('{done}', '3').replace('{total}', String(job.total)))
  // It was the net's read, not a reconnect.
  expect(realtime.sockets).toBe(1)
  await runnerEnds(job.id)
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

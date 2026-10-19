import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { signUpMember } from '../tests/support/member'
import { openLibraryAnswer } from '../tests/support/openLibrary'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn } from './support'

/**
 * One import looks its books up at a time, across all members (data/importQueue.ts, the `import_queue` table,
 * docs/parity.md "One import at a time"). Another member's import has the slot: this one's lookups wait in
 * line, the screen says how many are ahead and a rough wait, and they start by themselves when the slot is
 * free; "Leave the line" gives the place up. The sources answer from the recordings (e2e/support.ts).
 */

// The slot is one for the whole database: the two flows take turns.
test.describe.configure({ mode: 'serial' })

const FILE = readFileSync(new URL('../tests/fixtures/goodreads/library_export.csv', import.meta.url))

/** Somebody else's import is running: a row that has the slot and whose last beat is far ahead, so it never expires during the flow. */
async function someoneElseRuns() {
  await sql(`delete from public.import_queue where holder = 'device:someone-else-0001'`)
  const other = await signUpMember()
  await sql(
    `insert into public.import_queue (member_id, holder, rows, done, started_at, beat_at)
     values ($1, 'device:someone-else-0001', 200, 0, now(), now() + interval '1 hour')`,
    [other.id],
  )
  return other
}

async function chooseTheFile(page: import('@playwright/test').Page) {
  await page.goto('/import')
  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
}

// The slot is the database's, not the test's: nobody's place is left for the next flow.
test.afterEach(async () => {
  await sql(`delete from public.import_queue where holder = 'device:someone-else-0001'`)
})

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // The `openlibrary` function (the import's way to Open Library) answers from the same recordings as Open Library itself.
  await page.route('**/functions/v1/openlibrary?*', (route) => {
    const asked = new URL(route.request().url())
    const target = new URL(`https://openlibrary.org${asked.searchParams.get('path')}`)
    for (const [name, value] of asked.searchParams) if (name !== 'path') target.searchParams.append(name, value)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' },
      body: JSON.stringify(openLibraryAnswer(target)),
    })
  })
})

test('another import has the slot: the lookups wait in line and start by themselves when it is free', async ({ page }) => {
  // The lookups of a file take a while on the recordings, behind the five-second poll.
  test.slow()
  const member = await signedIn(page)
  const other = await someoneElseRuns()
  await chooseTheFile(page)

  // In line: one import ahead (200 books, about 3 minutes), nothing is looked up yet.
  await expect(page.getByTestId('import.queued')).toBeVisible()
  await expect(page.getByTestId('import.queued.label')).toHaveText(en.import.queueAhead.split(' | ')[1]!)
  await expect(page.getByTestId('import.queued.wait')).toHaveText(en.import.queueWait.split(' | ')[2]!.replace('{count}', '3'))
  await expect(page.getByTestId('import.matching')).toHaveCount(0)
  await expect(page.getByTestId('import.cancel')).toHaveText(en.import.queueLeave)
  const mine = await sql<{ started_at: string | null }>('select started_at from public.import_queue where member_id = $1', [member.id])
  expect(mine).toHaveLength(1)
  expect(mine[0]!.started_at).toBeNull()

  // The other import ends: this one starts by itself (the next poll, within a few seconds), looks its books up and reaches the preview.
  await sql('delete from public.import_queue where member_id = $1', [other.id])
  await expect(page.getByTestId('import.queued')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByTestId('import.matching')).toBeVisible()
  // While it looks up, the slot is hers.
  const holding = await sql('select 1 from public.import_queue where member_id = $1 and started_at is not null', [member.id])
  expect(holding).toHaveLength(1)
  await expect(page.getByTestId('import.start')).toBeVisible({ timeout: 45_000 })
  // The slot is given up on reaching the preview.
  await expect.poll(async () => (await sql('select 1 from public.import_queue where member_id = $1', [member.id])).length).toBe(0)
})

test('leaving the line gives the place up and leaves the other import running', async ({ page }) => {
  const member = await signedIn(page)
  const other = await someoneElseRuns()
  await chooseTheFile(page)
  await expect(page.getByTestId('import.queued')).toBeVisible()

  await page.getByTestId('import.cancel').click()
  await expect(page.getByTestId('import.choose')).toBeVisible()
  await expect.poll(async () => (await sql('select 1 from public.import_queue where member_id = $1', [member.id])).length).toBe(0)
  const running = await sql('select 1 from public.import_queue where member_id = $1 and started_at is not null', [other.id])
  expect(running).toHaveLength(1)
})

test('the import shows on the other screens, and a closed app picks it up where it was', async ({ page }) => {
  test.slow()
  const member = await signedIn(page)
  const other = await someoneElseRuns()
  await chooseTheFile(page)
  await expect(page.getByTestId('import.queued')).toBeVisible()

  // Away from the import page: a small pill says where it stands, and a tap goes back to it.
  await page.getByTestId('shell.tab.library').click()
  const pill = page.getByTestId('shell.import')
  await expect(pill).toHaveAttribute('data-kind', 'queued')
  await expect(page.getByTestId('shell.import.label')).toHaveText(en.import.ambient.queued.replace('{count}', '1'))
  await page.getByTestId('shell.import.open').click()
  await expect(page).toHaveURL(/\/import$/)
  await expect(page.getByTestId('import.queued')).toBeVisible()
  // On its own page the pill gives way to the page's own words.
  await expect(pill).toHaveCount(0)

  // The app is closed (a reload) while it waits: the file was kept, so on the next start it takes its place again, without a file chosen.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library$/)
  await page.reload()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'queued')

  // The app is closed for good while it HAS the slot: the old run's place stays in the database (a dead holder, its beat fresh).
  // Opened again on the same device it takes that place back at once, it does not wait 75 s and is never "on another device".
  await sql('delete from public.import_queue where member_id = $1', [other.id])
  await sql(`update public.import_queue set holder = 'device:closed-app-0001', started_at = now(), beat_at = now() where member_id = $1`, [member.id])
  const device = await page.evaluate(() => localStorage.getItem('libellus.import-device'))
  expect(device).toMatch(/^dev-/)
  expect((await sql<{ device: string }>('select device from public.import_queue where member_id = $1', [member.id]))[0]!.device).toBe(device)
  await page.reload()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', /matching|covers|ready/, { timeout: 10_000 })
  const taken = await sql<{ holder: string }>('select holder from public.import_queue where member_id = $1', [member.id])
  // Either still looking up (its place, now the new run's) or already done with it: never the dead run's.
  expect(taken.every((row) => row.holder !== 'device:closed-app-0001')).toBe(true)

  // The lookups run and the preview waits: "ready to check".
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', /matching|covers|ready/, { timeout: 15_000 })
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', /ready|covers/, { timeout: 45_000 })
  // Nothing of the file is kept once the lookups are over.
  await expect.poll(async () => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('libellus')
    open.onsuccess = () => {
      const db = open.result
      const count = db.transaction('importFiles').objectStore('importFiles').count()
      count.onsuccess = () => resolve(count.result)
    }
  }))).toBe(0)

  // Import it from the page; leaving it for another screen shows "done", and a tap opens the summary.
  await page.getByTestId('shell.import.open').click()
  await page.getByTestId('import.start').click()
  await expect(page.getByTestId('import.done')).toBeVisible({ timeout: 45_000 })
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('shell.import')).toHaveAttribute('data-kind', 'done')
  await expect(page.getByTestId('shell.import.label')).toContainText(/Import done/)
  await page.getByTestId('shell.import.dismiss').click()
  await expect(page.getByTestId('shell.import')).toHaveCount(0)
  expect(member.id).toBeTruthy()
})

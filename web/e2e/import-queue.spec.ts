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

import { expect } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { signedIn } from './support'

/**
 * The client error log: an error the app meets on the device reaches the
 * database's own log (`log_client_error` → `private.client_errors`) with
 * technical details only. The dev server sends only when asked
 * (composables/useErrorLog.ts, `libellus-dev:error-log`); this flow asks, makes
 * one error of every kind on purpose (plugins/error-log.client.ts, the dev
 * trigger: a real uncaught exception, a real rejected promise, a real missing
 * chunk) and finds each in the member's rows, path only, the device described
 * in a few words. The member's rows go with her when the run's teardown deletes her.
 */

type Row = { kind: string; message: string; stack: string | null; route: string | null; user_agent: string | null; app_version: string | null; online: boolean | null }

const rowsOf = (memberId: string) =>
  sql<Row>(
    `select kind, message, stack, route, user_agent, app_version, online from private.client_errors
      where user_id = $1 order by id`,
    [memberId],
  )

test('an error on the device lands in the error log, without the address query', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('libellus-dev:error-log', 'send'))
  const member = await signedIn(page)
  // A query that must not travel with the report.
  await page.goto('/library?q=secret')
  await expect(page.getByTestId('shell.avatar')).toBeVisible()

  const kinds = ['error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf'] as const
  const tags: Record<string, string> = {}
  for (const kind of kinds) {
    tags[kind] = await page.evaluate((k) => (window as unknown as { __libellusErrors: { trigger(k: string): string } }).__libellusErrors.trigger(k), kind)
  }
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
  await page.evaluate(() => (window as unknown as { __libellusErrors: { flush(): Promise<void> } }).__libellusErrors.flush())

  // Only the kinds this flow triggers: a poor Web Vital the run itself causes may land too (kind 'vitals').
  await expect
    .poll(async () => (await rowsOf(member.id)).map((row) => row.kind).filter((kind) => kind !== 'vitals').sort(), { timeout: 15_000 })
    .toEqual([...kinds].sort())
  const rows = await rowsOf(member.id)
  for (const kind of ['error', 'unhandledrejection', 'vue', 'outbox', 'shelf']) {
    expect(rows.find((row) => row.kind === kind)?.message).toContain(tags[kind])
  }
  // The missing chunk is the browser's own words, whichever way it arrived.
  expect(rows.find((row) => row.kind === 'chunk')?.message).toMatch(/import|module/i)
  for (const row of rows) {
    expect(row.route).toBe('/library')
    expect(row.online).toBe(true)
    expect(row.app_version).toBeTruthy()
    expect(row.user_agent).toMatch(/Safari|WebKit/)
    expect(`${row.message} ${row.stack ?? ''}`).not.toContain('secret')
  }
})

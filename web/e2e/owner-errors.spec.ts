import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createOwnerErrors } from '../app/data/ownerErrors'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID, shelfOwner } from './shelfOwner'
import { signedIn, signedInAs, untilStill } from './support'

/**
 * The owner reads the client error log in the app (docs/OPERATIONS.md, Client
 * errors): Profile → Account → Errors, the last 7 days grouped, a stack per
 * group. The owner is the member the build names (NUXT_PUBLIC_SHELF_OWNER_ID,
 * the flows' shelf owner) and the database names her as the instance's owner
 * (`private.instance_owner`), restored after the flows. Anyone else has no row,
 * no address and no request for the log, and the database refuses her too.
 * With docs/parity.md (Errors) this is the behavioural reference.
 */

type Errors = { trigger(kind: string): string; flush(): Promise<void> }

// The instance's owner row is one for the whole database: these flows take it in turns.
test.describe.configure({ mode: 'serial' })

let namedBefore: string | null = null
test.beforeAll(async () => {
  namedBefore = (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null
  await shelfOwner()
  await sql('update private.instance_owner set owner_id = $1', [SHELF_OWNER_ID])
})
test.afterAll(async () => {
  await sql('update private.instance_owner set owner_id = $1', [namedBefore])
})

const SHELF_FILE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

/**
 * Signs the owner in (she exists; her session handed to the page, e2e/support.ts). In a build with
 * Regal her Profile shows Your shelf, which asks for the published library file: answered from the fixture.
 */
async function signInAsOwner(page: Page) {
  await page.route(SHELF_LIBRARY_SRC, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: SHELF_FILE }),
  )
  const owner = await shelfOwner()
  await signedInAs(page, owner.email)
  return owner
}

test('the owner sees an error on purpose in the log: grouped, filtered, its stack, copied', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('libellus-dev:error-log', 'send'))
  await signInAsOwner(page)
  await page.goto('/library')
  await expect(page.getByTestId('shell.avatar')).toBeVisible()

  // Two errors of two kinds, on purpose (the dev trigger: real exceptions, reported by the real plugin).
  const boom = await page.evaluate(() => (window as unknown as { __libellusErrors: Errors }).__libellusErrors.trigger('error'))
  const vue = await page.evaluate(() => (window as unknown as { __libellusErrors: Errors }).__libellusErrors.trigger('vue'))
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
  await page.evaluate(() => (window as unknown as { __libellusErrors: Errors }).__libellusErrors.flush())
  await expect.poll(async () => (await sql('select 1 from private.client_errors where message = $1', [boom])).length, { timeout: 15_000 }).toBe(1)

  // Profile → Account → Errors, with how many groups are new.
  await page.goto('/profile')
  await expect(page.getByTestId('profile.errors')).toBeVisible()
  await expect(page.getByTestId('profile.errorsNew')).toBeVisible()
  expect(Number(await page.getByTestId('profile.errorsNew').textContent())).toBeGreaterThanOrEqual(2)
  await page.getByTestId('profile.errors').click()
  await expect(page).toHaveURL(/\/profile\/errors\/?$/)
  await expect(page.getByTestId('errors.title')).toHaveText(en.ownerErrors.title)

  const group = (message: string) => page.getByTestId('errors.group').filter({ hasText: message })
  await expect(group(boom)).toBeVisible()
  await expect(group(vue)).toBeVisible()
  await expect(group(boom).getByTestId('errors.groupKind')).toHaveText(en.ownerErrors.kind.error)
  await expect(group(boom).getByTestId('errors.groupNew')).toHaveText(en.ownerErrors.new)
  await expect(group(boom).getByTestId('errors.groupTimes')).toHaveText('×1')
  await expect(group(boom).getByTestId('errors.groupMeta')).toContainText('/library')

  // The filter: Vue only.
  await page.getByTestId('errors.kind.vue').click()
  await expect(group(vue)).toBeVisible()
  await expect(group(boom)).toHaveCount(0)
  await page.getByTestId('errors.kind.all').click()
  await expect(group(boom)).toBeVisible()

  // Its latest stack, in a sheet; Copy says so.
  await group(boom).click()
  await expect(page.getByTestId('errorDetail.sheetTitle')).toHaveText(en.ownerErrors.kind.error)
  await expect(page.getByTestId('errorDetail.message')).toHaveText(boom)
  // Where it was thrown: the source file on the dev server, the built chunk in a build.
  await expect(page.getByTestId('errorDetail.stack')).toContainText(/error-log\.client\.ts|\/_nuxt\/[\w-]+\.js/)
  await expect(page.getByTestId('errorDetail.members')).toContainText('1')
  await untilStill(page)
  await page.getByTestId('errorDetail.action').click()
  await expect(page.getByTestId('errorDetail.action')).toHaveText(en.ownerErrors.detail.copied)
  await page.getByTestId('errorDetail.cancel').click()
  await expect(page.getByTestId('errorDetail')).toBeHidden()

  // Refresh asks again and keeps the groups.
  const asked = page.waitForRequest((request) => request.url().includes('/rpc/owner_client_errors'))
  await page.getByTestId('errors.refresh').click()
  await asked
  await expect(group(boom)).toBeVisible()
})

test('nothing in the last 7 days: the empty state', async ({ page }) => {
  await signInAsOwner(page)
  await page.route('**/rest/v1/rpc/owner_client_errors', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
  )
  await page.goto('/profile/errors')
  await expect(page.getByTestId('errors.emptyTitle')).toHaveText(en.ownerErrors.empty.title)
  await expect(page.getByTestId('errors.empty')).toHaveText(en.ownerErrors.empty.text)
  await expect(page.getByTestId('errors.group')).toHaveCount(0)
})

test('the log cannot be loaded: it says so and tries again', async ({ page }) => {
  await signInAsOwner(page)
  let failing = true
  await page.route('**/rest/v1/rpc/owner_client_errors', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
  )
  await page.goto('/profile/errors')
  await expect(page.getByTestId('errors.loadFailed')).toContainText(en.ownerErrors.loadError)
  failing = false
  await page.getByTestId('errors.retry').click()
  await expect(page.getByTestId('errors.emptyTitle')).toBeVisible()
})

// Nuxt's own page for an address that doesn't exist is not a Libellus screen (its link home has no test ID).
const anyone = test.extend<{ everyControlHasATestId: void }>({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

anyone('nobody else has the log: no row, no address, no request, and the database refuses her', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('owner_client_error')) asked.push(request.url())
  })
  const member = await signedIn(page)
  await page.goto('/profile')
  await expect(page.getByTestId('profile.account')).toBeVisible()
  await expect(page.getByTestId('profile.links')).toBeVisible()
  await expect(page.getByTestId('profile.errors')).toHaveCount(0)

  // The address is a page that doesn't exist, like any other unknown one.
  await page.goto('/profile/errors')
  await expect(page.getByText('404').first()).toBeVisible()
  await expect(page.getByTestId('errors.title')).toHaveCount(0)
  expect(asked).toEqual([])

  // And were she to ask the database herself, it says no.
  const own = createOwnerErrors(member.client)
  expect(await own.list()).toEqual({ data: null, error: 'not_owner' })
  expect(await own.detail('x')).toEqual({ data: null, error: 'not_owner' })
})

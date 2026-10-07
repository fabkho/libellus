import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createAuth } from '../app/data/auth'
import { createReadingPages } from '../app/data/readingPage'
import { createWaitlist } from '../app/data/waitlist'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, mailCount, newClient, readMailedCode, resetWaitlistLimits, sql, uniqueEmail } from '../tests/support/stack'
import { test } from './fixtures'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID, shelfOwner } from './shelfOwner'
import { expectAccessible, signedIn, untilStill } from './support'

/**
 * The owner reads the waitlist in the app (issue #171): Profile → Account → Waitlist, the people who asked
 * for an invite on a reading page, newest first: how many wait, the addresses copied for a Bcc field, an
 * entry marked invited, one deleted (a request to be forgotten). The owner is the member the build names
 * (NUXT_PUBLIC_SHELF_OWNER_ID, the flows' shelf owner) and the database names her as the instance's owner
 * (`private.instance_owner`), restored after the flows. Anyone else has no row, no address and no request
 * for the list, and the database refuses her too. With docs/parity.md (Waitlist) this is the behavioural
 * reference.
 */

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
test.beforeEach(resetWaitlistLimits)

const SHELF_FILE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

/** Signs the owner in through the screens (she exists; a code is mailed to her). */
async function signInAsOwner(page: Page) {
  await page.route(SHELF_LIBRARY_SRC, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: SHELF_FILE }),
  )
  const owner = await shelfOwner()
  await emailCooldown()
  const before = await mailCount(owner.email)
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(owner.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(owner.email, before + 1))
  await expect(page.getByTestId('home.title')).toBeVisible()
  return owner
}

/** A member named Ada with her page on, and what a visitor of it leaves on the waitlist. */
async function visitors(addresses: string[]) {
  const ada = await signUpMember()
  await createAuth(ada.client).setName('Ada')
  const token = (await createReadingPages(ada.client).setOn(true)).data!.token!
  for (const address of addresses) await createWaitlist(newClient()).join(address, token)
}

async function expectAccessibleBoth(page: Page, where: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expectAccessible(page, `${where} (${colorScheme})`)
  }
}

test('the owner reads the waitlist, copies who waits, marks one invited and deletes one', async ({ page }) => {
  // WebKit grants no clipboard permission in a test: what the app writes is recorded instead.
  await page.addInitScript(() => {
    ;(window as unknown as { __copied: string[] }).__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (window as unknown as { __copied: string[] }).__copied.push(text) },
    })
  })
  const first = uniqueEmail('wl-first')
  const second = uniqueEmail('wl-second')
  await visitors([first, second])
  await signInAsOwner(page)

  // Profile → Account → Waitlist, with how many wait.
  await page.goto('/profile')
  await expect(page.getByTestId('profile.waitlist')).toBeVisible()
  await expect(page.getByTestId('profile.waitlistValue')).toContainText('waiting')
  await page.getByTestId('profile.waitlist').click()
  await expect(page).toHaveURL(/\/profile\/waitlist$/)
  await expect(page.getByTestId('waitlist.title')).toHaveText(en.waitlist.title)

  const entry = (address: string) => page.getByTestId('waitlist.entry').filter({ hasText: address })
  await expect(entry(first)).toBeVisible()
  await expect(entry(second)).toBeVisible()
  // Where it came from: Ada's page, by her first name.
  await expect(entry(first).getByTestId('waitlist.meta')).toContainText(en.waitlist.fromMember.replace('{name}', 'Ada'))
  const waitingBefore = Number((await page.getByTestId('waitlist.summary').textContent())!.match(/(\d+) waiting/)![1])
  expect(waitingBefore).toBeGreaterThanOrEqual(2)
  await untilStill(page)
  await expectAccessibleBoth(page, 'Waitlist')

  // Mark one invited: it says so and leaves the waiting; marking again takes it back.
  await entry(first).getByTestId('waitlist.invited').click()
  await expect(entry(first).getByTestId('waitlist.invited')).toHaveText(en.waitlist.invitedDone)
  await expect(page.getByTestId('waitlist.summary')).toContainText(`${waitingBefore - 1} waiting`)
  expect(await sql('select invited_at from private.waitlist where email::text = $1', [first])).toMatchObject([{ invited_at: expect.anything() }])

  // Copy waiting emails: the invited one is left out, the other is in.
  await page.getByTestId('waitlist.copy').click()
  await expect(page.getByTestId('waitlist.copy')).toHaveText(en.waitlist.copied)
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '')
  expect(copied).toContain(second)
  expect(copied).not.toContain(first)
  expect(copied).not.toContain('\n')

  await entry(first).getByTestId('waitlist.invited').click()
  await expect(entry(first).getByTestId('waitlist.invited')).toHaveText(en.waitlist.markInvited)
  expect(await sql('select invited_at from private.waitlist where email::text = $1', [first])).toMatchObject([{ invited_at: null }])

  // Delete one (a request to be forgotten): behind a Confirm that says so; Cancel keeps it.
  await entry(second).getByTestId('waitlist.delete').click()
  await expect(page.getByTestId('waitlist.confirm')).toContainText(second)
  await expectAccessibleBoth(page, 'Waitlist, delete confirm')
  await page.getByTestId('waitlist.confirm.cancel').click()
  await expect(page.getByTestId('waitlist.confirm')).toBeHidden()
  await expect(entry(second)).toBeVisible()
  await entry(second).getByTestId('waitlist.delete').click()
  await page.getByTestId('waitlist.confirm.confirm').click()
  await expect(entry(second)).toHaveCount(0)
  await expect(entry(first)).toBeVisible()
  expect(await sql('select 1 from private.waitlist where email::text = $1', [second])).toHaveLength(0)

  // Refresh asks again and keeps the list.
  const asked = page.waitForRequest((request) => request.url().includes('/rpc/owner_waitlist'))
  await page.getByTestId('waitlist.refresh').click()
  await asked
  await expect(entry(first)).toBeVisible()
})

test('nobody on the list: the empty state', async ({ page }) => {
  await signInAsOwner(page)
  await page.route('**/rest/v1/rpc/owner_waitlist', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
  )
  await page.goto('/profile/waitlist')
  await expect(page.getByTestId('waitlist.emptyTitle')).toHaveText(en.waitlist.empty.title)
  await expect(page.getByTestId('waitlist.empty')).toHaveText(en.waitlist.empty.text)
  await expect(page.getByTestId('waitlist.entry')).toHaveCount(0)
  await expectAccessibleBoth(page, 'Waitlist, empty')
})

test('the list cannot be loaded: it says so and tries again', async ({ page }) => {
  await signInAsOwner(page)
  let failing = true
  await page.route('**/rest/v1/rpc/owner_waitlist', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
  )
  await page.goto('/profile/waitlist')
  await expect(page.getByTestId('waitlist.loadFailed')).toContainText(en.waitlist.loadError)
  failing = false
  await page.getByTestId('waitlist.retry').click()
  await expect(page.getByTestId('waitlist.emptyTitle')).toBeVisible()
})

// Nuxt's own page for an address that doesn't exist is not a Libellus screen (its link home has no test ID).
const anyone = test.extend<{ everyControlHasATestId: void }>({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

anyone('nobody else has the list: no row, no address, no request, and the database refuses her', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('owner_waitlist')) asked.push(request.url())
  })
  const member = await signedIn(page)
  await page.goto('/profile')
  await expect(page.getByTestId('profile.account')).toBeVisible()
  await expect(page.getByTestId('profile.links')).toBeVisible()
  await expect(page.getByTestId('profile.waitlist')).toHaveCount(0)

  // The address is a page that doesn't exist, like any other unknown one.
  await page.goto('/profile/waitlist')
  await expect(page.getByText('404').first()).toBeVisible()
  await expect(page.getByTestId('waitlist.title')).toHaveCount(0)
  expect(asked).toEqual([])

  // And were she to ask the database herself, it says no.
  const own = createWaitlist(member.client)
  expect(await own.list()).toEqual({ data: null, error: 'not_owner' })
  expect(await own.remove('00000000-0000-4000-8000-000000000000')).toEqual({ data: null, error: 'not_owner' })
})

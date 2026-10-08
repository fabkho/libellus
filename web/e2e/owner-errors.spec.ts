import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createAuth } from '../app/data/auth'
import { createOwnerErrors } from '../app/data/ownerErrors'
import { createReadingPages } from '../app/data/readingPage'
import { createWaitlist } from '../app/data/waitlist'
import { signUpMember } from '../tests/support/member'
import { sql, uniqueEmail, visitorClient } from '../tests/support/stack'
import { test } from './fixtures'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID, shelfOwner } from './shelfOwner'
import { expectAccessible, goto, openProfile, signedIn, signedInAs, untilStill } from './support'

/**
 * The owner reads the client error log in the app (docs/OPERATIONS.md, Client
 * errors): Profile → Account → Errors, the last 7 days grouped, a stack per
 * group. The owner is the member the build names (NUXT_PUBLIC_SHELF_OWNER_ID,
 * the flows' shelf owner) and the database names her as the instance's owner
 * (`private.instance_owner`), restored after the flows. Anyone else has no row,
 * no address and no request for the log, and the database refuses her too.
 * With docs/parity.md (Errors) this is the behavioural reference.
 *
 * The owner's Waitlist (#171, Profile → Account → Waitlist) is in here too: both are the owner's
 * screens, and the instance's owner row is one for the whole database, so every flow that names her
 * takes its turn in this file. With docs/parity.md (Waitlist) these are its behavioural reference.
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

test('the owner picks how glassy the chrome is: Strong is the design, Medium and Off are kept on the device, an old Light reads as Medium', async ({ page }) => {
  await signInAsOwner(page)
  await openProfile(page)
  const html = page.locator('html')
  await expect(page.getByTestId('profile.glass.strong')).toHaveAttribute('aria-checked', 'true')
  await expect(html).not.toHaveAttribute('data-glass')

  const glass = (el: string) => page.getByTestId('shell.tabs').evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), el)
  await page.getByTestId('profile.glass.medium').click()
  await expect(html).toHaveAttribute('data-glass', 'medium')
  await expect.poll(() => glass('backdrop-filter')).toContain('blur(15px)')
  // Off: nothing shows through (an opaque tint: no alpha in its colour) and nothing blurs.
  await page.getByTestId('profile.glass.off').click()
  await expect(html).toHaveAttribute('data-glass', 'off')
  await expect.poll(() => glass('backdrop-filter')).toBe('none')
  expect(await page.getByTestId('shell.tabs').evaluate((node) => getComputedStyle(node).backgroundColor)).not.toContain('/')

  // Kept through a reload; the first version's names read as the new levels.
  await page.reload()
  await expect(html).toHaveAttribute('data-glass', 'off')
  await page.evaluate(() => localStorage.setItem('libellus-glass', 'light'))
  await page.reload()
  await expect(html).toHaveAttribute('data-glass', 'medium')
  await expect(page.getByTestId('profile.glass.medium')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('profile.glass.strong').click()
  await expect(html).not.toHaveAttribute('data-glass')
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

// ------------------------------------------------------------------ the waitlist (#171)

/** A member named Ada with her page on, and what a visitor of it leaves on the waitlist. */
async function visitors(addresses: string[]) {
  const ada = await signUpMember()
  await createAuth(ada.client).setName('Ada')
  const token = (await createReadingPages(ada.client).setOn(true)).data!.token!
  for (const address of addresses) await createWaitlist(visitorClient()).join(address, token)
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

/** The `waitlist-invite` edge function (supabase/functions/waitlist-invite), stood in: these flows never mail. */
const INVITE_FUNCTION = '**/functions/v1/waitlist-invite'
const EXPIRES = '2026-10-27T09:00:00.000Z'
/** The expiry as the row says it, in the app's locale. */
const UNTIL = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(EXPIRES))

/** An answer of that function, as `route.fulfill` takes it. */
function inviteAnswer(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' },
    body: JSON.stringify(body),
  }
}

test('the owner invites one: confirmed, mailed, marked invited, and the code is hers to copy', async ({ page }) => {
  // WebKit grants no clipboard permission in a test: what the app writes is recorded instead.
  await page.addInitScript(() => {
    ;(window as unknown as { __copied: string[] }).__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (window as unknown as { __copied: string[] }).__copied.push(text) },
    })
  })
  const mailed = uniqueEmail('wl-mailed')
  const unsent = uniqueEmail('wl-unsent')
  await visitors([mailed, unsent])
  const ids = Object.fromEntries(
    (await sql<{ id: string; email: string }>('select id, email::text from private.waitlist where email::text = any($1)', [[mailed, unsent]])).map((r) => [r.email, r.id]),
  )
  // The function answers per entry: the first is mailed, the second finds no mail set up.
  const asked: { id: string; authorization: string | null }[] = []
  let answer: (id: string) => ReturnType<typeof inviteAnswer> = (id) =>
    id === ids[mailed]
      ? inviteAnswer({ code: 'K7QM-X2PA', expiresAt: EXPIRES, emailed: true })
      : inviteAnswer({ code: 'B4TR-9WNE', expiresAt: EXPIRES, emailed: false, reason: 'not_configured' })
  await page.route(INVITE_FUNCTION, (route) => {
    const id = (route.request().postDataJSON() as { id: string }).id
    asked.push({ id, authorization: route.request().headers()['authorization'] ?? null })
    return route.fulfill(answer(id))
  })
  await signInAsOwner(page)
  await goto(page, '/profile/waitlist')
  const entry = (address: string) => page.getByTestId('waitlist.entry').filter({ hasText: address })
  await expect(entry(mailed)).toBeVisible()
  await untilStill(page)

  // Invite asks first, naming the address; Cancel sends nothing.
  await expect(entry(mailed).getByTestId('waitlist.invite')).toHaveText(en.waitlist.invite)
  await entry(mailed).getByTestId('waitlist.invite').click()
  await expect(page.getByTestId('waitlist.inviteConfirm.title')).toHaveText(en.waitlist.inviteConfirm.title.replace('{email}', mailed))
  await expect(page.getByTestId('waitlist.inviteConfirm.text')).toHaveText(en.waitlist.inviteConfirm.text)
  await expectAccessibleBoth(page, 'Waitlist, invite confirm')
  await page.getByTestId('waitlist.inviteConfirm.cancel').click()
  await expect(page.getByTestId('waitlist.inviteConfirm')).toBeHidden()
  expect(asked).toEqual([])

  // Send invite: the function is asked for this entry with her session; the entry is invited and shows its code.
  await entry(mailed).getByTestId('waitlist.invite').click()
  await page.getByTestId('waitlist.inviteConfirm.confirm').click()
  await expect(page.getByTestId('waitlist.inviteConfirm')).toBeHidden()
  expect(asked).toEqual([{ id: ids[mailed], authorization: expect.stringMatching(/^Bearer \S+/) }])
  await expect(entry(mailed).getByTestId('waitlist.invited')).toHaveText(en.waitlist.invitedDone)
  await expect(entry(mailed).getByTestId('waitlist.invite')).toHaveCount(0)
  await expect(entry(mailed).getByTestId('waitlist.codeValue')).toHaveText('K7QM-X2PA')
  await expect(entry(mailed).getByTestId('waitlist.codeNote')).toHaveText(en.waitlist.code.emailed.replace('{date}', UNTIL))
  await entry(mailed).getByTestId('waitlist.copyCode').click()
  await expect(entry(mailed).getByTestId('waitlist.copyCode')).toHaveText(en.waitlist.code.copied)
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1))).toBe('K7QM-X2PA')

  // No mail set up: the code all the same, a plain line that nothing was sent, and the entry still waiting.
  await entry(unsent).getByTestId('waitlist.invite').click()
  await page.getByTestId('waitlist.inviteConfirm.confirm').click()
  await expect(page.getByTestId('waitlist.inviteConfirm')).toBeHidden()
  await expect(entry(unsent).getByTestId('waitlist.codeValue')).toHaveText('B4TR-9WNE')
  await expect(entry(unsent).getByTestId('waitlist.codeNote')).toHaveText(en.waitlist.code.not_configured.replace('{date}', UNTIL))
  await expect(entry(unsent).getByTestId('waitlist.invited')).toHaveText(en.waitlist.markInvited)
  await expect(entry(unsent).getByTestId('waitlist.invite')).toBeVisible()
  await untilStill(page)
  await expectAccessibleBoth(page, 'Waitlist, invited with codes')

  // The send failed this time: said so; and a refusal (not the owner) stays in the Confirm with its reason.
  answer = () => inviteAnswer({ code: 'B4TR-9WNE', expiresAt: EXPIRES, emailed: false, reason: 'send_failed' })
  await entry(unsent).getByTestId('waitlist.invite').click()
  await page.getByTestId('waitlist.inviteConfirm.confirm').click()
  await expect(entry(unsent).getByTestId('waitlist.codeNote')).toHaveText(en.waitlist.code.send_failed.replace('{date}', UNTIL))
  answer = () => inviteAnswer({ error: 'not_owner' }, 403)
  await entry(unsent).getByTestId('waitlist.invite').click()
  await page.getByTestId('waitlist.inviteConfirm.confirm').click()
  await expect(page.getByTestId('waitlist.inviteConfirm.error')).toHaveText(en.waitlist.inviteError)
  await page.getByTestId('waitlist.inviteConfirm.cancel').click()
  await expect(page.getByTestId('waitlist.inviteConfirm')).toBeHidden()
  await expect(entry(unsent).getByTestId('waitlist.invited')).toHaveText(en.waitlist.markInvited)
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

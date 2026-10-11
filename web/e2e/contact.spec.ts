import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createFeedback, buildContext } from '../app/data/feedback'
import { signUpMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { SHELF_LIBRARY_SRC } from './shelfOwner'
import { expectAccessible, openProfile, signedIn, signedInAsOwner, untilStill } from './support'

/**
 * Contact (docs/parity.md, Contact): from the very bottom of the Profile a member writes a bug, a feature
 * request or something else to the owner, with no e-mail. The sheet takes the keyboard once it has risen,
 * keeps the text when a send is refused, says it is offline and sends nothing then, and thanks her when
 * it went through. The owner's account has a Feedback row under it: the messages, newest first, as text
 * (never markup), with Mark handled. Everyone else has neither the row nor the page.
 */

/**
 * The published library file the owner's Profile shows (#23, `SHELF_LIBRARY_SRC`): the owner is
 * signed in here, so her Profile asks for it (the shell's warm-up, the Profile's card, and Regal's
 * own components). Answered from the synthetic fixture, the way the shelf's own flows did
 * (tests/fixtures/shelf/library.json): no flow reaches the live address (`noLiveApis`, e2e/fixtures.ts).
 */
const LIBRARY_FILE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

async function recordedShelf(page: Page) {
  await page.route(SHELF_LIBRARY_SRC, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: LIBRARY_FILE }),
  )
}

type Row = { kind: string; body: string; context: Record<string, unknown>; handled_at: string | null }
const rowsOf = (memberId: string) => sql<Row>('select kind, body, context, handled_at::text from public.feedback where member_id = $1 order by created_at', [memberId])

test('a member sends a bug from the bottom of the Profile and is thanked', async ({ page }) => {
  const member = await signedIn(page)
  await openProfile(page)

  await page.getByTestId('profile.contact').scrollIntoViewIfNeeded()
  await page.getByTestId('profile.contact').click()
  const sheet = page.getByTestId('contact')
  await expect(sheet).toBeVisible()
  await untilStill(page)

  // Bug is chosen, the box has the keyboard, nothing can be sent yet, and she is told what goes along.
  await expect(page.getByTestId('contact.kind.bug')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('contact.text')).toBeFocused()
  await expect(page.getByTestId('contact.text')).toHaveAttribute('placeholder', en.contact.placeholder.bug)
  await expect(page.getByTestId('contact.send')).toBeDisabled()
  await expect(page.getByTestId('contact.context')).toHaveText(en.contact.context)
  await expect(page.getByTestId('contact.count')).toHaveText('0 / 2000')

  await page.getByTestId('contact.kind.feature').click()
  await expect(page.getByTestId('contact.text')).toHaveAttribute('placeholder', en.contact.placeholder.feature)
  await page.getByTestId('contact.kind.bug').click()

  await page.getByTestId('contact.text').fill('short')
  await expect(page.getByTestId('contact.send')).toBeDisabled()
  const text = '  The sheet over my shelf does not close when I swipe it down.  '
  await page.getByTestId('contact.text').fill(text)
  await expect(page.getByTestId('contact.count')).toHaveText(`${text.length} / 2000`)
  await expectAccessible(page, 'the Contact sheet')
  await page.getByTestId('contact.send').click()

  await expect(page.getByTestId('contact.doneTitle')).toHaveText(en.contact.done.title)
  await expect(page.getByTestId('contact.done')).toContainText(en.contact.done.text)
  await expectAccessible(page, 'the Contact sheet, thanked')

  const [row] = await rowsOf(member.id)
  expect(row).toMatchObject({ kind: 'bug', body: text.trim(), handled_at: null })
  expect(row!.context).toMatchObject({ route: '/profile', displayMode: 'browser', online: true })
  expect(Object.keys(row!.context).sort()).toEqual(['appVersion', 'displayMode', 'locale', 'online', 'platform', 'route', 'screen', 'userAgent'])

  // Done closes it; the next opening is a new message.
  await page.getByTestId('contact.doneAction').click()
  await expect(sheet).toBeHidden()
  await page.getByTestId('profile.contact').click()
  await expect(page.getByTestId('contact.text')).toHaveValue('')
  await expect(page.getByTestId('contact.kind.bug')).toHaveAttribute('aria-checked', 'true')
  expect(await rowsOf(member.id)).toHaveLength(1)
})

test('a refused send keeps the text and tries again; offline sends nothing', async ({ page }) => {
  const member = await signedIn(page)
  await openProfile(page)
  await page.getByTestId('profile.contact').click()
  await untilStill(page)

  await page.getByTestId('contact.kind.other').click()
  const text = 'Something else I wanted to say about the app.'
  await page.getByTestId('contact.text').fill(text)

  // Refused once: the reason, the text kept, the button says Try again.
  let refuse = true
  await page.route('**/rest/v1/feedback', (route) => {
    if (route.request().method() === 'POST' && refuse) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
    return route.continue()
  })
  await page.getByTestId('contact.send').click()
  await expect(page.getByTestId('contact.error')).toHaveText(en.contact.error.unknown)
  await expect(page.getByTestId('contact.text')).toHaveValue(text)
  await expect(page.getByTestId('contact.send')).toHaveText(en.contact.retry)
  expect(await rowsOf(member.id)).toHaveLength(0)

  // Closed and opened again: the draft is still there.
  await page.getByTestId('contact.cancel').click()
  await expect(page.getByTestId('contact')).toBeHidden()
  await page.getByTestId('profile.contact').click()
  await expect(page.getByTestId('contact.text')).toHaveValue(text)
  await expect(page.getByTestId('contact.kind.other')).toHaveAttribute('aria-checked', 'true')

  // Offline: Send is off and says why; nothing leaves.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByTestId('contact.offline')).toHaveText(en.contact.offline)
  await expect(page.getByTestId('contact.send')).toBeDisabled()
  await expect(page.getByTestId('contact.text')).toHaveValue(text)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByTestId('contact.offline')).toHaveCount(0)

  refuse = false
  await page.getByTestId('contact.send').click()
  await expect(page.getByTestId('contact.doneTitle')).toBeVisible()
  const rows = await rowsOf(member.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ kind: 'other', body: text })
})

test('no Feedback row or page for a member who is not the owner', async ({ page }) => {
  await signedIn(page)
  await openProfile(page)
  await expect(page.getByTestId('profile.contact')).toBeVisible()
  await expect(page.getByTestId('profile.feedback')).toHaveCount(0)
  await page.goto('/profile/feedback')
  await expect(page.getByTestId('feedback.title')).toHaveCount(0)
})

test('the owner reads what was sent, as text, and marks it handled', async ({ page }) => {
  const writer = await signUpMember()
  const markup = '<img src=x onerror="document.title=\'pwned\'"> and <b>bold</b> with\na second line'
  const context = buildContext({
    appVersion: 'e2e', path: '/r/AbCdEf123456789012345x', pattern: '/r/:token()', standalone: true, platform: 'iOS', userAgent: 'Test agent', locale: 'en', online: true,
    screen: { width: 390, height: 844, ratio: 3 },
  })
  expect(await createFeedback(writer.client).send('feature', markup, context)).toEqual({ error: null })
  const [{ id }] = await sql<{ id: string }>('select id from public.feedback where member_id = $1', [writer.id])

  // The owner's Profile shows her Regal shelf, which reads the published library file: answered.
  await recordedShelf(page)
  await signedInAsOwner(page)
  await openProfile(page)
  await expect(page.getByTestId('profile.feedback')).toBeVisible()
  await page.getByTestId('profile.feedback').click()
  await expect(page.getByTestId('feedback.title')).toHaveText(en.feedback.title)

  const item = page.getByTestId('feedback.item').filter({ hasText: 'a second line' })
  await expect(item).toHaveCount(1)
  await expect(item.getByTestId('feedback.kind')).toHaveText(en.contact.kind.feature)
  await expect(item.getByTestId('feedback.who')).toContainText(writer.email)
  // Text, not markup: the tags are read out as they were written, no element came of them, nothing ran.
  await expect(item.getByTestId('feedback.text')).toContainText('<img src=x onerror=')
  await expect(item.getByTestId('feedback.text').locator('img, b')).toHaveCount(0)
  expect(await page.title()).not.toBe('pwned')

  // The context is behind a collapsed block, and the route is a pattern, never the token.
  await expect(item.getByTestId('feedback.details')).not.toHaveAttribute('open', '')
  await item.getByTestId('feedback.detailsToggle').click()
  await expect(item.getByTestId('feedback.details')).toContainText('route: /r/[token]')
  await expect(item.getByTestId('feedback.details')).not.toContainText('AbCdEf123456789012345x')
  await expectAccessible(page, 'the Feedback page')

  await item.getByTestId('feedback.handled').click()
  await expect(item.getByTestId('feedback.handled')).toHaveText(en.feedback.handled)
  await expect.poll(async () => (await rowsOf(writer.id))[0]!.handled_at).not.toBeNull()
  await item.getByTestId('feedback.handled').click()
  await expect(item.getByTestId('feedback.handled')).toHaveText(en.feedback.markHandled)
  await expect.poll(async () => (await rowsOf(writer.id))[0]!.handled_at).toBeNull()
  expect(id).toBeTruthy()
})

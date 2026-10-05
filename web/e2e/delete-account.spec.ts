import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createInviteCode, inviteCodeUses, readMailedCode, sql, uniqueEmail, runTitle, authUserExists, emailCooldown } from '../tests/support/stack'
import { recordedApple } from './support'
import { test } from './fixtures'

/**
 * Delete your account from inside the app (#101): a fresh member signs up with
 * an invite of her own, adds a book, and deletes the account from the Profile
 * behind a Confirm that says what goes. She lands on Sign in with a note; the
 * member, her Library and her manual Book are gone from the database, the
 * invite stays spent, and the same address needs a new invite to come back.
 */

test('a member deletes her account: gone from the database and the device, the address needs a new invite', async ({ page }) => {
  await recordedApple(page)
  const email = uniqueEmail('e2e-delete')
  const invite = await createInviteCode({ maxUses: 1 })

  // Sign up with the invite, as a stranger does.
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await page.getByTestId('signUp.inviteCode').fill(invite)
  await page.getByTestId('signUp.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(email))
  await expect(page.getByTestId('home.title')).toBeVisible()
  expect(await inviteCodeUses(invite)).toBe(1)

  // A book of her own, by hand.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library$/)
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('qxzvwlmbrt')
  await page.getByTestId('search.addManually').click()
  await page.getByTestId('manual.title').fill(runTitle('Meine Notizen'))
  await page.getByTestId('manual.author').fill('Ida Beispiel')
  await page.getByTestId('manual.action').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Meine Notizen'))
  const owned = () =>
    sql<{ n: string }>(
      `select (select count(*) from public.library_entries e join auth.users u on u.id = e.member_id where u.email = $1)
            + (select count(*) from public.books b join auth.users u on u.id = b.owner_id where u.email = $1) as n`,
      [email],
    )
  expect(Number((await owned())[0]!.n)).toBe(2)

  // The Profile: the row ends the account section, in the danger colour.
  await page.getByTestId('book.back').click()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.delete')).toHaveText(en.profile.account.delete)
  await expect(page.getByTestId('profile.delete')).toBeEnabled()
  const rows = await page.getByTestId('profile.account').locator('[data-testid^="profile."][type="button"], a[data-testid^="profile."]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(rows.at(-1)).toBe('profile.delete')

  // The Confirm says what goes and that it cannot be undone; Cancel changes nothing.
  await page.getByTestId('profile.delete').click()
  await expect(page.getByTestId('deleteAccount.title')).toHaveText(en.profile.deleteAccount.title)
  await expect(page.getByTestId('deleteAccount.text')).toHaveText(en.profile.deleteAccount.text)
  await expect(page.getByTestId('deleteAccount.confirm')).toHaveText(en.profile.deleteAccount.action)
  await page.getByTestId('deleteAccount.cancel').click()
  await expect(page.getByTestId('deleteAccount')).toBeHidden()
  expect(await authUserExists(email)).toBe(true)

  // Delete: Sign in, with the note; nothing of her left.
  await page.getByTestId('profile.delete').click()
  await page.getByTestId('deleteAccount.confirm').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByTestId('signIn.deleted')).toHaveText(en.signIn.accountDeleted)
  expect(await authUserExists(email)).toBe(false)
  expect(Number((await owned())[0]!.n)).toBe(0)
  expect(await inviteCodeUses(invite)).toBe(1)
  // Every local copy is gone; the theme is the device's and stays.
  const local = await page.evaluate(async () => ({
    keys: Object.keys(localStorage).filter((key) => key.startsWith('libellus.')),
    databases: (await indexedDB.databases()).map((db) => db.name).filter((name) => name === 'libellus'),
  }))
  expect(local).toEqual({ keys: [], databases: [] })

  // Signed out for good: the app is behind the code, a reload says nothing more.
  await page.goto('/library')
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByTestId('signIn.deleted')).toBeHidden()

  // The same address needs a new invite: it has no account, and the old invite is spent.
  await emailCooldown()
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await page.getByTestId('signUp.inviteCode').fill(invite)
  await page.getByTestId('signUp.submit').click()
  await expect(page.getByTestId('signUp.inviteError')).toHaveText(en.auth.error.invite_exhausted)
})

import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { signUpMember } from '../tests/support/member'
import { emailCooldown, mistype, readMailedCode, uniqueEmail } from '../tests/support/stack'

/**
 * The way in and the tab shell, on a phone, against the real stack: the code is
 * read out of Mailpit the way a member reads it out of their inbox. Together
 * with docs/parity.md these flows are the behavioural reference for a native
 * port. The dev invite is the one the seed creates (README, Running it locally).
 */
const DEV_INVITE = 'LIBELLUS-DEV'

test('a new member signs up with the dev invite, lands on Home and signs out', async ({ page }) => {
  const email = uniqueEmail('e2e-signup')

  // Signed out: the app sends us to sign-in.
  await page.goto('/')
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByTestId('signIn.title')).toHaveText(en.signIn.title)

  // The address has no account, so sign-in hands over to sign-up with it filled in.
  await page.getByTestId('signIn.email').fill(email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByTestId('signUp.email')).toHaveValue(email)

  await page.getByTestId('signUp.inviteCode').fill(DEV_INVITE)
  await page.getByTestId('signUp.submit').click()

  await expect(page).toHaveURL(/\/verify$/)
  await expect(page.getByTestId('verify.sentTo')).toContainText(email)
  await page.getByTestId('verify.code').fill(await readMailedCode(email))

  // Signed in: Home, with its empty state and the three tabs.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home.title')).toHaveText(en.home.title)
  await expect(page.getByTestId('home.empty')).toHaveText(en.home.empty)
  await expect(page.getByTestId('shell.tab.home')).toHaveText(en.tabs.home)
  await expect(page.getByTestId('shell.tab.library')).toHaveText(en.tabs.library)
  await expect(page.getByTestId('shell.tab.search')).toHaveText(en.tabs.search)

  // The tabs lead to their own empty pages, and the session survives a reload.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.empty')).toHaveText(en.library.empty)
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.empty')).toHaveText(en.search.empty)
  await page.reload()
  await expect(page).toHaveURL(/\/search$/)
  await expect(page.getByTestId('search.title')).toHaveText(en.search.title)

  // The avatar shows the initials and opens the menu that signs out.
  await expect(page.getByTestId('shell.avatar')).toHaveText('ES') // e2e-signup-… → first letters of the first two words
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('shell.email')).toContainText(email)
  await page.getByTestId('shell.signOut').click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // And signed out means signed out: the tabs are behind the code again.
  await page.goto('/library')
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('an invite code that does not work is refused under its field', async ({ page }) => {
  await page.goto('/sign-up')
  await page.getByTestId('signUp.email').fill(uniqueEmail('e2e-badinvite'))
  await page.getByTestId('signUp.inviteCode').fill('NOT-A-CODE')
  await page.getByTestId('signUp.submit').click()

  await expect(page.getByTestId('signUp.inviteError')).toHaveText(en.auth.error.invite_invalid)
  await expect(page).toHaveURL(/\/sign-up$/)
})

test('a mistyped code is refused and the field is cleared for another go', async ({ page }) => {
  const member = await signUpMember()
  await emailCooldown()

  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)

  const mailed = await readMailedCode(member.email, 2)
  await page.getByTestId('verify.code').fill(mistype(mailed))

  await expect(page.getByTestId('verify.error')).toHaveText(en.auth.error.code_invalid)
  await expect(page.getByTestId('verify.code')).toHaveValue('')
  await expect(page).toHaveURL(/\/verify$/)

  // Typing the right one after all gets in.
  await page.getByTestId('verify.code').fill(mailed)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('the pending address survives the app being relaunched', async ({ page }) => {
  const member = await signUpMember()
  await emailCooldown()

  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)

  // iOS kills the installed app while the member is in Mail and relaunches it at
  // the start URL, which is the whole reason the address is persisted.
  await page.goto('/')

  await expect(page).toHaveURL(/\/verify$/)
  await expect(page.getByTestId('verify.sentTo')).toContainText(member.email)

  // "Use another email" drops it.
  await page.getByTestId('verify.changeEmail').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('the dev playground is not behind the sign-in while developing', async ({ page }) => {
  // A design playground lives under /prototype on its own branch and is stripped
  // from production builds; the guard lets it through in dev only. There is no
  // such page on this branch, so what counts is that we are not sent to sign-in.
  await page.goto('/prototype')
  await expect(page).toHaveURL(/\/prototype$/)
})

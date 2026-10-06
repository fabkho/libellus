import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { signUpMember } from '../tests/support/member'
import { emailCooldown, mistype, readMailedCode, uniqueEmail } from '../tests/support/stack'
import { openProfile, showTabBar, untilStill } from './support'
import { test } from './fixtures'

/**
 * The way in and the tab shell, on a phone, against the real stack: the code is
 * read out of Mailpit the way a member reads it out of their inbox. Together
 * with docs/parity.md these flows are the behavioural reference for a native
 * port. The dev invite is the one the seed creates (docs/DEVELOPMENT.md, Signing in locally).
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
  await expect(page.getByTestId('home.title')).toHaveText(new RegExp(`^(${Object.values(en.home.greeting).join('|')})$`))
  await expect(page.getByTestId('home.empty')).toHaveText(en.home.empty)
  await expect(page.getByTestId('shell.tab.home')).toHaveText(en.tabs.home)
  await expect(page.getByTestId('shell.tab.library')).toHaveText(en.tabs.library)
  await expect(page.getByTestId('shell.tab.search')).toHaveText(en.tabs.search)

  // The tabs lead to their own empty pages, and the session survives a reload.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.title')).toHaveText(en.library.title)
  await expect(page.getByTestId('library.empty')).toHaveText(en.library.empty)
  // At rest first: WebKit loses a reload that starts while the tab's page is still arriving (support.ts, goto).
  await untilStill(page)
  await page.reload()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.title')).toHaveText(en.library.title)

  // Search never navigates: it opens over the page and closes back onto it.
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.empty')).toHaveText(en.search.empty)
  await expect(page).toHaveURL(/\/library$/)
  await page.getByTestId('search.cancel').click()
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await expect(page.getByTestId('library.title')).toBeVisible()

  // The avatar shows the initials and opens the Profile, whose account rows sign out.
  await expect(page.getByTestId('shell.avatar')).toHaveText('ES') // e2e-signup-… → first letters of the first two words
  await openProfile(page)
  await expect(page.getByTestId('profile.email')).toContainText(email)
  await page.getByTestId('profile.signOut').click()
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

/** Signs a fresh member in through the screens, the way the flows above do. */
async function signedIn(page: import('@playwright/test').Page) {
  const member = await signUpMember()
  await emailCooldown()
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  await expect(page.getByTestId('home.title')).toBeVisible()
  return member
}

test('the search overlay closes on the page behind it and on a swipe down', async ({ page }) => {
  await signedIn(page)

  // The empty Home's search prompt opens the same overlay as the Search tab.
  await page.getByTestId('home.search').click()
  const overlay = page.getByTestId('search.overlay')
  await expect(overlay).toBeVisible()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(page.getByTestId('search.query')).toHaveAttribute('placeholder', en.search.placeholder)

  // A tap on the blurred page behind closes it, and the page is still Home.
  await page.getByTestId('search.backdrop').click({ position: { x: 20, y: 120 } })
  await expect(overlay).toBeHidden()
  await expect(page).toHaveURL(/\/$/)

  // Swiping the palette down closes it too.
  await page.getByTestId('shell.tab.search').click()
  await expect(overlay).toBeVisible()
  await page.getByTestId('search.query').blur()
  const box = (await page.getByTestId('search.empty').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 160, { steps: 8 })
  await page.mouse.up()
  await expect(overlay).toBeHidden()

  // Escape, for a keyboard.
  await page.getByTestId('shell.tab.search').click()
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('the theme follows the phone until the switch is tapped, then flips and stays', async ({ page }) => {
  // A dark phone: no preference stored, so the app is dark too.
  await page.emulateMedia({ colorScheme: 'dark' })
  await signedIn(page)
  const html = page.locator('html')
  await expect(html).not.toHaveAttribute('data-theme')
  const themeColors = () =>
    page.locator('meta[name="theme-color"]').evaluateAll((tags) => tags.map((t) => t.getAttribute('content')))
  const [light, dark] = await themeColors()

  // The switch shows what is showing: Dark, on.
  await openProfile(page)
  const toggle = page.getByTestId('profile.theme')
  await expect(toggle).toHaveText(en.profile.account.theme)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // The first tap stores the opposite of what is showing: Light.
  await toggle.click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await themeColors()).toEqual([light, light])
  expect(await page.evaluate(() => localStorage.getItem('libellus-theme'))).toBe('light')
  // The Profile stays, so the change can be seen and undone.
  await expect(page.getByTestId('profile.account')).toBeVisible()

  // Every later tap flips, whatever the phone does.
  await toggle.click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await themeColors()).toEqual([dark, dark])
  // …and on every page: moving on does not hand the chrome back to the phone. The bar is
  // back first, as a member who scrolled down to the switch brings it back before she taps it.
  await showTabBar(page)
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  expect(await themeColors()).toEqual([dark, dark])

  // Stored on the device: it is on the page again right after a reload, and
  // signing out keeps it (it is a setting of this phone, not of the member).
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect.poll(themeColors).toEqual([dark, dark])
  await openProfile(page)
  await page.getByTestId('profile.signOut').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(html).toHaveAttribute('data-theme', 'dark')
})

test('the way in opens at its address with a trailing slash, as Cloudflare Pages serves it', async ({ page }) => {
  // Pages redirects /sign-up to /sign-up/: the guard must treat both the same.
  await page.goto('/sign-up/')
  await expect(page.getByTestId('signUp.email')).toBeVisible()
  await page.goto('/sign-in/')
  await expect(page.getByTestId('signIn.email')).toBeVisible()
})

import { expect, type Page } from '@playwright/test'
import { appleAnswer, appleCover } from '../tests/support/apple'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode } from '../tests/support/stack'

/**
 * Answers Apple from the recordings (tests/fixtures/apple): the search API and
 * the cover CDN. No flow ever reaches the live API. Covers are served with the
 * CDN's CORS header, so the app can read them to make the thumbhash.
 */
export async function recordedApple(page: Page) {
  await page.route('https://itunes.apple.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(appleAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
    }),
  )
}

/** Signs a fresh member in through the screens: address, then the mailed code. */
export async function signedIn(page: Page) {
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

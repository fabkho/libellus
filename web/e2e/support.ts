import { expect, type Page } from '@playwright/test'
import { appleAnswer, appleCover } from '../tests/support/apple'
import { openLibraryAnswer } from '../tests/support/openLibrary'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode } from '../tests/support/stack'

/**
 * Answers every source behind search from the recordings: Apple
 * (tests/fixtures/apple) and OpenLibrary (tests/fixtures/openlibrary), their
 * search APIs and their covers. No flow ever reaches a live API. Covers are
 * the recorded stand-in, served with the CDNs' CORS header, so the app can
 * read them to make the thumbhash.
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
  await page.route('https://openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(openLibraryAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route('https://covers.openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
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

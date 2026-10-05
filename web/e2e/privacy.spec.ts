import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { goto, signedIn } from './support'
import { test } from './fixtures'

/**
 * The privacy policy (#90): Google Play links to https://libellus.fabkho.dev/privacy, so it is the
 * one screen anybody may open, signed out (a reviewer, a stranger from the store listing) or
 * signed in, without being sent to sign-in; sign-in, sign-up and the Profile's account rows link
 * to it. With docs/parity.md this is the behavioural reference.
 */
const SECTIONS = ['keeps', 'why', 'device', 'processors', 'direct', 'public', 'rights', 'delete', 'age'] as const

test('a signed-out visitor opens it at its address and reads every section', async ({ page }) => {
  await page.goto('/privacy')

  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByTestId('privacy.title')).toHaveText(en.privacy.title)
  await expect(page.getByTestId('privacy.updated')).toHaveText(en.privacy.updated)
  for (const key of SECTIONS) await expect(page.getByTestId(`privacy.${key}`)).toContainText(en.privacy[key].title)
  // The controller's address to write to, and the authority to complain to.
  await expect(page.getByTestId('privacy.intro').getByTestId('privacy.email')).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+$/)
  await expect(page.getByTestId('privacy.delete').getByTestId('privacy.email')).toBeVisible()
  await expect(page.getByTestId('privacy.authority')).toHaveAttribute('href', 'https://www.ldi.nrw.de')

  // No tab bar for a visitor; back from the opened address leads into the app, which asks her to sign in.
  await expect(page.getByTestId('shell.tabs')).toHaveCount(0)
  await page.getByTestId('privacy.back').click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('its address with a trailing slash, as Cloudflare Pages redirects it, opens it too', async ({ page }) => {
  await page.goto('/privacy/')
  await expect(page.getByTestId('privacy.title')).toBeVisible()
  await expect(page).toHaveURL(/\/privacy\/$/)
})

test('sign-in and sign-up link to it, and back returns there', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByTestId('signIn.privacy').click()
  await expect(page.getByTestId('privacy.title')).toBeVisible()
  await page.getByTestId('privacy.back').click()
  await expect(page.getByTestId('signIn.email')).toBeVisible()

  await page.getByTestId('signIn.signUp').click()
  await page.getByTestId('signUp.privacy').click()
  await expect(page).toHaveURL(/\/privacy$/)
  await page.getByTestId('privacy.back').click()
  await expect(page).toHaveURL(/\/sign-up$/)
})

test('a member opens it from the Profile, and back returns to the Profile', async ({ page }) => {
  await signedIn(page)
  await goto(page, '/profile')
  await page.getByTestId('profile.privacy').click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByTestId('privacy.title')).toBeVisible()

  await page.getByTestId('privacy.back').click()
  await expect(page).toHaveURL(/\/profile$/)
})

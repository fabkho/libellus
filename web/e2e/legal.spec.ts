import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { IMPRINT_ENABLED } from '../app/legal/config'
import { test } from './fixtures'
import { expectAccessible, openProfile, signedIn } from './support'

/**
 * The privacy notice (and the imprint, once `IMPRINT_ENABLED`, legal/config.ts; postponed for the friends
 * round, docs/legal-checklist.md): public pages, English and German on the same page, linked from the way in
 * and from the Profile. The texts are a draft the owner reviews, so these flows check what the pages are and
 * where they sit, never a sentence of them.
 */
const PRIVACY = { path: '/privacy', page: 'privacy', title: { en: 'Privacy notice', de: 'Datenschutzerklärung' } } as const
const IMPRINT = { path: '/imprint', page: 'imprint', title: { en: 'Imprint', de: 'Impressum' } } as const
const PAGES = IMPRINT_ENABLED ? [PRIVACY, IMPRINT] : [PRIVACY]

for (const { path, page: name, title } of PAGES) {
  test(`${path} opens signed out, in English and in German, and the switch changes the text and the address`, async ({ page }) => {
    await page.goto(`${path}?lang=en`)
    // No redirect to the sign-in: the guard lets the page through.
    await expect(page).toHaveURL(new RegExp(`${path}/?\\?lang=en$`))
    await expect(page.getByTestId('legal.screen')).toHaveAttribute('data-page', name)
    await expect(page.getByTestId('legal.title')).toHaveText(title.en)
    await expect(page.getByTestId('legal.text')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('legal.lang.en')).toHaveAttribute('aria-checked', 'true')

    await page.getByTestId('legal.lang.de').click()
    await expect(page.getByTestId('legal.title')).toHaveText(title.de)
    await expect(page.getByTestId('legal.text')).toHaveAttribute('lang', 'de')
    await expect(page).toHaveURL(/lang=de$/)

    // A German address opens in German, and so does a reload.
    await page.reload()
    await expect(page.getByTestId('legal.title')).toHaveText(title.de)
    await page.getByTestId('legal.lang.en').click()
    await expect(page.getByTestId('legal.title')).toHaveText(title.en)
  })
}

test.describe('a German device', () => {
  test.use({ locale: 'de-DE' })

  test('opens the notice in German without being asked', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByTestId('legal.title')).toHaveText('Datenschutzerklärung')
    await expect(page.getByTestId('legal.lang.de')).toHaveAttribute('aria-checked', 'true')
  })
})

test('the notice and the imprint link to each other and keep the language', async ({ page }) => {
  test.skip(!IMPRINT_ENABLED, 'the imprint is postponed')
  await page.goto('/privacy?lang=de')
  await expect(page.getByTestId('legal.title')).toHaveText('Datenschutzerklärung')
  await page.locator('[data-testid="legal.link"][href^="/imprint"]').first().click()
  await expect(page).toHaveURL(/\/imprint\/?\?lang=de$/)
  await expect(page.getByTestId('legal.title')).toHaveText('Impressum')
  await page.getByTestId('legal.privacy').click()
  await expect(page).toHaveURL(/\/privacy\/?$/)
  await expect(page.getByTestId('legal.title')).toBeVisible()
})

test('the privacy notice has no link to the imprint, no postal address and no placeholder left while the imprint is postponed', async ({ page }) => {
  test.skip(IMPRINT_ENABLED, 'the imprint is on')
  for (const lang of ['en', 'de']) {
    await page.goto(`/privacy?lang=${lang}`)
    await expect(page.getByTestId('legal.title')).toBeVisible()
    await expect(page.locator('[data-testid="legal.link"][href*="imprint"]')).toHaveCount(0)
    await expect(page.getByTestId('legal.links')).toHaveCount(0)
    await expect(page.getByTestId('legal.text')).not.toContainText(/imprint|impressum|STREET, POSTCODE|\[\[/i)
    // Nothing is missing any more: no Draft note.
    await expect(page.getByTestId('legal.draft')).toHaveCount(0)
    // The controller by name and e-mail address.
    await expect(page.getByTestId('legal.text')).toContainText('Fabian Kirchhoff')
    await expect(page.getByTestId('legal.text').getByRole('link', { name: 'privacy@fabkho.dev' }).first()).toHaveAttribute('href', 'mailto:privacy@fabkho.dev')
  }
})

// Nuxt's own error page has a link of its own ("Go back home") that is not a control of Libellus: these two
// flows do not ask it for a `data-testid` (e2e/fixtures.ts, everyControlHasATestId).
const unknownAddress = test.extend({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

unknownAddress('/imprint is an address that does not exist while the imprint is postponed, signed out', async ({ page }) => {
  unknownAddress.skip(IMPRINT_ENABLED, 'the imprint is on')
  // The same 404 as any unknown address, not the page.
  await page.goto('/imprint')
  await expect(page.getByText('404').first()).toBeVisible()
  await expect(page.getByTestId('legal.screen')).toHaveCount(0)
})

unknownAddress('signed in, /imprint is the same 404 as any unknown address', async ({ page }) => {
  unknownAddress.skip(IMPRINT_ENABLED, 'the imprint is on')
  await signedIn(page)
  await page.goto('/imprint')
  await expect(page.getByText('404').first()).toBeVisible()
  await expect(page.getByTestId('legal.screen')).toHaveCount(0)
})

test('the sign-in and the sign-up screens link the privacy notice alone, and Back goes where she came from', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.getByTestId('signIn.title')).toBeVisible()
  await expect(page.getByTestId('legal.privacy')).toHaveText(en.legal.privacy)
  await expect(page.getByTestId('legal.imprint')).toHaveCount(IMPRINT_ENABLED ? 1 : 0)
  await page.getByTestId('legal.privacy').click()
  await expect(page.getByTestId('legal.title')).toBeVisible()
  await expect(page).toHaveURL(/\/privacy\/?(\?.*)?$/)
  await page.getByTestId('legal.back').click()
  await expect(page).toHaveURL(/\/sign-in\/?$/)

  await page.goto('/sign-up')
  await expect(page.getByTestId('signUp.title')).toBeVisible()
  await expect(page.getByTestId('legal.privacy')).toBeVisible()
  await expect(page.getByTestId('legal.imprint')).toHaveCount(IMPRINT_ENABLED ? 1 : 0)
  // The one sentence, with the link in it.
  await expect(page.getByTestId('signUp.consent')).toContainText(en.signUp.consent.replace('{privacy}', en.legal.privacyNotice))
  await page.getByTestId('signUp.privacy').click()
  await expect(page.getByTestId('legal.screen')).toHaveAttribute('data-page', 'privacy')
  await page.getByTestId('legal.back').click()
  await expect(page).toHaveURL(/\/sign-up\/?$/)
})

test('opened with no history, Back goes to the sign-in signed out', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByTestId('legal.title')).toBeVisible()
  await page.getByTestId('legal.back').click()
  await expect(page).toHaveURL(/\/sign-in\/?$/)
})

test('a signed-in member finds the privacy notice at the bottom of the Profile and Back returns to it', async ({ page }) => {
  await signedIn(page)
  await openProfile(page)
  await page.getByTestId('legal.privacy').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('legal.imprint')).toHaveCount(IMPRINT_ENABLED ? 1 : 0)
  await page.getByTestId('legal.privacy').click()
  // Signed in she is not sent Home or anywhere else: the page is hers to read too.
  await expect(page.getByTestId('legal.screen')).toHaveAttribute('data-page', 'privacy')
  await page.getByTestId('legal.back').click()
  await expect(page).toHaveURL(/\/profile\/?$/)
})

test.describe('accessibility', () => {
  for (const scheme of ['dark', 'light'] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme, viewport: { width: 412, height: 915 } })

      for (const { path, title } of PAGES) {
        for (const lang of ['en', 'de'] as const) {
          test(`${path} in ${lang}`, async ({ page }) => {
            await page.goto(`${path}?lang=${lang}`)
            await expect(page.getByTestId('legal.title')).toHaveText(title[lang])
            await expectAccessible(page, `${path} (${lang}, ${scheme})`)
          })
        }
      }
    })
  }
})

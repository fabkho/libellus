import type { Page } from '@playwright/test'
import de from '../i18n/locales/de.json' with { type: 'json' }
import en from '../i18n/locales/en.json' with { type: 'json' }
import { LOCALE_KEY } from '../app/utils/locale'
import { expect, test } from './fixtures'
import { openProfile, signedIn, untilStill } from './support'

/**
 * The app's language (issue #257, docs/parity.md, Language; the rule is utils/locale.ts): the phone's until she
 * chooses on the Profile's Language row, her choice after (kept on the device, also past signing out), German or
 * English before the first paint, `<html lang>` to match, and only the language on screen is downloaded.
 */

/** What the app's own scripts carried over the wire: each message file is one chunk with its own words in it. */
function watchScripts(page: Page) {
  const bodies: string[] = []
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/_nuxt/') || !url.pathname.endsWith('.js')) return
    bodies.push(await response.text().catch(() => ''))
  })
  return {
    has: (marker: string) => bodies.some((body) => body.includes(marker)),
  }
}

// A sentence each file has and the other does not (checked against the other file below).
const GERMAN_MARKER = de.shelf.loadError
const ENGLISH_MARKER = en.shelf.loadError
const lang = (page: Page) => page.evaluate(() => document.documentElement.lang)
// <html lang> is written by the head manager (app.vue, `useHead`), which draws into the document one timer after
// the screen's words (unhead's debounced renderer: `setTimeout(…, 0)`). A read right after a word shows can come
// first on a slow runner, so the attribute is waited for like any other thing on screen.
const htmlLang = (page: Page) => expect.poll(() => lang(page), { message: '<html lang>' })
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)

test('the two message files differ in what the checks look for', () => {
  expect(GERMAN_MARKER).not.toBe(ENGLISH_MARKER)
})

test.describe('an English phone', () => {
  test.use({ locale: 'en-GB' })

  test('opens in English, <html lang> says so, and German is never downloaded', async ({ page }) => {
    const scripts = watchScripts(page)
    await page.goto('/sign-in')
    await expect(page.getByTestId('signIn.title')).toHaveText(en.signIn.title)
    await htmlLang(page).toBe('en')
    expect(scripts.has(ENGLISH_MARKER)).toBe(true)
    expect(scripts.has(GERMAN_MARKER)).toBe(false)
    expect(await stored(page)).toBeNull()
  })

  test('the Language row switches to German at once, without a reload, and keeps it past a reload and signing out', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)
    const row = page.getByTestId('profile.language')
    await row.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('profile.languageChoice')).toHaveAttribute('aria-label', en.language.label)
    await expect(page.getByTestId('profile.languageChoice.en')).toHaveAttribute('aria-checked', 'true')
    const loaded = await page.evaluate(() => performance.timeOrigin)

    await page.getByTestId('profile.languageChoice.de').click()
    // Applied now: the rows of the page are German, <html lang> is de, the page was not reloaded.
    await expect(row).toContainText(de.language.row)
    await expect(page.getByTestId('profile.contact')).toContainText(de.contact.row)
    await htmlLang(page).toBe('de')
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loaded)
    expect(await stored(page)).toBe('de')
    // Each option is named in its own language, whatever language the app is in.
    await expect(page.getByTestId('profile.languageChoice.en')).toHaveText('English')
    await expect(page.getByTestId('profile.languageChoice.de')).toHaveText('Deutsch')

    // A reload on an English phone stays German: the choice beats the phone.
    await page.reload()
    await expect(page.getByTestId('profile.language')).toContainText(de.language.row)
    await htmlLang(page).toBe('de')

    // Signing out does not forget it: the way in speaks German too.
    await page.getByTestId('profile.signOut').scrollIntoViewIfNeeded()
    await page.getByTestId('profile.signOut').click()
    await expect(page.getByTestId('signIn.title')).toHaveText(de.signIn.title)
    expect(await stored(page)).toBe('de')
  })
})

test.describe('a German phone', () => {
  test.use({ locale: 'de-DE' })

  test('opens in German on first launch, the shell is drawn in German, and English is never downloaded', async ({ page }) => {
    const scripts = watchScripts(page)
    await page.goto('/sign-in')
    await expect(page.getByTestId('signIn.title')).toHaveText(de.signIn.title)
    // German from the first drawing (English is never downloaded, below): <html lang> and the title follow the shell.
    await htmlLang(page).toBe('de')
    await expect(page).toHaveTitle(de.app.name)
    expect(scripts.has(GERMAN_MARKER)).toBe(true)
    expect(scripts.has(ENGLISH_MARKER)).toBe(false)
    // Nothing was chosen, so nothing is stored: the phone keeps deciding.
    expect(await stored(page)).toBeNull()
  })

  test('an explicit English beats the phone, on the Profile row and after a reload', async ({ page }) => {
    await signedIn(page)
    await expect(page.getByTestId('home.title')).toBeVisible()
    await openProfile(page)
    await page.getByTestId('profile.language').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('profile.languageChoice.de')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('profile.languageChoice.en').click()
    await expect(page.getByTestId('profile.language')).toContainText(en.language.row)
    await htmlLang(page).toBe('en')
    await page.reload()
    await untilStill(page)
    await expect(page.getByTestId('profile.language')).toContainText(en.language.row)
    await htmlLang(page).toBe('en')
    expect(await stored(page)).toBe('en')
  })

  test('the legal pages open in German unless the address names a language, and the switch stays', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByTestId('legal.title')).toBeVisible()
    await expect(page.getByTestId('legal.lang.de')).toHaveAttribute('aria-checked', 'true')
    await page.goto('/privacy?lang=en')
    await expect(page.getByTestId('legal.lang.en')).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('no language list at all', () => {
  test('falls back to English', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'languages', { get: () => [] }))
    await page.goto('/sign-in')
    await expect(page.getByTestId('signIn.title')).toHaveText(en.signIn.title)
  })
})

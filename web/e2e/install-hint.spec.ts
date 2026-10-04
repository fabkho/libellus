import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { INSTALL_HINT_KEY } from '../app/utils/installHint'
import { signedIn } from './support'
import { test } from './fixtures'

/**
 * The install hint (#94): iOS has no install prompt, so Home in Safari on an
 * iPhone or iPad says "Share → Add to Home Screen" until Libellus is installed;
 * dismissed, it stays away for a week. Android's Chrome has its own prompt; the
 * avatar menu offers a quiet "Install app" row only once Chrome has fired
 * `beforeinstallprompt`. The browsers are stood in by their user agents (the
 * rules themselves are tests/install-hint.test.ts); the real Safari is checked
 * in the iOS Simulator (docs/TESTING.md). With docs/parity.md this is the
 * behavioural reference for the hint.
 */
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPADOS_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.79 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'

test.describe('Safari on an iPhone', () => {
  test.use({ userAgent: IPHONE_SAFARI })

  test('shows the hint on Home, dismisses it for a week and remembers that', async ({ page }) => {
    await signedIn(page, { installHint: true })
    const hint = page.getByTestId('home.installHint')

    // A calm card with the line and the drawing of Safari's Share → Add to Home Screen.
    await expect(hint).toBeVisible()
    await expect(page.getByTestId('home.installHintTitle')).toHaveText(en.home.installHint.title)
    await expect(page.getByTestId('home.installHintText')).toHaveText(en.home.installHint.text)
    await expect(page.getByTestId('home.installHintArt')).toContainText(en.home.installHint.addToHome)
    // It sits on Home, not in front of it: the way to Search is still there.
    await expect(page.getByTestId('home.search')).toBeVisible()

    await page.getByTestId('home.installHintDismiss').click()
    await expect(hint).toBeHidden()
    const dismissedAt = Number(await page.evaluate((key) => localStorage.getItem(key), INSTALL_HINT_KEY))
    expect(Date.now() - dismissedAt).toBeLessThan(60_000)

    // Gone after a reload, and still gone on the next day.
    await page.reload()
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(hint).toBeHidden()

    // Eight days later it asks once more.
    await page.evaluate(
      (key) => localStorage.setItem(key, String(Date.now() - 8 * 24 * 60 * 60 * 1000)),
      INSTALL_HINT_KEY,
    )
    await page.reload()
    await expect(hint).toBeVisible()
  })

  test('is gone in the installed app', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(page.getByTestId('home.installHint')).toBeHidden()
  })

  test('is gone when the display mode is standalone', async ({ page }) => {
    await page.addInitScript(() => {
      const matchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => {
        const list = matchMedia(query)
        // The real list, so its listeners keep working; only this query answers yes.
        if (query.includes('display-mode: standalone')) Object.defineProperty(list, 'matches', { value: true })
        return list
      }
    })
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(page.getByTestId('home.installHint')).toBeHidden()
  })

  test('shows no install row in the avatar menu (iOS never fires beforeinstallprompt)', async ({ page }) => {
    await signedIn(page, { installHint: true })
    await page.getByTestId('shell.avatar').click()
    await expect(page.getByTestId('shell.signOut')).toBeVisible()
    await expect(page.getByTestId('shell.install')).toHaveCount(0)
  })
})

test.describe('Safari on an iPad that asks for the desktop site', () => {
  test.use({ userAgent: IPADOS_DESKTOP })

  test('is told apart from a Mac by its touch screen', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel' })
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 })
    })
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.installHint')).toBeVisible()
  })

  test('is a Mac without one: no hint', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel' })
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 0 })
    })
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(page.getByTestId('home.installHint')).toBeHidden()
  })
})

test.describe('Chrome on an iPhone', () => {
  test.use({ userAgent: IPHONE_CHROME })

  test('shows no hint: its Share menu is not Safari\'s', async ({ page }) => {
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(page.getByTestId('home.installHint')).toBeHidden()
  })
})

test.describe('Chrome on Android', () => {
  test.use({ userAgent: ANDROID_CHROME })

  test('shows no hint and no install row until Chrome offers the install, then the row opens its dialog', async ({ page }) => {
    // Chrome's event, stood in: it can be asked once and answers with a choice.
    await page.addInitScript(() => {
      const w = window as unknown as { __installPrompts: number }
      w.__installPrompts = 0
      // Fired the way Chrome does, some time after load and before any screen of the app is up.
      setTimeout(() => {
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
          prompt: async () => void (w.__installPrompts += 1),
          userChoice: Promise.resolve({ outcome: 'accepted' as const }),
        })
        window.dispatchEvent(event)
      }, 2_500)
    })
    await signedIn(page, { installHint: true })
    await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
    await expect(page.getByTestId('home.installHint')).toBeHidden()

    await page.getByTestId('shell.avatar').click()
    await expect(page.getByTestId('shell.install')).toHaveText(en.shell.install)

    await page.getByTestId('shell.install').click()
    await expect(page.getByTestId('shell.menu')).toBeHidden()
    expect(await page.evaluate(() => (window as unknown as { __installPrompts: number }).__installPrompts)).toBe(1)

    // Chrome asks once per event: the row is gone until it offers again.
    await page.getByTestId('shell.avatar').click()
    await expect(page.getByTestId('shell.signOut')).toBeVisible()
    await expect(page.getByTestId('shell.install')).toHaveCount(0)
  })

  test('shows no install row when Chrome never offers one', async ({ page }) => {
    await signedIn(page, { installHint: true })
    await page.getByTestId('shell.avatar').click()
    await expect(page.getByTestId('shell.signOut')).toBeVisible()
    await expect(page.getByTestId('shell.install')).toHaveCount(0)
  })
})

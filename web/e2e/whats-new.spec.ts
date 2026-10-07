import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { minorVersion, releaseNotes, shouldShowNotes, WHATS_NEW_KEY } from '../app/utils/changelog'
import { openProfile, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * What's new (docs/OPERATIONS.md, "Releases"; composables/useWhatsNew.ts): the build
 * carries its release's notes from CHANGELOG.md. A device that saw an older release
 * gets them once by itself when the release has something new; a new device only
 * starts counting; the Profile's Version · What's new line opens them any time.
 * The notes and the version are this checkout's (version.txt), so the flow holds
 * for every release; which of the two ways the sheet comes is decided by the rules
 * in tests/changelog.test.ts.
 */
const root = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
const notes = releaseNotes(root('CHANGELOG.md'), root('version.txt'))
const title = en.whatsNew.title.replace('{version}', minorVersion(notes.version))
const itemCount = notes.sections.reduce((sum, s) => sum + s.items.length, 0)

test('a new device starts counting quietly; the Profile opens the notes', async ({ page }) => {
  await signedIn(page)
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), WHATS_NEW_KEY)).toBe(notes.version)
  await expect(page.getByTestId('whatsNew')).toBeHidden()

  await openProfile(page)
  const line = page.getByTestId('profile.whatsNew')
  await expect(line).toContainText(en.profile.account.version.replace('{version}', notes.version))
  await expect(line).toContainText(en.profile.account.whatsNew)
  await line.click()
  await expect(page.getByTestId('whatsNew')).toBeVisible()
  await expect(page.getByTestId('whatsNew.sheetTitle')).toHaveText(title)
  await expect(page.getByTestId('whatsNew.version')).toHaveText(en.whatsNew.version.replace('{version}', notes.version))
  await expect(page.getByTestId('whatsNew.item')).toHaveCount(itemCount)
  if (itemCount === 0) await expect(page.getByTestId('whatsNew.none')).toHaveText(en.whatsNew.none)
  await untilStill(page)
  await page.getByTestId('whatsNew.action').click()
  await expect(page.getByTestId('whatsNew')).toBeHidden()
})

test('after an update the notes come once by themselves, when there is something new', async ({ page }) => {
  // This device last ran an older release (set once, before the app's first load).
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('whatsNew.seeded')) return
    sessionStorage.setItem('whatsNew.seeded', '1')
    localStorage.setItem(key, '0.0.1')
  }, WHATS_NEW_KEY)
  await signedIn(page)
  const sheet = page.getByTestId('whatsNew')

  if (shouldShowNotes('0.0.1', notes)) {
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('whatsNew.sheetTitle')).toHaveText(title)
    await expect(page.getByTestId('whatsNew.item')).toHaveCount(itemCount)
    await untilStill(page)
    await page.getByTestId('whatsNew.action').click()
    await expect(sheet).toBeHidden()
  } else {
    await untilStill(page)
    await expect(sheet).toBeHidden()
  }
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), WHATS_NEW_KEY)).toBe(notes.version)

  // Once: not again on the next start.
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await untilStill(page)
  await expect(sheet).toBeHidden()
})

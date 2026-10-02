import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }

// The scaffold's only flow: the app boots on a phone in WebKit and the start
// page renders its copy from the message file. The core-loop flow replaces it
// and runs in CI (#16).
test('the start page renders', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('start.title')).toHaveText(en.app.name)
  await expect(page.getByTestId('start.tagline')).toHaveText(en.start.tagline)
  await expect(page).toHaveTitle(en.app.name)
})

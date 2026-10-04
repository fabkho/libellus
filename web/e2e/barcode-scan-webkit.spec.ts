import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'
import { FRAME, probe, stubScanner, watchDecoder } from './scanner-stub'

/**
 * The barcode scanner on WebKit, the engine of Safari on iPhone and of the
 * installed iOS app (#92). WebKit has no `BarcodeDetector`, so this is the
 * WebAssembly reader, for real: the decoder is fetched when the scanner opens
 * and decodes the pixels of a stubbed camera's frames (a picture of Piranesi's
 * barcode, tests/fixtures/barcode). Only the camera itself is a stand-in
 * (e2e/scanner-stub.ts). The iOS Simulator run of the same is in docs/parity.md.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

async function openScanner(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await page.getByTestId('search.scan').click()
  await expect(page.getByTestId('scan.overlay')).toBeVisible()
}

test('no BarcodeDetector here, and the camera button shows all the same', async ({ page }) => {
  await stubScanner(page, { formats: null, vibrate: false })
  await signedIn(page)
  expect(await page.evaluate(() => 'BarcodeDetector' in window)).toBe(false)
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.scan')).toBeVisible()
})

test('the decoder is fetched when the scanner opens, and reads the book from the camera frames', async ({ page }) => {
  const decoder = watchDecoder(page)
  await stubScanner(page, { formats: null, picture: FRAME, vibrate: false })
  await signedIn(page)
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.scan')).toBeVisible()
  expect(decoder).toEqual([])
  await page.getByTestId('search.scan').click()
  await expect(page.getByTestId('scan.overlay')).toBeVisible()

  await expect(page).toHaveURL(/\/book\/(apple-1506831259|[0-9a-f-]{36})$/, { timeout: 30_000 })
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  expect(decoder.length).toBeGreaterThan(0)
  // The camera is off again, and no torch was ever offered (iOS has none).
  expect(await probe(page, '__running')).toBe(0)
})

test('no torch button: the camera of an iPhone has none to offer', async ({ page }) => {
  await stubScanner(page, { formats: null, vibrate: false, torch: false })
  await signedIn(page)
  await openScanner(page)
  await expect(page.getByTestId('scan.hint')).toBeVisible()
  await expect(page.getByTestId('scan.torch')).toHaveCount(0)
  await page.getByTestId('scan.close').click()
  await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
})

test('permission denied and no camera, on WebKit', async ({ page }) => {
  await stubScanner(page, { formats: null, camera: 'denied', vibrate: false })
  await signedIn(page)
  await openScanner(page)
  await expect(page.getByTestId('scan.denied')).toHaveText(en.search.scan.deniedTitle)
  await page.getByTestId('scan.dismiss').click()
  await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
  await page.evaluate(() => ((window as unknown as { __camera: string }).__camera = 'none'))
  await page.getByTestId('search.scan').click()
  await expect(page.getByTestId('scan.none')).toHaveText(en.search.scan.noneTitle)
})

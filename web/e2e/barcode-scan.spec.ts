import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'
import { FRAME, probe, see, stubScanner, watchDecoder } from './scanner-stub'

/**
 * Scanning a book's barcode (#92): a camera button in the search overlay's query
 * row, opening a full-screen scanner. No camera is involved here: the page gets a
 * stubbed `getUserMedia` (a canvas stream, with a torch and a count of the tracks
 * still running), set up before the app loads. Two readers read its frames:
 * - the native one, a stubbed `BarcodeDetector` that "sees" whatever the flow puts
 *   in `window.__barcode` (Chrome on Android);
 * - the WebAssembly one (every other browser: iOS Safari, Firefox), which here
 *   really decodes a picture of the book's barcode that the stubbed camera shows
 *   (tests/fixtures/barcode), the decoder fetched as it would be on a phone.
 * The real devices are checked by hand (docs/parity.md, Barcode scanner).
 *
 * Chromium, where `BarcodeDetector` can be stood in for or taken away.
 */
test.use({ browserName: 'chromium' })

async function openScanner(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await page.getByTestId('search.scan').click()
  await expect(page.getByTestId('scan.overlay')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test.describe('where the button shows', () => {
  test('hidden without a camera API', async ({ page }) => {
    await stubScanner(page, { noCamera: true })
    await signedIn(page)
    await page.getByTestId('shell.tab.search').click()
    await expect(page.getByTestId('search.query')).toBeFocused()
    await expect(page.getByTestId('search.scan')).toHaveCount(0)
  })

  test('shown without a BarcodeDetector (the WebAssembly reader), and where it cannot read EAN-13', async ({ page }) => {
    await stubScanner(page, { formats: null })
    await signedIn(page)
    await page.getByTestId('shell.tab.search').click()
    await expect(page.getByTestId('search.scan')).toBeVisible()
    await page.reload()
    await page.evaluate(() => ((window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class { static getSupportedFormats = async () => ['qr_code'] }))
    await page.getByTestId('shell.tab.search').click()
    await expect(page.getByTestId('search.scan')).toBeVisible()
  })

  test('shown with a query row that is empty, and gives way to Clear once there is text', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    await page.getByTestId('shell.tab.search').click()
    await expect(page.getByTestId('search.scan')).toHaveAttribute('aria-label', en.search.scan.open)
    await page.getByTestId('search.query').fill('Pira')
    await expect(page.getByTestId('search.scan')).toHaveCount(0)
    await expect(page.getByTestId('search.clear')).toBeVisible()
  })
})

test.describe('the reader', () => {
  test('native where the browser can read EAN-13: the decoder is never fetched', async ({ page }) => {
    const decoder = watchDecoder(page)
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    await expect.poll(() => probe(page, '__detectorFormats')).toEqual(['ean_13', 'code_128', 'code_39'])
    await see(page, '9783641264864')
    await expect(page).toHaveURL(/\/book\//)
    expect(decoder).toEqual([])
  })

  for (const [name, stub] of [
    ['no BarcodeDetector (iOS Safari, Firefox)', { formats: null }],
    ['a BarcodeDetector that cannot read EAN-13', { formats: ['qr_code'] }],
  ] as const) {
    test(`WebAssembly where there is ${name}: fetched when the scanner opens, reads the picture, opens the book`, async ({ page }) => {
      const decoder = watchDecoder(page)
      await stubScanner(page, { ...stub, picture: FRAME })
      await signedIn(page)
      // Not part of the app: nothing of it is fetched until the scanner opens.
      await page.getByTestId('shell.tab.search').click()
      await expect(page.getByTestId('search.scan')).toBeVisible()
      expect(decoder).toEqual([])
      await page.getByTestId('search.scan').click()
      await expect(page.getByTestId('scan.overlay')).toBeVisible()

      // Piranesi, German edition, read from the pixels of the camera's frames.
      await expect(page).toHaveURL(/\/book\/(apple-1506831259|[0-9a-f-]{36})$/, { timeout: 20_000 })
      await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
      expect(decoder.some((path) => path.endsWith('.wasm') || /wasm/.test(path))).toBe(true)
      expect(await probe(page, '__detectorFormats')).toBeUndefined()
      expect(await probe(page, '__vibrate')).toEqual([8])
      expect(await probe(page, '__running')).toBe(0)
    })
  }

  test('WebAssembly: a frame with no barcode in it finds nothing, and the camera keeps running', async ({ page }) => {
    await stubScanner(page, { formats: null })
    await signedIn(page)
    await openScanner(page)
    await expect(page.getByTestId('scan.hint')).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('scan.overlay')).toBeVisible()
    expect(await probe(page, '__running')).toBe(1)
  })

  test('WebAssembly decoder that cannot be fetched (offline the first time): the no-camera state, camera off', async ({ page }) => {
    await stubScanner(page, { formats: null, picture: FRAME })
    await signedIn(page)
    await page.route(/zxing/i, (route) => route.abort())
    await openScanner(page)
    await expect(page.getByTestId('scan.none')).toBeVisible()
    expect(await probe(page, '__running')).toBe(0)
  })
})

test('a barcode found opens the book page, ticks, and switches the camera off', async ({ page }) => {
  await stubScanner(page)
  await signedIn(page)
  await openScanner(page)

  await expect(page.getByTestId('scan.hint')).toHaveText(en.search.scan.hint)
  await expect(page.getByTestId('scan.video')).toBeVisible()
  // The back camera, the book's own formats.
  await expect.poll(() => probe(page, '__detectorFormats')).toEqual(['ean_13', 'code_128', 'code_39'])
  expect(await probe(page, '__running')).toBe(1)

  // Piranesi, German edition: an EAN-13 on the back of the book.
  await see(page, '9783641264864')
  await expect(page).toHaveURL(/\/book\/(apple-1506831259|[0-9a-f-]{36})$/)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
  await expect(page.getByTestId('search.overlay')).toHaveCount(0)
  expect(await probe(page, '__vibrate')).toEqual([8])
  expect(await probe(page, '__running')).toBe(0)
})

test('an ISBN-10 on the label finds the same book', async ({ page }) => {
  await stubScanner(page)
  await signedIn(page)
  await openScanner(page)
  // 3641264863 is the ISBN-10 of 978-3-641-26486-4.
  await see(page, '3641264863')
  await expect(page).toHaveURL(/\/book\/(apple-1506831259|[0-9a-f-]{36})$/)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
})

test('a book nothing knows opens the search with its ISBN', async ({ page }) => {
  await stubScanner(page)
  await signedIn(page)
  await openScanner(page)
  await see(page, '9780141036144')
  await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toHaveValue('9780141036144')
  await expect(page.getByTestId('search.noResults')).toBeVisible()
  expect(await probe(page, '__running')).toBe(0)
})

test('a code that is not a book is told so, and scanning goes on', async ({ page }) => {
  await stubScanner(page)
  await signedIn(page)
  await openScanner(page)
  await see(page, '4006381333931')
  await expect(page.getByTestId('scan.notBook')).toHaveText(en.search.scan.notBook)
  expect(await probe(page, '__running')).toBe(1)
  await see(page, '9783641264864')
  await expect(page).toHaveURL(/\/book\//)
})

test('the light, where the camera has one', async ({ page }) => {
  await stubScanner(page)
  await signedIn(page)
  await openScanner(page)
  const torch = page.getByTestId('scan.torch')
  await expect(torch).toHaveAttribute('aria-label', en.search.scan.torchOn)
  await torch.click()
  await expect(torch).toHaveAttribute('aria-label', en.search.scan.torchOff)
  await expect(torch).toHaveAttribute('aria-pressed', 'true')
  expect(await probe(page, '__constraints')).toEqual([{ advanced: [{ torch: true }] }])
  await torch.click()
  await expect(torch).toHaveAttribute('aria-pressed', 'false')
})

test.describe('closing', () => {
  test('✕ closes the scanner, not the search; the camera is off', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    await page.getByTestId('scan.close').click()
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    await expect(page.getByTestId('search.overlay')).toBeVisible()
    expect(await probe(page, '__running')).toBe(0)
  })

  test('the system Back closes the scanner first, then the search', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    const url = page.url()
    await openScanner(page)
    await page.goBack()
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    await expect(page.getByTestId('search.overlay')).toBeVisible()
    expect(await probe(page, '__running')).toBe(0)
    await page.goBack()
    await expect(page.getByTestId('search.overlay')).toHaveCount(0)
    expect(page.url()).toBe(url)
  })

  test('Escape closes only the scanner', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    await expect(page.getByTestId('search.overlay')).toBeVisible()
  })

  test('the app going to the background switches the camera off', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    expect(await probe(page, '__running')).toBe(0)
  })

  test('a change of page switches the camera off', async ({ page }) => {
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    // The palette's Library tab, behind the scanner: a navigation started from anywhere closes it.
    await page.getByTestId('search.tab.library').evaluate((link: HTMLElement) => link.click())
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    expect(await probe(page, '__running')).toBe(0)
  })
})

test.describe('states', () => {
  test('permission denied: says why, and closes', async ({ page }) => {
    await stubScanner(page, { camera: 'denied' })
    await signedIn(page)
    await openScanner(page)
    await expect(page.getByTestId('scan.denied')).toHaveText(en.search.scan.deniedTitle)
    await expect(page.getByTestId('scan.blocked')).toContainText(en.search.scan.denied)
    await page.getByTestId('scan.dismiss').click()
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    await expect(page.getByTestId('search.overlay')).toBeVisible()
  })

  test('no camera: says so', async ({ page }) => {
    await stubScanner(page, { camera: 'none' })
    await signedIn(page)
    await openScanner(page)
    await expect(page.getByTestId('scan.none')).toHaveText(en.search.scan.noneTitle)
    await expect(page.getByTestId('scan.torch')).toHaveCount(0)
    await page.getByTestId('scan.close').click()
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
  })

  test('while the permission prompt is up, and closed before it is answered', async ({ page }) => {
    await stubScanner(page)
    await page.addInitScript(() => {
      const ask = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = (constraints) => new Promise((resolve) => setTimeout(() => resolve(ask(constraints)), 1500))
    })
    await signedIn(page)
    await openScanner(page)
    await expect(page.getByTestId('scan.asking')).toContainText(en.search.scan.askingTitle)
    await page.getByTestId('scan.close').click()
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    // The camera that arrives after the member closed it is stopped at once.
    await expect.poll(() => probe(page, '__opened')).toBe(1)
    await expect.poll(() => probe(page, '__running')).toBe(0)
  })

  test('offline: a note, and the ISBN goes to the search of her own Library', async ({ page, context }) => {
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    await expect(page.getByTestId('scan.offline')).toHaveCount(0)
    await context.setOffline(true)
    await expect(page.getByTestId('scan.offline')).toHaveText(en.search.scan.offline)
    await see(page, '9783641264864')
    await expect(page.getByTestId('scan.overlay')).toHaveCount(0)
    await expect(page.getByTestId('search.query')).toHaveValue('9783641264864')
    await context.setOffline(false)
  })

  test('Reduce Motion: the scan line holds still', async ({ page }) => {
    // It starts with motion (the config has Reduce Motion on), then turns Reduce Motion on.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await stubScanner(page)
    await signedIn(page)
    await openScanner(page)
    const line = page.getByTestId('scan.frame').locator('.line')
    await expect(line).toHaveCSS('animation-name', /^sweep/)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(line).toHaveCSS('animation-name', 'none')
  })
})

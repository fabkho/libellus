import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { openReader, shelve, withEbook } from './readerSupport'
import { expectAccessible, recordedApple, signedIn, untilStill } from './support'

/**
 * Accessibility of the built-in reader (#131; docs/ACCESSIBILITY.md): axe-core in its dark
 * room only (one theme, as in e2e/a11y.spec.ts), on a phone (412 × 915): the page with its chrome, the Aa sheet,
 * Contents, the selection's bubble and the Translate and Define sheets it opens. Its own file
 * because it runs in Chromium (the ebook is kept in the origin private file system, which
 * Playwright's WebKit does not write, as in e2e/reader.spec.ts); the rest of the flow is
 * e2e/a11y.spec.ts.
 */

test.use({ browserName: 'chromium' })

/** Opens a sheet with a tap and waits for it to be in place. */
async function openSheet(page: Page, opener: string, sheet: string) {
  await page.getByTestId(opener).first().click()
  await expect(page.getByTestId(sheet)).toBeVisible()
  await untilStill(page)
}

async function closeSheet(page: Page, sheet: string) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(sheet)).toBeHidden()
  await untilStill(page)
}

/** Answers Translate's and Define's two services, which the flows never reach live: a translation, and a word with an example. */
async function recordedLookups(page: Page) {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  // Chrome's own on-device translator would be asked first, and may wait for its model: the service answers.
  await page.addInitScript(() => Reflect.deleteProperty(globalThis, 'Translator'))
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers })
      : route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ responseData: { translatedText: 'Eines Morgens' }, responseStatus: 200 }) }),
  )
  await page.route('https://en.wiktionary.org/**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers })
      : route.fulfill({
          status: 200,
          headers,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'The time of day when the sun rises.', examples: ['<i>One morning, he woke early.</i>'] }] }],
          }),
        }),
  )
}

/**
 * The reader (#131) in its dark room: the page with its chrome (the capsule, the folio), the Aa
 * sheet, Contents, the selection's bubble and the Translate and Define sheets that it opens. The
 * room is the reader's own setting (sepia by default), so the app's theme stays light; Chromium,
 * as the ebook is kept in the origin private file system (e2e/reader.spec.ts).
 */
test.describe('accessibility, the reader', { tag: '@full' }, () => {
  test.use({ viewport: { width: 412, height: 915 } })

  for (const room of ['dark'] as const) {
    test(`the reader in the ${room} room: chrome, Aa, Contents, search, a selection, Translate and Define`, async ({ page }) => {
      await recordedApple(page)
      await recordedLookups(page)
      const member = await signedIn(page)
      const entry = await shelve(member, 'Metamorphosis', 'reading')
      await withEbook(page, entry)
      const reader = await openReader(page)
      const middle = { x: 206, y: 400 }

      // The room is chosen in the Aa sheet, as a reader does (sepia is the one it opens in).
      await reader.getByTestId('reader.page').click({ position: middle })
      await expect(page.getByTestId('reader.type')).toBeVisible()
      await openSheet(page, 'reader.type', 'readerType')
      await page.getByTestId(`readerType.theme.${room}`).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', room)
      await expectAccessible(page, `the reader's Aa sheet, ${room}`)
      await closeSheet(page, 'readerType')

      // The capsule over the page, and the folio when it has gone.
      await untilStill(page)
      if (!(await page.getByTestId('reader.contents').isVisible())) await reader.getByTestId('reader.page').click({ position: middle })
      await expect(page.getByTestId('reader.contents')).toBeVisible()
      await expectAccessible(page, `the reader's chrome, ${room}`)

      await openSheet(page, 'reader.contents', 'readerContents')
      await expectAccessible(page, `the reader's Contents, ${room}`)
      await closeSheet(page, 'readerContents')

      // Search in the book: its palette, then with results.
      await untilStill(page)
      if (!(await page.getByTestId('reader.search').isVisible())) await reader.getByTestId('reader.page').click({ position: middle })
      await page.getByTestId('reader.search').click()
      await expect(page.getByTestId('readerSearch')).toBeVisible()
      await expectAccessible(page, `the reader's search, ${room}`)
      await page.getByTestId('readerSearch.query').fill('Gregor')
      await expect(page.getByTestId('readerSearch.count')).toBeVisible()
      await expectAccessible(page, `the reader's search results, ${room}`)
      await page.getByTestId('readerSearch.cancel').click()
      await expect(page.getByTestId('readerSearch')).toBeHidden()
      await untilStill(page)

      // A word selected with a long-press: the bubble, then the sheets it opens.
      const word = async () => {
        for (const frame of page.frames()) {
          const p = frame.locator('p', { hasText: 'Gregor Samsa' }).first()
          if (frame.url().startsWith('blob:') && (await p.count())) return p
        }
        throw new Error('the page is not drawn yet')
      }
      await expect.poll(async () => word().then(() => true, () => false)).toBe(true)
      // The reader turns a phone's long-press into its own selection (a mouse's would not be taken).
      const box = (await (await word()).boundingBox())!
      const touch = await page.context().newCDPSession(page)
      const point = { x: box.x + 48, y: box.y + 12 }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await page.waitForTimeout(700)
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.getByTestId('reader.menu')).toBeVisible()
      await untilStill(page)
      await expectAccessible(page, `the reader's selection bubble, ${room}`)

      await page.getByTestId('reader.menu.translate').click()
      await expect(page.getByTestId('readerTranslate')).toBeVisible()
      await expect(page.getByTestId('readerTranslate.result')).toContainText('Eines Morgens')
      await expectAccessible(page, `the reader's Translate, ${room}`)
      await page.getByTestId('readerTranslate.define').click()
      await expect(page.getByTestId('readerDefine')).toBeVisible()
      await expect(page.getByTestId('readerDefine.translate')).toBeVisible()
      await untilStill(page)
      await expectAccessible(page, `the reader's Define, ${room}`)
    })
  }
})

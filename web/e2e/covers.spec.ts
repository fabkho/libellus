import { expect, type Page } from '@playwright/test'
import { appleCover } from '../tests/support/apple'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Covers in the search list (issue #63, docs/covers.md): the image a row asks
 * for, what it falls back to when that fails or comes back blank, and how the
 * list loads them. Apple and OpenLibrary answer from the flow's own answers.
 */

/** OpenLibrary's "no cover" image: a 1 × 1 GIF. */
const BLANK_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')

const item = (trackId: number, trackName: string, isbn13: string) => ({
  kind: 'ebook',
  trackId,
  trackName,
  artistName: 'Ada Example',
  releaseDate: '2020-01-01T00:00:00Z',
  // Apple names many artwork files after the edition's ISBN.
  artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/63/${trackId}/${isbn13}.jpg/100x100bb.jpg`,
})

async function answer(page: Page, items: ReturnType<typeof item>[]) {
  await page.route('https://itunes.apple.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: items }) }),
  )
  await page.route('https://openlibrary.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ docs: [], numFound: 0 }) }),
  )
}

/** A valid ISBN-13 from twelve digits (its check digit added). */
const isbn = (twelve: string) => {
  const sum = [...twelve].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0)
  return `${twelve}${(10 - (sum % 10)) % 10}`
}

const image = (body: Buffer, contentType = 'image/jpeg') => ({ status: 200, contentType, headers: { 'access-control-allow-origin': '*' }, body })
const missing = { status: 404, contentType: 'text/plain', body: 'Not found' }

/** The row's cover image (not the Placeholder), by the row's title. */
const coverOf = (page: Page, title: string) =>
  page.getByTestId('search.result').filter({ has: page.getByTestId('search.resultTitle').getByText(title, { exact: true }) }).locator('[data-cover]')

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test('a cover that fails or comes back blank falls back to the edition’s cover by ISBN, then the Placeholder', async ({ page }) => {
  await signedIn(page)
  await answer(page, [item(990000006301, 'Quillwort Broken', '9783150160671'), item(990000006302, 'Quillwort Blank', '9780593983768')])
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\/.*\/990000006301\//, (route) => route.fulfill(missing))
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\/.*\/990000006302\//, (route) => route.fulfill(image(BLANK_GIF, 'image/gif')))
  await page.route((url) => url.href === 'https://covers.openlibrary.org/b/isbn/9783150160671-M.jpg?default=false', (route) => route.fulfill(image(appleCover())))
  await page.route((url) => url.href === 'https://covers.openlibrary.org/b/isbn/9780593983768-M.jpg?default=false', (route) => route.fulfill(missing))

  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('quillwort')
  await expect(page.getByTestId('search.result')).toHaveCount(2)

  // Apple's artwork is gone: OpenLibrary's cover of the same ISBN shows instead.
  const broken = coverOf(page, 'Quillwort Broken').locator('img')
  await expect(broken).toHaveAttribute('src', 'https://covers.openlibrary.org/b/isbn/9783150160671-M.jpg?default=false')
  await expect.poll(() => broken.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(1)
  // A 1 × 1 stand-in is no cover, and OpenLibrary has none: the Placeholder.
  await expect(coverOf(page, 'Quillwort Blank').locator('img')).toHaveCount(0)
  // The row writes the title beside it, so the cover itself is decorative (UiCover `decorative`).
  await expect(coverOf(page, 'Quillwort Blank').locator('.cloth')).toBeVisible()
})

test('the first covers are asked for first, the rest a list height before they scroll in', async ({ page }) => {
  await signedIn(page)
  const items = Array.from({ length: 40 }, (_, i) => item(990000006400 + i, `Quillwort ${String(i + 1).padStart(2, '0')}`, isbn(`978300006${String(i).padStart(3, '0')}`)))
  await answer(page, items)

  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('quillwort')
  await expect(page.getByTestId('search.result')).toHaveCount(40)
  const covers = page.getByTestId('search.result').locator('[data-cover] img')

  // The bottom rows, the ones above the keyboard, go first and at once; the
  // next ones load before they are seen; the far end waits.
  for (const i of [0, 5]) {
    await expect(covers.nth(i)).toHaveAttribute('fetchpriority', 'high')
    await expect(covers.nth(i)).toHaveAttribute('loading', 'eager')
  }
  await expect(covers.nth(6)).not.toHaveAttribute('fetchpriority', 'high')
  const list = page.getByTestId('search.results')
  const listBox = (await list.boundingBox())!
  const nearIndex = await covers.evaluateAll(
    (images, top) => images.findLastIndex((image) => image.getBoundingClientRect().bottom > top - 200),
    listBox.y,
  )
  expect(nearIndex).toBeGreaterThan(6)
  await expect(covers.nth(nearIndex)).toHaveAttribute('loading', 'eager')
  await expect(covers.nth(39)).toHaveAttribute('loading', 'lazy')

  // Scrolled to its far end, the last cover has been asked for too.
  await list.evaluate((el) => el.scrollTo({ top: -el.scrollHeight }))
  await expect(covers.nth(39)).toHaveAttribute('loading', 'eager')
})

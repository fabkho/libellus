import { expect, type Page } from '@playwright/test'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * The book page with long text (polish T1): a Placeholder cover keeps its type
 * inside the inset rule at every size (below `md` there is none), the hero
 * title is cut at three lines and a tap shows all of it, and a long Collection
 * name stays inside its chip. A Manual book has the Placeholder cover, so the
 * flow makes one with a long title and two long author names.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const TITLE =
  'I Am Legend: Richard Matheson’s novel and Francis Lawrence’s film adaptation of 2007, a comparison across the decades'
const AUTHORS = 'Henrietta Valdés-Okonkwo & Bartholomew Fitzgerald'
const COLLECTION = 'Summer by the lake, the long ones I keep meaning to start'

async function addLongBook(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('qxzvwlmbrt')
  await page.getByTestId('search.addManually').click()
  await page.getByTestId('manual.title').fill(TITLE)
  await page.getByTestId('manual.author').fill(AUTHORS)
  await page.getByTestId('manual.action').click()
  await expect(page.getByTestId('manual')).toBeHidden()
  await expect(page).toHaveURL(/\/book\/[0-9a-f-]{36}$/)
}

test('a Placeholder cover, a long title and a long Collection name stay inside their boxes', async ({ page }) => {
  await signedIn(page)
  await addLongBook(page)

  // The hero's Placeholder: the title is cut inside the cover, the author is on it.
  const hero = page.getByTestId('book.hero').getByRole('img', { name: TITLE })
  await expect(hero).toBeVisible()
  const cover = (await hero.boundingBox())!
  for (const text of [hero.locator('.cloth-title'), hero.locator('.cloth-author')]) {
    const box = (await text.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(cover.x)
    expect(box.x + box.width).toBeLessThanOrEqual(cover.x + cover.width)
    expect(box.y + box.height).toBeLessThanOrEqual(cover.y + cover.height)
  }
  await expect(hero.locator('.cloth-author')).toBeVisible()

  // The page title: three lines, the full title is its `title`; a tap shows all of it.
  const title = page.getByTestId('book.title')
  await expect(title).toHaveAttribute('title', TITLE)
  const lineHeight = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  const cut = (await title.boundingBox())!
  expect(cut.height).toBeLessThanOrEqual(lineHeight * 3 + 1)
  await title.click()
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(cut.height)
  await title.click()
  await expect.poll(async () => (await title.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 3 + 1)

  // A Collection with a long name: the chip stays in the column and cuts the name.
  await page.getByTestId('book.addToCollection').click()
  await page.getByTestId('picker.new').click()
  await page.getByTestId('picker.newName').fill(COLLECTION)
  await page.getByTestId('picker.create').click()
  await page.getByTestId('picker.action').click()
  await expect(page.getByTestId('picker')).toBeHidden()
  const chip = page.getByTestId('book.collection')
  await expect(chip).toHaveAttribute('title', COLLECTION)
  const [chipBox, viewport] = [(await chip.boundingBox())!, page.viewportSize()!]
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(viewport.width)
  expect(chipBox.height).toBeLessThan(44)
  expect(await chip.locator('span').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

  // Below `md` a Placeholder has no type: the Library row's cover is cloth, rule and mark.
  await page.getByTestId('shell.tab.library').click()
  const row = page.getByTestId('library.entry').getByRole('img', { name: TITLE })
  await expect(row).toBeVisible()
  await expect(row.locator('.cloth-title')).toHaveCount(0)
  await expect(row.locator('.cloth-author')).toHaveCount(0)
  await expect(row.locator('.mark')).toHaveCount(1)
})

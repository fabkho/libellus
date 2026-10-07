import { expect, type Browser, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { METAMORPHOSIS_GUTENBERG, type EpubSpec } from '../tests/support/epub'
import type { TestMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { openReader, shelve, withEbook } from './readerSupport'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'
import { expectAccessible, recordedApple, signedIn, signedInAs, untilStill } from './support'

/**
 * The reader's highlights are kept on the server, not only on the device (#131).
 * Chromium, as the copy lives in the origin private file system (e2e/reader.spec.ts).
 *
 * - A highlight made on one device is there on a fresh device (new storage, signed in
 *   again) that holds the same file, and a removal on it follows to the first.
 * - A fresh device with another copy of the book (another file) does not place it: the
 *   Contents sheet lists it under *Highlights from another copy*.
 * - A highlight made offline waits in the outbox and reaches the server once back online.
 * - Highlights that only existed on the device before the sync are uploaded on the next open.
 */

test.use({ browserName: 'chromium' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const stored = (entryId: string) =>
  sql<{ id: string; color: string; excerpt: string; file_hash: string; deleted_at: string | null }>(
    'select id, color, excerpt, file_hash, deleted_at from public.reader_highlights where entry_id = $1 order by created_at',
    [entryId],
  )

/** The words of the first paragraph of Metamorphosis, selected with a phone's long press (the reader's own selection). */
async function selectWord(page: Page) {
  const word = async () => {
    for (const frame of page.frames()) {
      const p = frame.locator('p', { hasText: 'Gregor Samsa' }).first()
      if (frame.url().startsWith('blob:') && (await p.count())) return p
    }
    throw new Error('the page is not drawn yet')
  }
  await expect.poll(async () => word().then(() => true, () => false)).toBe(true)
  const box = (await (await word()).boundingBox())!
  const touch = await page.context().newCDPSession(page)
  const point = { x: box.x + 48, y: box.y + 12 }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(700)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByTestId('reader.menu')).toBeVisible()
  await untilStill(page)
}

/** What the open reader draws, as the engine (dev builds expose it) holds it. */
const drawn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __readerEngine?: { highlights: { color: string; text: string }[] } }).__readerEngine?.highlights ?? [])

/** Another phone: its own storage, the same member signed in there with a code of its own, the same ebook linked. */
async function otherPhone(browser: Browser, page: Page, member: TestMember, entry: Parameters<typeof withEbook>[1], spec: EpubSpec = METAMORPHOSIS_GUTENBERG) {
  const context = await browser.newContext({
    baseURL: String(test.info().project.use.baseURL),
    viewport: page.viewportSize(),
    hasTouch: true,
    isMobile: true,
  })
  const phone = await context.newPage()
  await recordedApple(phone)
  await phone.addInitScript((key) => localStorage.setItem(key, String(Date.now())), INSTALL_HINT_KEY)
  await signedInAs(phone, member.email)
  await withEbook(phone, entry, spec)
  return { phone, context }
}

test('a highlight made on one device is on a fresh device with the same file, and a removal follows', async ({ page, browser }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)
  await openReader(page)

  await selectWord(page)
  await page.getByTestId('reader.menu.color.sky').click()
  await expect.poll(async () => (await stored(entry.id)).map((h) => h.color)).toEqual(['sky'])
  const [row] = await stored(entry.id)
  expect(row!.excerpt.length).toBeGreaterThan(0)
  expect(row!.deleted_at).toBeNull()

  // A fresh device, same file: the highlight is drawn when the book opens.
  const second = await otherPhone(browser, page, member, entry)
  await openReader(second.phone)
  await expect.poll(async () => (await drawn(second.phone)).map((h) => h.color)).toEqual(['sky'])

  // Removed there (the same words, Remove): a tombstone with none of her words on the server.
  await second.phone.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await selectWord(second.phone)
  await expect(second.phone.getByTestId('reader.menu.remove')).toBeVisible()
  await second.phone.getByTestId('reader.menu.remove').click()
  await expect.poll(async () => (await stored(entry.id))[0]?.deleted_at).not.toBeNull()
  expect((await stored(entry.id))[0]!.excerpt).toBe('')
  await expect.poll(async () => (await drawn(second.phone)).length).toBe(0)

  // The first device, still open, reads the server again as the app comes back to the foreground, and lifts it.
  expect(await drawn(page)).toHaveLength(1)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(async () => (await drawn(page)).length).toBe(0)
  await second.context.close()
})

test('a fresh device with another copy of the book lists the highlight under Highlights from another copy, unplaced', async ({ page, browser }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)
  await openReader(page)
  await selectWord(page)
  await page.getByTestId('reader.menu.color.rose').click()
  await expect.poll(async () => (await stored(entry.id)).length).toBe(1)
  const [row] = await stored(entry.id)

  // Another edition: a different file, so another fingerprint.
  const other = await otherPhone(browser, page, member, entry, { ...METAMORPHOSIS_GUTENBERG, publisher: 'Another publisher', identifiers: [{ value: 'urn:uuid:another-copy' }] })
  const phone = other.phone
  await openReader(phone)
  await expect.poll(async () => (await stored(entry.id))[0]?.file_hash).toBe(row!.file_hash)
  expect(await drawn(phone)).toEqual([])

  await phone.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await phone.getByTestId('reader.contents').click()
  await expect(phone.getByTestId('readerContents')).toBeVisible()
  await expect(phone.getByTestId('readerContents.otherCopy')).toContainText(en.reader.contentsSheet.otherCopy.title)
  await expect(phone.getByTestId('readerContents.otherCopy.item')).toHaveCount(1)
  await expect(phone.getByTestId('readerContents.otherCopy.item')).toContainText(row!.excerpt.trim().slice(0, 12))

  // The list is part of the Contents sheet: accessible in each room (sepia is the one the reader opens in).
  await expectAccessible(phone, 'the reader\'s Contents with highlights from another copy, sepia')
  for (const room of ['light', 'dark'] as const) {
    await phone.keyboard.press('Escape')
    await expect(phone.getByTestId('readerContents')).toBeHidden()
    await untilStill(phone)
    await phone.getByTestId('reader.type').click()
    await expect(phone.getByTestId('readerType')).toBeVisible()
    await untilStill(phone)
    await phone.getByTestId(`readerType.theme.${room}`).click()
    await phone.keyboard.press('Escape')
    await expect(phone.getByTestId('readerType')).toBeHidden()
    await untilStill(phone)
    await phone.getByTestId('reader.contents').click()
    await expect(phone.getByTestId('readerContents.otherCopy')).toBeVisible()
    await expectAccessible(phone, `the reader's Contents with highlights from another copy, ${room}`)
  }

  // It can be removed from the list: a tombstone on the server, none of her words kept.
  await phone.getByTestId('readerContents.otherCopy.remove').click()
  await expect(phone.getByTestId('readerContents.otherCopy')).toHaveCount(0)
  await expect.poll(async () => (await stored(entry.id))[0]?.deleted_at).not.toBeNull()
  expect((await stored(entry.id))[0]!.excerpt).toBe('')
  await other.context.close()
})

test('a highlight made offline waits and reaches the server once the connection is back', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)
  await openReader(page)

  await page.context().setOffline(true)
  await selectWord(page)
  await page.getByTestId('reader.menu.color.lamp').click()
  // Drawn at once, kept on the device, not on the server.
  await expect.poll(async () => (await drawn(page)).map((h) => h.color)).toEqual(['lamp'])
  expect(await stored(entry.id)).toEqual([])

  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(async () => (await stored(entry.id)).map((h) => h.color), { timeout: 20_000 }).toEqual(['lamp'])
})

test('highlights that only lived on the device are uploaded the next time the reader opens', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  // What an older build kept: no ids, no copy, no moments.
  await page.evaluate(
    ([key]) =>
      localStorage.setItem(
        key!,
        JSON.stringify([
          { cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', color: 'sage', text: 'Gregor', index: 0 },
          { cfi: 'epubcfi(/6/2!/4/2,/1:6,/1:11)', color: 'sky', text: 'Samsa', index: 0 },
        ]),
      ),
    [`libellus.reader.highlights.${member.id}.${entry.id}`],
  )
  await openReader(page)
  await expect.poll(async () => (await stored(entry.id)).map((h) => h.excerpt).sort(), { timeout: 20_000 }).toEqual(['Gregor', 'Samsa'])
  // Once only: another open does not make a second copy of them.
  await page.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.back').click()
  await expect(page.getByTestId('reader')).toHaveCount(0)
  await openReader(page)
  await untilStill(page)
  expect(await stored(entry.id)).toHaveLength(2)
})

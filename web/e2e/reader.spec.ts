import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { buildEpub, METAMORPHOSIS_GUTENBERG } from '../tests/support/epub'
import type { TestMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, recordedApple, signedIn, untilStill } from './support'

/**
 * The built-in reader (#131, phase 2), on the iPhone viewport. Chromium: the
 * copy is kept in the origin private file system, which Playwright's WebKit
 * does not write (e2e/ebooks.spec.ts likewise). The EPUB is built in memory from the
 * openings of Metamorphosis's three parts (Project Gutenberg #5200, public
 * domain) and linked with Add ebook, as phase 1 does.
 *
 * - Read now is the lit action of a Book being read with its ebook here; it
 *   opens the reader over the page, the printed page by default (sepia).
 * - A page turned and the reader closed: the progress is written (forward
 *   only, at once on closing) and the place is kept server-side.
 * - The Aa sheet's Classic mode switches the style; Contents goes to a part.
 * - A Want to read Book asks to start reading before progress counts.
 */

test.use({ browserName: 'chromium' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, status: 'reading' | 'want_to_read'): { snapshot: BookSnapshot; status: typeof status } {
  return {
    status,
    snapshot: {
      title: runTitle(title),
      authors: ['Franz Kafka'],
      isbn13: null,
      isbn10: null,
      pageCount: 120,
      year: 1915,
      language: 'en',
      publisher: TEST_PUBLISHER,
      description: null,
      coverUrl: null,
      coverThumbhash: null,
      coverColors: null,
      source: 'apple',
      appleId: uniqueAppleId(),
      openLibraryEditionKey: null,
      openLibraryWorkKey: null,
    },
  }
}

async function shelve(member: TestMember, title: string, status: 'reading' | 'want_to_read'): Promise<LibraryEntry> {
  const { snapshot } = book(title, status)
  const added = await createLibrary(member.client).addToLibrary(snapshot, { status, startedOn: status === 'reading' ? addDays(isoDay(), -1) : null })
  return added.data!
}

/** The Book's page with Metamorphosis linked to it (Add ebook in the options sheet). */
async function withEbook(page: Page, entry: LibraryEntry) {
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.title')).toContainText(entry.book.title)
  await untilStill(page)
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await page
    .getByTestId('bookOptions.addEbook')
    .setInputFiles({ name: 'pg5200.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildEpub(METAMORPHOSIS_GUTENBERG)) })
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  await untilStill(page)
}

async function openReader(page: Page) {
  await page.getByTestId('book.read').click()
  const reader = page.getByTestId('reader')
  await expect(reader).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  return reader
}

/** The progress of the member's open read. */
const progressOf = (email: string) =>
  sql<{ progress_page: number | null }>(
    `select s.progress_page from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1 and s.outcome is null`,
    [email],
  )

test('Read now opens the reader; a page turned is progress, written on closing, and the place is kept', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  // With the ebook here, Read now is the action and Finish steps back beside Abandon.
  await expect(page.getByTestId('book.read')).toHaveText(en.book.read)
  await expect(page.getByTestId('book.finish')).toBeVisible()

  const reader = await openReader(page)
  // The printed page in sepia, by default.
  await expect(reader).toHaveAttribute('data-mode', 'c')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')

  // Turn on: the keyboard's arrow turns a page, as a tap at the right edge does.
  const opened = (await reader.getAttribute('data-fraction'))!
  await page.keyboard.press('ArrowRight')
  await expect(reader).not.toHaveAttribute('data-fraction', opened)
  const turned = (await reader.getAttribute('data-fraction'))!
  // A second turn asked for while the page still settles is kept, not lost.
  await page.keyboard.press('ArrowRight')
  await page.mouse.click(370, 400)
  await expect.poll(async () => Number(await reader.getAttribute('data-fraction'))).toBeGreaterThan(Number(turned))
  const read = (await reader.getAttribute('data-fraction'))!

  // A tap in the middle brings the capsule; Back closes the book.
  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.back').click()
  await expect(page.getByTestId('reader')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'sepia')

  // The progress went forward (on closing, not after the idle wait), and the place is the server's too.
  await expect.poll(async () => (await progressOf(member.email))[0]?.progress_page ?? 0).toBeGreaterThan(0)
  await expect
    .poll(async () => (await sql<{ n: number }>('select count(*)::int as n from public.reader_places where entry_id = $1', [entry.id]))[0]!.n)
    .toBe(1)

  // Opening again goes back to the same place.
  const again = await openReader(page)
  await expect(again).toHaveAttribute('data-fraction', read)
})

test('Aa: Classic mode switches the style and stays; Contents goes to a part', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  const reader = await openReader(page)
  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.type').click()
  await expect(page.getByTestId('readerType')).toBeVisible()
  await page.getByTestId('readerType.classic').click()
  await expect(page.getByTestId('readerType.classic')).toHaveAttribute('aria-checked', 'true')
  await expect(reader).toHaveAttribute('data-mode', 'a')
  await page.keyboard.press('Escape')
  await untilStill(page)

  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.contents').click()
  await expect(page.getByTestId('readerContents.list')).toBeVisible()
  await page.getByTestId('readerContents.item.2').click()
  await expect(page.getByTestId('readerContents')).toHaveCount(0)
  await expect(reader).toHaveAttribute('data-chapter', '2')
})

test('A Want to read Book: Read now opens the book and asks to start reading', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'want_to_read')
  await withEbook(page, entry)

  // Start reading steps back beside Read now.
  await expect(page.getByTestId('book.start')).toBeVisible()
  await openReader(page)
  await expect(page.getByTestId('start')).toBeVisible()
})

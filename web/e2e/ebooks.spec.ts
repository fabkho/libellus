import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { MOBY_DICK_GUTENBERG, buildEpub, type EpubSpec } from '../tests/support/epub'
import type { TestMember } from '../tests/support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, recordedApple, signedIn, untilStill } from './support'

/**
 * Ebook files on the device, linked to Books (#131, phase 1). Chromium: the
 * origin private file system is Chrome's (Android's) feature. The EPUB is built in memory with
 * the package documents of a public-domain edition (tests/support/epub.ts).
 *
 * Add ebook on a Book page (the file input under the options row), the quiet line and the
 * Library's mark, Unlink, and signing out, which deletes every copy on the device. The rest
 * (a copy the browser evicted, a file that is clearly another book, the share target, the
 * ebook folder, Find book) is tests/ebooks.test.ts.
 */
test.use({ browserName: 'chromium' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, author: string, isbn13: string | null = null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13,
    isbn10: null,
    pageCount: 320,
    year: 1900,
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
  }
}

async function shelve(member: TestMember, books: BookSnapshot[]): Promise<LibraryEntry[]> {
  const library = createLibrary(member.client)
  const entries: LibraryEntry[] = []
  for (const snapshot of books) entries.push((await library.addToLibrary(snapshot, { status: 'want_to_read' })).data!)
  return entries
}

const epub = (name: string, spec: EpubSpec) => ({ name, mimeType: 'application/epub+zip', buffer: Buffer.from(buildEpub(spec)) })

/** Every file under `ebooks/` in the origin private file system. */
async function copies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const found: string[] = []
    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
        else found.push(`${prefix}${name}`)
      }
    }
    const root = await navigator.storage.getDirectory()
    try {
      await walk(await root.getDirectoryHandle('ebooks'), 'ebooks/')
    } catch {
      // None yet.
    }
    return found.filter((path) => path.endsWith('.epub'))
  })
}

async function openBook(page: Page, entry: LibraryEntry) {
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.title')).toContainText(entry.book.title)
}

async function openOptions(page: Page) {
  await untilStill(page)
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
}

test('Add ebook links a picked EPUB to the Book; the Library marks it; Unlink deletes the copy', async ({ page }) => {
  const member = await signedIn(page)
  const [moby] = await shelve(member, [book('Moby-Dick', 'Herman Melville')])

  await openBook(page, moby!)
  await expect(page.getByTestId('book.ebook')).toHaveCount(0)
  await openOptions(page)
  await expect(page.getByTestId('bookOptions.ebookRow')).toContainText(en.bookOptions.addEbook)
  await page.getByTestId('bookOptions.addEbook').setInputFiles(epub('pg2701.epub', MOBY_DICK_GUTENBERG))

  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  expect(await copies(page)).toHaveLength(1)

  // The Library's row carries the quiet mark.
  await goto(page, '/library')
  const row = page.getByTestId('library.entry').filter({ hasText: moby!.book.title })
  await expect(row.getByTestId('library.ebookMark')).toBeVisible()

  // Unlink, behind its question: the copy goes, the Book stays.
  await openBook(page, moby!)
  await openOptions(page)
  await page.getByTestId('bookOptions.unlinkEbook').click()
  await expect(page.getByTestId('unlinkEbook')).toContainText('pg2701.epub')
  await page.getByTestId('unlinkEbook.confirm').click()
  await expect(page.getByTestId('book.ebook')).toHaveCount(0)
  expect(await copies(page)).toEqual([])
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)

  // Signing out deletes every copy on the device (a shared phone).
  await openOptions(page)
  await page.getByTestId('bookOptions.addEbook').setInputFiles(epub('pg2701.epub', MOBY_DICK_GUTENBERG))
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  await goto(page, '/profile')
  await page.getByTestId('profile.signOut').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(await copies(page)).toEqual([])
})

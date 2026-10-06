import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import {
  ANNA_KARENINA_STANDARD,
  DRACULA_GUTENBERG3,
  MOBY_DICK_GUTENBERG,
  buildEpub,
  prideAndPrejudiceWithIsbn,
  type EpubSpec,
} from '../tests/support/epub'
import type { TestMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, recordedApple, signedIn, untilStill } from './support'

/**
 * Ebook files on the device, linked to Books (#131, phase 1). Chromium: the
 * origin private file system, the share target's service worker and the folder
 * picker are Chrome's (Android's) features. The EPUBs are built in memory with
 * the package documents of public-domain editions (tests/support/epub.ts).
 *
 * - Add ebook on a Book page (the file input under the options row), the quiet
 *   line and the Library's mark, a file that is clearly another book, Unlink.
 * - A copy the browser evicted shows as missing; the same file brings it back.
 * - A share of three EPUBs, POSTed to the service worker's share target
 *   (public/sw-share.js, registered by the flow: the dev server has no service
 *   worker of its own) → "3 ebooks · 2 linked · 1 needs you"; Ignore; and a
 *   text share POSTed the same way still lands where #91's GET did.
 * - The ebook folder, with an OPFS directory as the stand-in for the picked
 *   folder (automation cannot drive the platform's folder dialog): Scan, a
 *   file that needs her, Choose book, Find book.
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

/** A valid ISBN-13 nobody has (979…). */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    if (!(await sql('select 1 from public.books where isbn13 = $1', [isbn])).length) return isbn
  }
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

test('a picked file that is clearly another book is asked about; Link links it anyway', async ({ page }) => {
  const member = await signedIn(page)
  const [moby] = await shelve(member, [book('Moby-Dick', 'Herman Melville')])

  await openBook(page, moby!)
  await openOptions(page)
  await page.getByTestId('bookOptions.addEbook').setInputFiles(epub('anna.epub', ANNA_KARENINA_STANDARD))

  await expect(page.getByTestId('ebookAnother')).toBeVisible()
  await expect(page.getByTestId('ebookAnother.text')).toContainText('Anna Karenina')
  await page.getByTestId('ebookAnother.cancel').click()
  await untilStill(page)
  await expect(page.getByTestId('book.ebook')).toHaveCount(0)
  expect(await copies(page)).toEqual([])

  await openOptions(page)
  await page.getByTestId('bookOptions.addEbook').setInputFiles(epub('anna.epub', ANNA_KARENINA_STANDARD))
  await page.getByTestId('ebookAnother.action').click()
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
})

test('a copy the browser evicted shows as missing until the same file comes back', async ({ page }) => {
  const member = await signedIn(page)
  const [moby] = await shelve(member, [book('Moby-Dick', 'Herman Melville')])
  await openBook(page, moby!)
  await openOptions(page)
  await page.getByTestId('bookOptions.addEbook').setInputFiles(epub('pg2701.epub', MOBY_DICK_GUTENBERG))
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)

  // The browser clears the origin private file system under storage pressure.
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('ebooks', { recursive: true }))
  await page.reload()
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.missing)
  await expect(page.getByTestId('book.ebookMissingHint')).toHaveText(en.bookEbook.missingHint)
  await goto(page, '/ebooks')
  await expect(page.getByTestId('ebooks.linkedMissing')).toBeVisible()

  await openBook(page, moby!)
  await openOptions(page)
  await expect(page.getByTestId('bookOptions.ebookRow')).toContainText(en.bookOptions.replaceEbook)
  await page.getByTestId('bookOptions.replaceEbook').setInputFiles(epub('pg2701.epub', MOBY_DICK_GUTENBERG))
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  await expect(page.getByTestId('book.ebook')).not.toHaveAttribute('data-missing')
})

/** The share target's service worker (public/sw-share.js), as the built app imports it. */
async function withShareWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw-share.js')
    await navigator.serviceWorker.ready
  })
}

/** What the Android share sheet does: a multipart POST to the manifest's share_target. */
async function share(page: Page, fields: Record<string, string>, files: ReturnType<typeof epub>[] = []) {
  await page.evaluate((values) => {
    const form = document.createElement('form')
    Object.assign(form, { method: 'post', action: '/share', enctype: 'multipart/form-data', id: 'share-sheet' })
    form.dataset.testid = 'test.shareSheet'
    for (const [name, value] of Object.entries(values)) {
      const input = Object.assign(document.createElement('input'), { type: 'hidden', name, value })
      form.append(input)
    }
    const files = Object.assign(document.createElement('input'), { type: 'file', name: 'ebooks', multiple: true, id: 'share-files' })
    files.dataset.testid = 'test.shareFiles'
    form.append(files)
    document.body.append(form)
  }, fields)
  if (files.length) await page.setInputFiles('#share-files', files)
  await page.evaluate(() => (document.getElementById('share-sheet') as HTMLFormElement).submit())
}

test('three shared EPUBs are taken in: two linked, one waits; Ignore never offers it again', async ({ page }) => {
  const member = await signedIn(page)
  const isbn = await unusedIsbn13()
  const [moby, pride] = await shelve(member, [book('Moby-Dick', 'Herman Melville'), book('Pride and Prejudice', 'Jane Austen', isbn)])
  await withShareWorker(page)

  await share(page, {}, [
    epub('pg2701.epub', MOBY_DICK_GUTENBERG),
    epub('pride.epub', prideAndPrejudiceWithIsbn(isbn)),
    epub('pg345.epub', DRACULA_GUTENBERG3),
  ])

  await expect(page).toHaveURL(/\/ebooks$/)
  await expect(page.getByTestId('ebooks.report')).toContainText(en.ebooks.report.share)
  await expect(page.getByTestId('ebooks.reportLine')).toHaveText('3 ebooks · 2 linked · 1 needs you')
  await expect(page.getByTestId('ebooks.linkedRow')).toHaveCount(2)
  const waiting = page.getByTestId('ebooks.waiting')
  await expect(waiting).toHaveCount(1)
  await expect(waiting.getByTestId('ebooks.waitingTitle')).toHaveText('Dracula')
  await expect(waiting.getByTestId('ebooks.waitingWhy')).toHaveText(en.ebooks.noMatch)
  expect(await copies(page)).toHaveLength(3)
  // The service worker's cache is emptied once the app has taken them.
  expect(await page.evaluate(async () => (await (await caches.open('libellus-shared-ebooks')).keys()).length)).toBe(0)

  // Linked by the ISBN, and by title and author.
  await openBook(page, pride!)
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  await openBook(page, moby!)
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)

  // Not hers: ignored, the copy goes, and sharing it again leaves it ignored.
  await goto(page, '/ebooks')
  await page.getByTestId('ebooks.ignore').click()
  await expect(page.getByTestId('ebooks.waiting')).toHaveCount(0)
  expect(await copies(page)).toHaveLength(2)
  await share(page, {}, [epub('pg345.epub', DRACULA_GUTENBERG3)])
  await expect(page.getByTestId('ebooks.reportLine')).toHaveText('1 ebook')
  await expect(page.getByTestId('ebooks.waiting')).toHaveCount(0)
})

test('a text share POSTed to the share target still finds the book as #91 did', async ({ page }) => {
  await signedIn(page)
  await withShareWorker(page)
  await share(page, { title: 'Piranesi', text: 'Piranesi by Susanna Clarke' })
  // No ISBN, no Goodreads link: the search palette, with the words typed in.
  await expect(page.getByTestId('search.query')).toHaveValue(/Piranesi/)
  await expect(page).not.toHaveURL(/\/share/)
})

/**
 * The picked folder's stand-in (the platform's folder dialog cannot be
 * automated): an OPFS directory filled with these files, behind the calls a
 * scan makes. Like Android after a restart, its permission is "prompt" until
 * `requestPermission`, which counts the times it was asked. (Not the OPFS handle
 * itself: Chromium under automation crashes reading one back from IndexedDB, so
 * the stand-in cannot be stored and lives for the page's session.)
 */
async function standInFolder(page: Page, files: Record<string, Uint8Array>) {
  await page.addInitScript(() => {
    const asked = { count: 0 }
    let state: PermissionState = 'prompt'
    type Dir = { name: string; entries(): AsyncIterable<[string, FileSystemHandle]> }
    const wrap = (dir: Dir): unknown => ({
      kind: 'directory',
      name: dir.name,
      async *entries() {
        for await (const [name, handle] of dir.entries()) yield [name, handle.kind === 'directory' ? wrap(handle as unknown as Dir) : handle]
      },
      queryPermission: async () => state,
      requestPermission: async () => {
        asked.count++
        state = 'granted'
        return state
      },
    })
    Object.assign(window, {
      __folderAsked: asked,
      showDirectoryPicker: async () => wrap((await (await navigator.storage.getDirectory()).getDirectoryHandle('Books', { create: true })) as unknown as Dir),
    })
  })
  await page.evaluate(
    async (all) => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Books', { create: true })
      for (const [path, bytes] of Object.entries(all)) {
        const parts = path.split('/')
        let dir = root
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
        const writable = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
        await writable.write(new Uint8Array(bytes))
        await writable.close()
      }
    },
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, [...bytes]])),
  )
}

test('the ebook folder: picked once, Scan links what fits, Choose book and Find book settle the rest', async ({ page }) => {
  const member = await signedIn(page)
  const [moby, anna, otherAnna] = await shelve(member, [
    book('Moby-Dick', 'Herman Melville'),
    book('Anna Karenina', 'Leo Tolstoy'),
    book('Anna Karenina: A Novel', 'Lev Tolstoy'),
  ])
  // Dracula is in the Catalogue (another member added it), not in her Library.
  await sql('insert into public.books (title, authors, source, apple_id, publisher) values ($1, $2, $3, $4, $5)', [
    runTitle('Dracula'),
    ['Bram Stoker'],
    'apple',
    uniqueAppleId(),
    TEST_PUBLISHER,
  ])
  await standInFolder(page, {
    'Moby Dick.epub': buildEpub(MOBY_DICK_GUTENBERG),
    'Russian/Anna Karenina.epub': buildEpub(ANNA_KARENINA_STANDARD),
    'Horror/Dracula.epub': buildEpub(DRACULA_GUTENBERG3),
    'notes.txt': new TextEncoder().encode('not a book'),
  })
  await page.reload()

  // The Profile's account rows lead to the Ebooks page; the folder is chosen and scanned there.
  await goto(page, '/profile')
  await expect(page.getByTestId('profile.ebookFolder')).toHaveCount(0)
  await expect(page.getByTestId('profile.readerClassic')).toHaveCount(0)
  await page.getByTestId('profile.ebooks').click()
  await expect(page).toHaveURL(/\/ebooks$/)
  await expect(page.getByTestId('ebooks.folder')).toContainText(en.ebooks.folder.choose)
  await expect(page.getByTestId('ebooks.scan')).toHaveCount(0)
  await page.getByTestId('ebooks.folder').click()
  await expect(page.getByTestId('ebooks.folderName')).toHaveText('Books')
  // Scan asks for the folder's permission on this tap (Android forgets it with every restart).
  await page.getByTestId('ebooks.scan').click()

  expect(await page.evaluate(() => (window as unknown as { __folderAsked: { count: number } }).__folderAsked.count)).toBe(1)
  await expect(page.getByTestId('ebooks.reportLine')).toHaveText('3 ebooks · 1 linked · 2 need you')
  await expect(page.getByTestId('ebooks.folderName')).toHaveText('Books')

  // Two Annas in her Library: she picks.
  const annaRow = page.getByTestId('ebooks.waiting').filter({ hasText: 'Anna Karenina' })
  await expect(annaRow.getByTestId('ebooks.waitingWhy')).toHaveText('Could be one of 2 of your books')
  await annaRow.getByTestId('ebooks.choose').click()
  await expect(page.getByTestId('ebookCandidates.candidate')).toHaveCount(2)
  await page.getByTestId('ebookCandidates.candidate').filter({ hasText: anna!.book.title }).click()
  await untilStill(page)
  await expect(page.getByTestId('ebooks.linkedRow')).toHaveCount(2)

  // Dracula is not in her Library: Find book searches for it; the Book she adds is linked to the file.
  await page.getByTestId('ebooks.waiting').getByTestId('ebooks.find').click()
  await expect(page.getByTestId('search.query')).toHaveValue('Dracula Bram Stoker')
  // The + of her run's Dracula (the Catalogue holds other runs' too).
  await page.getByRole('button', { name: `Add ${runTitle('Dracula')} to your Library` }).click()
  await expect(page.getByTestId('add')).toBeVisible()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  // Search was over the ebooks page all along.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ebooks.waiting')).toHaveCount(0)
  await expect(page.getByTestId('ebooks.linkedRow')).toHaveCount(3)

  // A second scan finds nothing new and does not ask again this session.
  await page.getByTestId('ebooks.scan').click()
  await expect(page.getByTestId('ebooks.reportLine')).toHaveText('3 ebooks · 3 linked')
  expect(await copies(page)).toHaveLength(3)
  expect(await page.evaluate(() => (window as unknown as { __folderAsked: { count: number } }).__folderAsked.count)).toBe(1)
  void moby
  void otherAnna
})

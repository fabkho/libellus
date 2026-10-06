import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { METAMORPHOSIS_GUTENBERG, buildEpub, type EpubSpec } from '../tests/support/epub'
import type { TestMember } from '../tests/support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { goto, untilStill } from './support'

/** Steps that put a Book with an ebook on the shelf and open the built-in reader (#131), for the reader's flows (e2e/reader.spec.ts, e2e/a11y.spec.ts). */

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

export async function shelve(member: TestMember, title: string, status: 'reading' | 'want_to_read'): Promise<LibraryEntry> {
  const { snapshot } = book(title, status)
  const added = await createLibrary(member.client).addToLibrary(snapshot, { status, startedOn: status === 'reading' ? addDays(isoDay(), -1) : null })
  return added.data!
}

/** The Book's page with Metamorphosis (or another EPUB) linked to it (Add ebook in the options sheet). */
export async function withEbook(page: Page, entry: LibraryEntry, spec: EpubSpec = METAMORPHOSIS_GUTENBERG) {
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.title')).toContainText(entry.book.title)
  await untilStill(page)
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await page
    .getByTestId('bookOptions.addEbook')
    .setInputFiles({ name: 'pg5200.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildEpub(spec)) })
  await expect(page.getByTestId('book.ebook')).toHaveText(en.bookEbook.line)
  await untilStill(page)
}

export async function openReader(page: Page) {
  await page.getByTestId('book.read').click()
  const reader = page.getByTestId('reader')
  await expect(reader).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  return reader
}

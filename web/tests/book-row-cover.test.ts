import { createPinia, setActivePinia } from 'pinia'
import { reactive, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book, BookSnapshot } from '../app/data/books'

/**
 * One Book, one cover (docs/plans/covers-consistency.md): a work's row (an author page, a series, More from the
 * author) opens an edition that is not in the Catalogue yet, and the page asks a source for it again. The source
 * may name another picture of that edition (Apple's artwork by ISBN where the row showed Open Library's); the
 * page shows the row's (`seedCover`). A Catalogue Book is shown as stored: the row showed that one too
 * (`work_card`). The stores around the book store are stood in for.
 */

function snapshot(over: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    isbn13: '9780060512750',
    isbn10: null,
    pageCount: 387,
    year: 1974,
    language: 'en',
    publisher: 'Harper',
    description: null,
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Publication1/v4/aa/bb/cc/x/9780060512750.jpg/600x900bb.jpg',
    coverThumbhash: 'apple-hash',
    coverColors: { dominant: '#112233', secondary: '#445566' },
    source: 'apple',
    appleId: '1',
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...over,
  }
}

const ROW = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
/** The page of the edition the row opens, by its ISBN. */
const EDITION_PAGE = `isbn-${snapshot().isbn13}`
const catalogue = vi.fn(async (): Promise<{ data: Book | null; error: null }> => ({ data: null, error: null }))
const lookupIsbn = vi.fn(async () => snapshot())

vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/library', () => ({
  useLibraryStore: () => ({
    entryByKey: new Map(),
    library: () => ({ catalogueBook: catalogue, entryForBook: async () => ({ data: null, error: null }) }),
    remember: () => undefined,
    rememberDescription: () => undefined,
  }),
}))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ seenBook: () => null, repository: () => ({ lookupIsbn }) }) }))

async function store() {
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('watch', watch)
  setActivePinia(createPinia())
  const { useBookStore } = await import('../app/stores/book')
  return useBookStore()
}

beforeEach(() => {
  catalogue.mockClear()
  lookupIsbn.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('a page opened from a work’s row', () => {
  it('shows the row’s cover, not the one the source names again, and no thumbhash of another picture', async () => {
    const books = await store()
    books.seedCover(EDITION_PAGE, ROW)
    await books.load(EDITION_PAGE)
    const book = books.page(EDITION_PAGE)!.book!
    expect(lookupIsbn).toHaveBeenCalledWith('9780060512750')
    expect(book.coverUrl).toBe(ROW)
    expect(book.coverThumbhash).toBeNull()
    expect(book.coverColors).toBeNull()
    // Everything else is the source's.
    expect(book.pageCount).toBe(387)
  })

  it('shows the Placeholder where the row did, though a source has a picture', async () => {
    const books = await store()
    books.seedCover(EDITION_PAGE, null)
    await books.load(EDITION_PAGE)
    expect(books.page(EDITION_PAGE)!.book!.coverUrl).toBeNull()
  })

  it('keeps what the source said where the row showed that very cover', async () => {
    const books = await store()
    books.seedCover(EDITION_PAGE, snapshot().coverUrl)
    await books.load(EDITION_PAGE)
    expect(books.page(EDITION_PAGE)!.book!.coverThumbhash).toBe('apple-hash')
  })

  it('takes the row’s cover on a page already loaded from elsewhere', async () => {
    const books = await store()
    await books.load(EDITION_PAGE)
    books.seedCover(EDITION_PAGE, ROW)
    expect(books.page(EDITION_PAGE)!.book!.coverUrl).toBe(ROW)
  })

  it('shows a Catalogue Book as stored (the row showed the Catalogue’s cover too)', async () => {
    const stored = { ...snapshot({ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }), id: 'cat-1' } as Book
    catalogue.mockResolvedValueOnce({ data: stored, error: null })
    const books = await store()
    books.seedCover(EDITION_PAGE, ROW)
    await books.load(EDITION_PAGE)
    expect(books.page(EDITION_PAGE)!.book!.coverUrl).toBe('https://covers.openlibrary.org/b/id/1-L.jpg')
  })

  it('is the source’s as before when no row named a cover (a link, a reload)', async () => {
    const books = await store()
    await books.load(EDITION_PAGE)
    expect(books.page(EDITION_PAGE)!.book!.coverUrl).toBe(snapshot().coverUrl)
  })
})

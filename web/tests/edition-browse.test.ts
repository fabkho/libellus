import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Book, BookSnapshot } from '../app/data/books'
import type { EditionCandidate } from '../app/data/editions'

/**
 * Change edition for a Book that is not in her Library (`browse`, `viewing`): the same list of editions, a pick
 * that changes what the page shows, and nothing written anywhere. The stores around it are stood in for, each
 * with a probe on everything that writes: the Library's repository, its entry changes, the book pages, the
 * Collections and the outbox's reach (`library.library()` is how any write starts).
 */

function snapshot(title: string, over: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title,
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 250,
    year: 1969,
    language: 'en',
    publisher: 'Ace',
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...over,
  }
}

const shownBook = snapshot('The Left Hand of Darkness', { appleId: '1', isbn13: '9780441478125' })
const catalogued = { ...snapshot('The Left Hand of Darkness', { isbn13: '9780441478126', publisher: 'Orbit', pageCount: 304 }), id: 'cat-1' } as Book
const elsewhere = snapshot('The Left Hand of Darkness', { openLibraryEditionKey: 'OL1M', isbn13: '9780441478127', pageCount: 286 })

const writes = vi.fn()
const answer = [
  { book: shownBook, current: true },
  { book: catalogued, current: false },
  { book: elsewhere, current: false },
] satisfies EditionCandidate[]
const repository = vi.fn(() => {
  writes('repository')
  return null
})
const probe = (name: string) => () => writes(name)

vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/library', () => ({
  useLibraryStore: () => ({ library: repository, entryChanged: probe('entryChanged'), editionChanged: probe('editionChanged'), withCover: probe('withCover') }),
}))
vi.mock('~/stores/book', () => ({ useBookStore: () => ({ dropEntry: probe('dropEntry') }) }))
vi.mock('~/stores/collections', () => ({ useCollectionsStore: () => ({ entryChanged: probe('collections') }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ repository: probe('search') }) }))
vi.mock('~/data/catalogueSearch', () => ({ createCatalogueSearch: () => ({}) }))
vi.mock('~/data/editions', () => ({
  createEditions: () => ({
    // As the real one: the edition it was asked about is the current one.
    find: async (
      asked: BookSnapshot,
      { onUpdate }: { onUpdate: (update: { candidates: EditionCandidate[]; pending: boolean; failed: boolean }) => void },
    ) => {
      await Promise.resolve()
      const candidates = answer.map(({ book }) => ({ book, current: book.isbn13 === asked.isbn13 }))
      onUpdate({ candidates, pending: true, failed: false })
      return { candidates, failed: false }
    },
  }),
}))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  setActivePinia(createPinia())
  const { useEditionStore } = await import('~/stores/edition')
  return useEditionStore()
}

afterEach(() => {
  vi.unstubAllGlobals()
  writes.mockClear()
  repository.mockClear()
})

describe('Change edition for a Book that is not in the Library', () => {
  it('lists the editions as for an entry: the shown one first, picked, the others to pick', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    expect(edition.active).toBe(true)
    expect(edition.changing).toBeNull()
    expect(edition.candidates[0]).toEqual({ book: shownBook, current: true })
    expect(edition.isPicked(shownBook)).toBe(true)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    expect(edition.choice).toBeNull()
    edition.pick(answer[1]!)
    expect(edition.choice?.book).toEqual(catalogued)
  })

  it('shows the picked edition on the page it was opened from, and writes nothing', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    edition.pick(answer[2]!)
    expect(await edition.confirm()).toBeNull()

    expect(edition.viewOf('apple-1')).toEqual(elsewhere)
    expect(edition.viewOf('apple-2')).toBeNull()
    expect(edition.active).toBe(false)
    // No repository was even asked for: an entry, a Catalogue Book, the outbox all start there.
    expect(repository).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
  })

  it('a Catalogue row is shown as the Catalogue Book it is', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    edition.pick(answer[1]!)
    await edition.confirm()
    expect(edition.viewOf('apple-1')).toEqual(catalogued)
    expect(writes).not.toHaveBeenCalled()
  })

  it('looks again from the edition shown, and can go back to the first', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    edition.pick(answer[1]!)
    await edition.confirm()

    edition.browse('apple-1', catalogued)
    expect(edition.candidates[0]).toEqual({ book: catalogued, current: true })
    expect(edition.isPicked(catalogued)).toBe(true)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    edition.pick({ book: shownBook, current: false })
    await edition.confirm()
    expect(edition.viewOf('apple-1')).toEqual(shownBook)
  })

  it('does nothing without another edition picked, and closing keeps the page as it was', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    expect(await edition.confirm()).toBeNull()
    expect(edition.viewOf('apple-1')).toBeNull()
    edition.close()
    expect(edition.active).toBe(false)
    expect(edition.viewOf('apple-1')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
  })

  it('forgets the view when the page lets go of it', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    await vi.waitFor(() => expect(edition.candidates).toHaveLength(3))
    edition.pick(answer[1]!)
    await edition.confirm()
    expect(edition.viewOf('apple-1')).toEqual(catalogued)
    edition.stopViewing()
    expect(edition.viewOf('apple-1')).toBeNull()
  })

  it('opening it for an entry leaves the browse behind', async () => {
    const edition = await store()
    edition.browse('apple-1', shownBook)
    edition.open({ id: 'e1', book: catalogued } as never)
    expect(edition.browsing).toBeNull()
    expect(edition.changing).not.toBeNull()
  })
})

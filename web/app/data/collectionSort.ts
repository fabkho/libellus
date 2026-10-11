import type { LibraryEntry } from './library'
import { authorKey, collator, order, type SortDir } from './libraryView'
import { LOCAL_DATA_PREFIX } from './localData'

/**
 * How one Collection's Books are looked at (backlog #9): her own saved order (the default, the only
 * one that can be dragged), or the same Books sorted by title, author, publication year or when they
 * were put on the Collection. A sort is a view only: it never writes the saved order. Everything here
 * is the client's, over the entries already loaded, so it works offline; a native client copies it 1:1.
 *
 * There is no publication date in the data, only `books.published_year` (`Book.year`), so "Year" is
 * what is sortable. "Date added" is when the Book was put on *this Collection*
 * (`collection_entries.added_at`), not when it joined the Library.
 */
export type CollectionSortKey = 'order' | 'title' | 'author' | 'year' | 'added'
export type CollectionSort = { key: CollectionSortKey; dir: SortDir }

/** The sorts the sheet offers, in its order. */
export const COLLECTION_SORTS: readonly CollectionSortKey[] = ['order', 'title', 'author', 'year', 'added']

/** Her saved order: what a Collection shows until she chooses another. */
export const COLLECTION_ORDER: CollectionSort = { key: 'order', dir: 'asc' }

/** Which way a sort goes when it is chosen: years and dates newest first, words A to Z. */
export function collectionDir(key: CollectionSortKey): SortDir {
  return key === 'year' || key === 'added' ? 'desc' : 'asc'
}

/** Whether the view is her saved order (the one a row can be dragged in). */
export const isSavedOrder = (sort: CollectionSort): boolean => sort.key === 'order'

/**
 * The entries in the order of the sort: a new array, `entries` itself in her order. Stable, so ties
 * keep her order; an entry without a value (no year, no time it was put on) goes last whichever way
 * the sort goes. `addedAt`: when each entry was put on the Collection, by entry id.
 */
export function sortCollectionEntries(
  entries: readonly LibraryEntry[],
  sort: CollectionSort,
  addedAt: Readonly<Record<string, string>> = {},
): LibraryEntry[] {
  const { key, dir } = sort
  if (key === 'order') return [...entries]
  const text = (x: string, y: string) => collator.compare(x, y)
  return [...entries].sort((a, b) => {
    switch (key) {
      case 'title':
        return order(dir, a.book.title, b.book.title, text)
      case 'author':
        return order(dir, a.book.authors.length ? authorKey(a) : null, b.book.authors.length ? authorKey(b) : null, text)
      case 'year':
        return order(dir, a.book.year, b.book.year, (x, y) => x - y)
      case 'added':
        return order(dir, addedAt[a.id] ?? null, addedAt[b.id] ?? null, (x, y) => Date.parse(x) - Date.parse(y))
    }
  })
}

// ------------------------------------------------------------ the device's memory

/** What the device remembers of the choice: one sort for every Collection, per member. */
export const COLLECTION_SORT_KEY = `${LOCAL_DATA_PREFIX}collectionSort`

type SortStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The remembered sort, read defensively: anything unreadable is her saved order, nothing throws. */
export function readCollectionSort(storage: Pick<SortStorage, 'getItem'>, memberId: string): CollectionSort {
  try {
    const all: unknown = JSON.parse(storage.getItem(COLLECTION_SORT_KEY) ?? '{}')
    const mine = isObject(all) ? all[memberId] : null
    if (isObject(mine) && (mine.dir === 'asc' || mine.dir === 'desc') && COLLECTION_SORTS.includes(mine.key as CollectionSortKey)) {
      return mine.key === 'order' ? COLLECTION_ORDER : { key: mine.key as CollectionSortKey, dir: mine.dir }
    }
  } catch {
    // Unreadable: as if never saved.
  }
  return COLLECTION_ORDER
}

/** Remembers this member's sort, next to other members' of this device. Storage that refuses drops it. */
export function saveCollectionSort(storage: SortStorage, memberId: string, sort: CollectionSort): void {
  try {
    let all: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(storage.getItem(COLLECTION_SORT_KEY) ?? '{}')
      if (isObject(parsed)) all = parsed
    } catch {
      // Replaced by what is saved now.
    }
    storage.setItem(COLLECTION_SORT_KEY, JSON.stringify({ ...all, [memberId]: sort }))
  } catch {
    // The choice is not kept; the screen still shows it.
  }
}

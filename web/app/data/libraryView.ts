import type { EntryStatus, LibraryEntry } from './library'
import { pageCountOf } from './progress'
import { isReadAs, readAsOf, type ReadAs } from './readAs'

/**
 * How the Library is looked at (issue #169, shared decisions in #166): the
 * filters and the sort of each Status list, which entries they leave, in which
 * order, and what the device remembers of the member's last choice. Everything
 * here is the client's: no database call, the lists are loaded already. Pages
 * and stores only render it (stores/libraryView.ts); a native client copies it 1:1.
 *
 * One `ListView` per Status (Want to read, Currently reading, Finished): each is a
 * list of its own, with the facets that mean something there (a Rating or a year
 * read only on Finished). Filters combine: an entry stays when it passes every
 * facet that is set, and a facet with several values passes any of them.
 *
 * Genre is a pluggable facet (`GenreLookup`): it stays out of sight until the
 * Catalogue can say a Book's genres (issue #168), see `genresFacet` in the store.
 */

export type SortKey = 'dateRead' | 'dateAdded' | 'rating' | 'title' | 'author' | 'pages'
export type SortDir = 'asc' | 'desc'
export type Sort = { key: SortKey; dir: SortDir }

/** The facets a list can be filtered by. `genre` needs a `GenreLookup`. */
export type Facet = 'readAs' | 'author' | 'rating' | 'year' | 'pages' | 'genre'

/** A Read as value, or `unset` for the entries that have none (and whose edition's format does not say). */
export type ReadAsChoice = ReadAs | 'unset'

/** Rating: only the entries not rated, or at least this many quarter stars (4, 8, 12, 16, 20). */
export type RatingChoice = 'unrated' | number
export const RATING_MINIMUMS: readonly number[] = [20, 16, 12]

export type PageRange = { min: number | null; max: number | null }

/** What one Status list is filtered and sorted by. Immutable by convention: a change makes a new one. */
export type ListView = {
  sort: Sort
  readAs: ReadAsChoice[]
  authors: string[]
  rating: RatingChoice | null
  /** Years the read ended in (`YYYY`), `''` for a read without an end date. */
  years: string[]
  pages: PageRange
  genres: string[]
}

export type LibraryViews = Record<EntryStatus, ListView>

const STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

/** The sorts each Status offers, in the order the sheet lists them. */
export const SORTS: Record<EntryStatus, readonly SortKey[]> = {
  want_to_read: ['dateAdded', 'title', 'author', 'pages'],
  reading: ['dateRead', 'dateAdded', 'title', 'author', 'pages'],
  finished: ['dateRead', 'dateAdded', 'rating', 'title', 'author', 'pages'],
}

/** The facets each Status offers, in the order the sheet lists them. */
export const FACETS: Record<EntryStatus, readonly Facet[]> = {
  want_to_read: ['readAs', 'author', 'pages', 'genre'],
  reading: ['readAs', 'author', 'pages', 'genre'],
  finished: ['readAs', 'author', 'rating', 'year', 'pages', 'genre'],
}

/** Which way a sort goes when it is chosen: dates and ratings newest and best first, words A to Z. */
export function naturalDir(key: SortKey): SortDir {
  return key === 'title' || key === 'author' ? 'asc' : 'desc'
}

/**
 * The list's own order, the one the database returns (`entries`): Want to read by when it
 * was added, Currently reading by the start date, Finished by the end date; newest first.
 */
export function defaultSort(status: EntryStatus): Sort {
  return { key: status === 'want_to_read' ? 'dateAdded' : 'dateRead', dir: 'desc' }
}

export function newListView(status: EntryStatus): ListView {
  return { sort: defaultSort(status), readAs: [], authors: [], rating: null, years: [], pages: { min: null, max: null }, genres: [] }
}

export function newLibraryViews(): LibraryViews {
  return { want_to_read: newListView('want_to_read'), reading: newListView('reading'), finished: newListView('finished') }
}

/** The sort a Status can do: a remembered one it no longer offers is its own order. */
export function sortFor(status: EntryStatus, sort: Sort): Sort {
  return SORTS[status].includes(sort.key) ? sort : defaultSort(status)
}

export function isDefaultSort(status: EntryStatus, sort: Sort): boolean {
  const own = defaultSort(status)
  const now = sortFor(status, sort)
  return now.key === own.key && now.dir === own.dir
}

const hasPages = (range: PageRange) => range.min !== null || range.max !== null

/** One setting of a filter, as the chips under the segments show it. `value` is the Read as, the author, the year … */
export type ActiveFilter = { facet: Facet; value: string }

/** The filters that are set and apply to this Status, in the sheet's order (the chips' order). */
export function activeFilters(status: EntryStatus, view: ListView, { genres = false }: { genres?: boolean } = {}): ActiveFilter[] {
  const active: ActiveFilter[] = []
  for (const facet of FACETS[status]) {
    if (facet === 'readAs') active.push(...view.readAs.map((value) => ({ facet, value })))
    if (facet === 'author') active.push(...view.authors.map((value) => ({ facet, value })))
    if (facet === 'rating' && view.rating !== null) active.push({ facet, value: String(view.rating) })
    if (facet === 'year') active.push(...view.years.map((value) => ({ facet, value })))
    if (facet === 'pages' && hasPages(view.pages)) active.push({ facet, value: 'range' })
    if (facet === 'genre' && genres) active.push(...view.genres.map((value) => ({ facet, value })))
  }
  return active
}

/** `view` without one setting of a filter (a chip's ×); a Page range or a Rating goes whole. */
export function withoutFilter(view: ListView, { facet, value }: ActiveFilter): ListView {
  switch (facet) {
    case 'readAs':
      return { ...view, readAs: view.readAs.filter((v) => v !== value) }
    case 'author':
      return { ...view, authors: view.authors.filter((v) => v !== value) }
    case 'rating':
      return { ...view, rating: null }
    case 'year':
      return { ...view, years: view.years.filter((v) => v !== value) }
    case 'pages':
      return { ...view, pages: { min: null, max: null } }
    case 'genre':
      return { ...view, genres: view.genres.filter((v) => v !== value) }
  }
}

/** `view` with every filter taken off; its sort stays. */
export function withoutFilters(view: ListView): ListView {
  return { ...newListView('want_to_read'), sort: view.sort }
}

/**
 * Genres of a Book, by the Book's id: the seam for the genre filter (issue #168).
 * Undefined while they are not known (the entry then passes no genre choice).
 */
export type GenreLookup = (bookId: string) => readonly string[] | undefined

export type MatchOptions = { genres?: GenreLookup | null }

/** The year a Finished entry's latest read ended in (`YYYY`), `''` without a date. */
export const yearReadOf = (entry: LibraryEntry) => entry.latestSession?.endedOn?.slice(0, 4) ?? ''

/** Whether the entry passes every filter of the view that applies to the Status. */
export function matches(entry: LibraryEntry, status: EntryStatus, view: ListView, { genres = null }: MatchOptions = {}): boolean {
  const facets = FACETS[status]
  if (facets.includes('readAs') && view.readAs.length && !view.readAs.includes(readAsOf(entry) ?? 'unset')) return false
  if (facets.includes('author') && view.authors.length && !entry.book.authors.some((a) => view.authors.includes(a))) return false
  if (facets.includes('rating') && view.rating !== null) {
    const rating = entry.latestSession?.rating ?? null
    if (view.rating === 'unrated' ? rating !== null : rating === null || rating < view.rating) return false
  }
  if (facets.includes('year') && view.years.length && !view.years.includes(yearReadOf(entry))) return false
  if (facets.includes('pages') && hasPages(view.pages)) {
    const pages = pageCountOf(entry)
    if (pages === null) return false
    if (view.pages.min !== null && pages < view.pages.min) return false
    if (view.pages.max !== null && pages > view.pages.max) return false
  }
  if (facets.includes('genre') && genres && view.genres.length) {
    const of = genres(entry.book.id) ?? []
    if (!of.some((g) => view.genres.includes(g))) return false
  }
  return true
}

/** The sort key of the first author: the last word of the name (Austen before Herbert), then the whole name. */
function authorKey(entry: LibraryEntry): string {
  const first = entry.book.authors[0]?.trim() ?? ''
  return `${first.split(/\s+/).at(-1) ?? ''}\u0000${first}`
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Compares two values the sort has; an entry without one goes last whichever way the sort goes. */
function order<T>(dir: SortDir, a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return (dir === 'asc' ? 1 : -1) * compare(a, b)
}

/**
 * The entries in the order of the sort (stable: ties keep the list's own order, newest
 * first). A sort the Status does not offer is its own order.
 */
export function sortLibrary(entries: readonly LibraryEntry[], status: EntryStatus, sort: Sort): LibraryEntry[] {
  const { key, dir } = sortFor(status, sort)
  const text = (x: string, y: string) => collator.compare(x, y)
  const number = (x: number, y: number) => x - y
  const day = (entry: LibraryEntry) => (status === 'reading' ? entry.latestSession?.startedOn : entry.latestSession?.endedOn) ?? null
  return [...entries].sort((a, b) => {
    switch (key) {
      case 'dateRead':
        return order(dir, day(a), day(b), (x, y) => x.localeCompare(y))
      case 'dateAdded':
        return order(dir, a.addedAt, b.addedAt, (x, y) => x.localeCompare(y))
      case 'rating':
        return order(dir, a.latestSession?.rating ?? null, b.latestSession?.rating ?? null, number)
      case 'title':
        return order(dir, a.book.title, b.book.title, text)
      case 'author':
        return order(dir, a.book.authors.length ? authorKey(a) : null, b.book.authors.length ? authorKey(b) : null, text)
      case 'pages':
        return order(dir, pageCountOf(a), pageCountOf(b), number)
    }
  })
}

/**
 * What a Status list shows: the entries that pass the view's filters, in its sort. A view
 * with nothing set and the list's own order returns `entries` itself.
 */
export function arrange(entries: readonly LibraryEntry[], status: EntryStatus, view: ListView, options: MatchOptions = {}): readonly LibraryEntry[] {
  const kept = entries.filter((entry) => matches(entry, status, view, options))
  return isDefaultSort(status, view.sort) ? (kept.length === entries.length ? entries : kept) : sortLibrary(kept, status, view.sort)
}

/** A choice the sheet offers for a facet, with how many of the list's entries have it. */
export type FacetOption = { value: string; count: number }

const byCountThenName = (a: FacetOption, b: FacetOption) => b.count - a.count || collator.compare(a.value, b.value)

function tally(values: Iterable<string>): FacetOption[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].map(([value, count]) => ({ value, count }))
}

/** The authors of the entries (each Book counts once for each of its authors), most books first. */
export function authorOptions(entries: readonly LibraryEntry[]): FacetOption[] {
  return tally(entries.flatMap((entry) => [...new Set(entry.book.authors)])).sort(byCountThenName)
}

/** The years the entries' reads ended in, newest first; `''` (undated) last. */
export function yearOptions(entries: readonly LibraryEntry[]): FacetOption[] {
  return tally(entries.map(yearReadOf)).sort((a, b) => (a.value && b.value ? b.value.localeCompare(a.value) : a.value ? -1 : b.value ? 1 : 0))
}

/** The Read as values of the entries, in the order of `READ_AS`, `unset` last; only those that occur. */
export function readAsOptions(entries: readonly LibraryEntry[]): FacetOption[] {
  const counts = tally(entries.map((entry) => readAsOf(entry) ?? 'unset'))
  const rank = (value: string) => (value === 'unset' ? 3 : ['physical', 'ebook', 'audiobook'].indexOf(value))
  return counts.sort((a, b) => rank(a.value) - rank(b.value))
}

/** The genres of the entries' Books through the seam, most books first. Empty without a lookup. */
export function genreOptions(entries: readonly LibraryEntry[], lookup: GenreLookup | null): FacetOption[] {
  if (!lookup) return []
  return tally(entries.flatMap((entry) => [...new Set(lookup(entry.book.id) ?? [])])).sort(byCountThenName)
}

// ------------------------------------------------------------ the device's memory

/**
 * The views the device remembers, a map of member id → `LibraryViews`. A setting of the device,
 * not of the account, so it sits outside the `libellus.` prefix that signing out clears
 * (data/localData.ts), like the import hint: signing in again finds the Library as she left it.
 */
export const LIBRARY_VIEW_KEY = 'libellus-library-view'

/** The slice of Storage the memory needs; `window.localStorage` fits. */
export type ViewStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

/** A remembered list view read defensively: anything unreadable is the default, nothing throws. */
export function listViewFromJson(status: EntryStatus, json: unknown): ListView {
  const view = newListView(status)
  if (!isObject(json)) return view
  const sort = json.sort
  if (isObject(sort) && typeof sort.key === 'string' && (sort.dir === 'asc' || sort.dir === 'desc')) {
    const key = sort.key as SortKey
    if (SORTS[status].includes(key)) view.sort = { key, dir: sort.dir }
  }
  view.readAs = strings(json.readAs).filter((v): v is ReadAsChoice => isReadAs(v) || v === 'unset')
  view.authors = strings(json.authors)
  const rating = json.rating
  if (rating === 'unrated' || (typeof rating === 'number' && RATING_MINIMUMS.includes(rating))) view.rating = rating
  view.years = strings(json.years).filter((v) => v === '' || /^\d{4}$/.test(v))
  if (isObject(json.pages)) view.pages = { min: count(json.pages.min), max: count(json.pages.max) }
  view.genres = strings(json.genres)
  return view
}

/** What the device remembers of this member's Library view; the default for a member it knows nothing of. */
export function readLibraryViews(storage: Pick<ViewStorage, 'getItem'>, memberId: string): LibraryViews {
  const views = newLibraryViews()
  try {
    const all: unknown = JSON.parse(storage.getItem(LIBRARY_VIEW_KEY) ?? '{}')
    const mine = isObject(all) ? all[memberId] : null
    if (!isObject(mine)) return views
    for (const status of STATUSES) views[status] = listViewFromJson(status, mine[status])
  } catch {
    // Unreadable: as if never saved.
  }
  return views
}

/** Remembers this member's Library view, next to the other members' of this device. Storage that refuses drops it. */
export function saveLibraryViews(storage: ViewStorage, memberId: string, views: LibraryViews): void {
  try {
    let all: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(storage.getItem(LIBRARY_VIEW_KEY) ?? '{}')
      if (isObject(parsed)) all = parsed
    } catch {
      // Replaced by what is saved now.
    }
    storage.setItem(LIBRARY_VIEW_KEY, JSON.stringify({ ...all, [memberId]: views }))
  } catch {
    // The device's storage is full or off: the choice lasts until the app closes.
  }
}

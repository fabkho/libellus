import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'
import {
  bookFromRow,
  bookToRow,
  ENTRY_COLUMNS,
  entryFromRow,
  type BookRow,
  type EntryRow,
  type LibraryEntry,
  type WriteOptions,
} from './library'

/**
 * Collections (issue #1, Library actions → Collections; issue #14): a member's
 * own shelves, in her order, each holding Library entries in her order. The
 * data-layer contract a native client reimplements against the same database
 * functions. Every change is one RPC; the rules (a name per member, deleting a
 * Collection never deletes an entry, adding a Book that is not in the Library
 * puts it on Want to read first, who may read what) live in the database.
 */

/** A Collection as its list shows it: the name, how many, and the first covers. */
export type CollectionSummary = {
  id: string
  name: string
  position: number
  createdAt: string
  /** How many Books are on it. */
  count: number
  /** The Books of its first entries, in its order, at most `MOSAIC_SIZE`. */
  covers: Book[]
}

/** One Collection with every entry on it, in the member's order. */
export type Collection = {
  id: string
  name: string
  position: number
  createdAt: string
  entries: LibraryEntry[]
}

/** How many covers a Collection shows in its mosaic. */
export const MOSAIC_SIZE = 4

/** Stable codes for what can go wrong; the copy lives under `collections.error.<code>`. */
export type CollectionErrorCode =
  /** Nothing but whitespace, or longer than `NAME_MAX`. */
  | 'name_invalid'
  /** The member already has a Collection by that name (in any case). */
  | 'name_taken'
  /** Not one of the member's Collections (deleted elsewhere, or someone else's). */
  | 'collection_missing'
  /** The Book is on this Collection already. */
  | 'already_in_collection'
  /** The entry is not on this Collection (taken off elsewhere). */
  | 'not_in_collection'
  /** The order does not list exactly the Collection's entries: it changed since it was read. */
  | 'order_mismatch'
  /** No such Book for this member, or a snapshot that cannot enter the Catalogue. */
  | 'book_invalid'
  | 'not_signed_in'
  /** The device has no connection: nothing was sent (`WriteOptions`, data/library.ts). */
  | 'offline'
  | 'unknown'

export type CollectionResult<T> = { data: T; error: null } | { data: null; error: CollectionErrorCode }

/** The longest name the database keeps. */
export const NAME_MAX = 80

const CODES = [
  'name_invalid',
  'name_taken',
  'collection_missing',
  'already_in_collection',
  'not_in_collection',
  'order_mismatch',
  'book_invalid',
  'not_signed_in',
] as const

/** What the database said, as a code. The functions raise their codes as the message. */
export function mapCollectionError(failure: { message?: string; code?: string }): CollectionErrorCode {
  const message = failure.message ?? ''
  for (const code of CODES) if (message.includes(code)) return code
  // The API refusing a call outright: no session (any more).
  if (failure.code === '42501' || failure.code === 'PGRST301') return 'not_signed_in'
  // A snapshot a table constraint refuses (an ISBN in the wrong shape, say).
  if (failure.code === '23514' || failure.code === '22P02') return 'book_invalid'
  return 'unknown'
}

/** A name the way the database stores it: trimmed, inner runs of spaces collapsed. */
export function normaliseName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

/** Whether the database will take this name (the check the sheet makes before sending). */
export function isValidName(name: string): boolean {
  const normalised = normaliseName(name)
  return normalised.length > 0 && normalised.length <= NAME_MAX
}

type CollectionRow = { id: string; name: string; position: number; created_at: string }
type SummaryRow = CollectionRow & {
  count: { count: number }[]
  firsts: { position: number; entry: { book: BookRow } }[]
}
type DetailRow = CollectionRow & { entries: { position: number; entry: EntryRow }[] }

// An entry as the Library reads it: its Book and its latest session.
const ENTRY = ENTRY_COLUMNS

export type Collections = {
  /** The member's Collections in her order, each with its size and first covers. */
  list: () => Promise<CollectionResult<CollectionSummary[]>>
  /** One Collection with its entries in her order; null when it is not hers (or gone). */
  get: (id: string) => Promise<CollectionResult<Collection | null>>
  /** The ids of the member's Collections an entry is on. */
  memberships: (entryId: string) => Promise<CollectionResult<string[]>>
  /** Makes an empty Collection at the end of her list. */
  create: (name: string) => Promise<CollectionResult<CollectionSummary>>
  rename: (id: string, name: string) => Promise<CollectionResult<CollectionSummary>>
  /** Deletes a Collection. The Books on it stay in the Library. */
  delete: (id: string) => Promise<CollectionResult<true>>
  /**
   * Puts a Book on a Collection, at its end. A Catalogue Book or Manual book
   * goes by its id, a search result as its snapshot; either way a Book that is
   * not in the Library yet goes onto Want to read first, in the same call.
   * Returns the member's entry for it.
   */
  addEntry: (collectionId: string, book: Book | BookSnapshot) => Promise<CollectionResult<LibraryEntry>>
  /** Takes an entry off a Collection; it stays in the Library. */
  removeEntry: (collectionId: string, entryId: string) => Promise<CollectionResult<true>>
  /** Puts the Collection's entries in this order: every entry on it, once, first to last. */
  reorder: (collectionId: string, entryIds: readonly string[]) => Promise<CollectionResult<true>>
}

export function createCollections(client: SupabaseClient, { online = () => true }: WriteOptions = {}): Collections {
  const OFFLINE = { data: null, error: 'offline' } as const
  function summaryOf(row: CollectionRow, count = 0, covers: Book[] = []): CollectionSummary {
    return { id: row.id, name: row.name, position: row.position, createdAt: row.created_at, count, covers }
  }

  return {
    async list() {
      const { data, error } = await client
        .from('collections')
        .select(
          'id, name, position, created_at, count:collection_entries(count), ' +
            'firsts:collection_entries(position, entry:library_entries!inner(book:books!inner(*)))',
        )
        .order('position')
        .order('position', { referencedTable: 'firsts' })
        .limit(MOSAIC_SIZE, { referencedTable: 'firsts' })
        .returns<SummaryRow[]>()
      if (error) return { data: null, error: mapCollectionError(error) }
      return {
        data: data.map((row) =>
          summaryOf(row, row.count[0]?.count ?? 0, row.firsts.map((first) => bookFromRow(first.entry.book))),
        ),
        error: null,
      }
    },

    async get(id) {
      const { data, error } = await client
        .from('collections')
        .select(`id, name, position, created_at, entries:collection_entries(position, entry:library_entries!inner(${ENTRY}))`)
        .eq('id', id)
        .order('position', { referencedTable: 'entries' })
        .maybeSingle<DetailRow>()
      if (error) {
        // An id that is not a uuid is simply not one of hers.
        if (error.code === '22P02') return { data: null, error: null }
        return { data: null, error: mapCollectionError(error) }
      }
      if (!data) return { data: null, error: null }
      return {
        data: {
          id: data.id,
          name: data.name,
          position: data.position,
          createdAt: data.created_at,
          entries: data.entries.map((item) => entryFromRow(item.entry)),
        },
        error: null,
      }
    },

    async memberships(entryId) {
      const { data, error } = await client
        .from('collection_entries')
        .select('collection_id')
        .eq('entry_id', entryId)
        .returns<{ collection_id: string }[]>()
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: data.map((row) => row.collection_id), error: null }
    },

    async create(name) {
      if (!online()) return OFFLINE
      const { data, error } = await client.rpc('create_collection', { p_name: name })
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: summaryOf(data as CollectionRow), error: null }
    },

    async rename(id, name) {
      if (!online()) return OFFLINE
      const { data, error } = await client.rpc('rename_collection', { p_collection: id, p_name: name })
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: summaryOf(data as CollectionRow), error: null }
    },

    async delete(id) {
      if (!online()) return OFFLINE
      const { error } = await client.rpc('delete_collection', { p_collection: id })
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },

    async addEntry(collectionId, book) {
      if (!online()) return OFFLINE
      const p_book = 'id' in book ? { id: book.id } : bookToRow(book)
      const added = await client.rpc('add_to_collection', { p_collection: collectionId, p_book })
      if (added.error) return { data: null, error: mapCollectionError(added.error) }
      // The function returns the entry; the Book comes with it in a second read
      // (as the Catalogue holds it, which may be an earlier snapshot than ours).
      const entry = await client
        .from('library_entries')
        .select(ENTRY)
        .eq('id', (added.data as { id: string }).id)
        .single<EntryRow>()
      if (entry.error) return { data: null, error: mapCollectionError(entry.error) }
      return { data: entryFromRow(entry.data), error: null }
    },

    async removeEntry(collectionId, entryId) {
      if (!online()) return OFFLINE
      const { error } = await client.rpc('remove_from_collection', { p_collection: collectionId, p_entry: entryId })
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },

    async reorder(collectionId, entryIds) {
      if (!online()) return OFFLINE
      const { error } = await client.rpc('reorder_collection', { p_collection: collectionId, p_entries: [...entryIds] })
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },
  }
}

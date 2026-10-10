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
import { isNoAnswer } from './network'
import { allPages } from './paging'
import type { QueuedAction } from './queuedWrites'

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

export function createCollections(client: SupabaseClient, { online = () => true, queue }: WriteOptions = {}): Collections {
  const OFFLINE = { data: null, error: 'offline' } as const

  /**
   * The write into the outbox, if writes wait now (issue #93, `WriteOptions.queue`):
   * a change to a Collection the device holds. True once it waits; `offline` for
   * a Collection the device does not know; null: it goes to the database as before.
   */
  async function queued(
    action: QueuedAction,
    collectionId: string,
    args: Record<string, unknown>,
    entryId?: string,
    /** The call to the database got no answer (data/network.ts): the write waits whether or not the device knew. */
    unanswered = false,
  ): Promise<CollectionResult<CollectionSummary> | null> {
    if (!queue || !(unanswered || queue.holds())) return null
    const known = queue.collection(collectionId)
    if (!known) return OFFLINE
    await queue.add({ action, args, about: known.name, queuedAt: new Date().toISOString(), entryId })
    return { data: known, error: null }
  }
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
      // The entries under the Collection are cut at 1,000 too (max_rows reaches embedded rows), so they are
      // read page by page, in their position (unique within a Collection), with the Collection's own row
      // coming back each time (data/paging.ts).
      const seen: { head: Omit<DetailRow, 'entries'> | null } = { head: null }
      const pages = await allPages<DetailRow['entries'][number]>(async (from, to) => {
        const { data, error } = await client
          .from('collections')
          .select(`id, name, position, created_at, entries:collection_entries(position, entry:library_entries!inner(${ENTRY}))`)
          .eq('id', id)
          .order('position', { referencedTable: 'entries' })
          .range(from, to, { referencedTable: 'entries' })
          .maybeSingle<DetailRow>()
        if (error) return { data: null, error }
        if (data) seen.head = data
        return { data: data?.entries ?? [], error: null }
      })
      if (pages.error) {
        // An id that is not a uuid is simply not one of hers.
        if (pages.error.code === '22P02') return { data: null, error: null }
        return { data: null, error: mapCollectionError(pages.error) }
      }
      const found = seen.head
      if (!found) return { data: null, error: null }
      return {
        data: {
          id: found.id,
          name: found.name,
          position: found.position,
          createdAt: found.created_at,
          entries: pages.data.map((item) => entryFromRow(item.entry)),
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
      const { data, error, status } = await client.rpc('create_collection', { p_name: name })
      if (isNoAnswer({ error, status })) return OFFLINE
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: summaryOf(data as CollectionRow), error: null }
    },

    async rename(id, name) {
      const waiting = await queued('rename_collection', id, { p_collection: id, p_name: name })
      if (waiting) return waiting.error ? waiting : { data: { ...waiting.data, name: normaliseName(name) }, error: null }
      if (!online()) return OFFLINE
      const { data, error, status } = await client.rpc('rename_collection', { p_collection: id, p_name: name })
      if (isNoAnswer({ error, status })) {
        const late = await queued('rename_collection', id, { p_collection: id, p_name: name }, undefined, true)
        if (!late) return OFFLINE
        return late.error ? late : { data: { ...late.data, name: normaliseName(name) }, error: null }
      }
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: summaryOf(data as CollectionRow), error: null }
    },

    async delete(id) {
      const waiting = await queued('delete_collection', id, { p_collection: id })
      if (waiting) return waiting.error ? waiting : { data: true, error: null }
      if (!online()) return OFFLINE
      const { error, status } = await client.rpc('delete_collection', { p_collection: id })
      if (isNoAnswer({ error, status })) {
        const late = await queued('delete_collection', id, { p_collection: id }, undefined, true)
        if (!late) return OFFLINE
        return late.error ? late : { data: true, error: null }
      }
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },

    async addEntry(collectionId, book) {
      const p_book = 'id' in book ? { id: book.id } : bookToRow(book)
      if (queue?.holds()) {
        // Only a Book in the Library can wait: putting one in the Library as well is an add, online.
        const entry = 'id' in book ? queue.entryForBook(book.id) : null
        if (!entry) return OFFLINE
        const waiting = await queued('add_to_collection', collectionId, { p_collection: collectionId, p_book }, entry.id)
        return waiting!.error ? waiting! : { data: entry, error: null }
      }
      if (!online()) return OFFLINE
      const added = await client.rpc('add_to_collection', { p_collection: collectionId, p_book })
      if (isNoAnswer(added)) {
        // Only a Book in the Library can wait (as above).
        const entry = 'id' in book ? queue?.entryForBook(book.id) : null
        const late = entry && (await queued('add_to_collection', collectionId, { p_collection: collectionId, p_book }, entry.id, true))
        if (!entry || !late) return OFFLINE
        return late.error ? late : { data: entry, error: null }
      }
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
      const waiting = await queued('remove_from_collection', collectionId, { p_collection: collectionId, p_entry: entryId }, entryId)
      if (waiting) return waiting.error ? waiting : { data: true, error: null }
      if (!online()) return OFFLINE
      const { error, status } = await client.rpc('remove_from_collection', { p_collection: collectionId, p_entry: entryId })
      if (isNoAnswer({ error, status })) {
        const late = await queued('remove_from_collection', collectionId, { p_collection: collectionId, p_entry: entryId }, entryId, true)
        if (!late) return OFFLINE
        return late.error ? late : { data: true, error: null }
      }
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },

    async reorder(collectionId, entryIds) {
      const waiting = await queued('reorder_collection', collectionId, { p_collection: collectionId, p_entries: [...entryIds] })
      if (waiting) return waiting.error ? waiting : { data: true, error: null }
      if (!online()) return OFFLINE
      const { error, status } = await client.rpc('reorder_collection', { p_collection: collectionId, p_entries: [...entryIds] })
      if (isNoAnswer({ error, status })) {
        const late = await queued('reorder_collection', collectionId, { p_collection: collectionId, p_entries: [...entryIds] }, undefined, true)
        if (!late) return OFFLINE
        return late.error ? late : { data: true, error: null }
      }
      if (error) return { data: null, error: mapCollectionError(error) }
      return { data: true, error: null }
    },
  }
}

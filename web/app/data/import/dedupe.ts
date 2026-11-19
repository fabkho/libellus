import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from '../books.ts'
import { mapLibraryError, type LibraryEntry, type Result } from '../library.ts'
import { normalise } from '../merge.ts'
import { SUPPORTED_SOURCES } from './detect.ts'
import { sameVolume } from './editions.ts'
import { surname, workTitle } from './readingTracker.ts'
import type { ImportBook } from './rows.ts'

/**
 * What she has already, as the device answers it for a whole file at once: the entries an earlier import of a
 * supported app's export made (`importedKeys`), and whether she holds a row's book under any edition
 * (`libraryTitleIndex`, issue #104).
 *
 * Framework-free and on the device's side of the import on purpose (proposal #329, plan import-seam): the upload path
 * (`data/importUpload.ts`) reads a file and asks only these questions before the rows go to the server job. Nothing of
 * the match engine is here, so the `/import` chunk holds this and not `data/bookImport.ts` (the lookups, the ladder,
 * the writes the Edge Function runs).
 */

/**
 * Her Library, ready to answer "does she have this Book?" for a whole file at
 * once: the same Book, ISBN-13 or source id; for a Manual book, the same
 * title and first author.
 */
export function libraryIndex(entries: readonly LibraryEntry[]): (book: Book | BookSnapshot) => LibraryEntry | null {
  const byKey = new Map<string, LibraryEntry>()
  const manualKey = (book: Pick<BookSnapshot, 'title' | 'authors'>) => `manual:${normalise(book.title)}|${normalise(book.authors[0] ?? '')}`
  for (const entry of entries) {
    const theirs = entry.book
    byKey.set(`id:${theirs.id}`, entry)
    if (theirs.source === 'manual') {
      byKey.set(manualKey(theirs), entry)
      continue
    }
    if (theirs.isbn13) byKey.set(`isbn:${theirs.isbn13}`, entry)
    if (theirs.appleId) byKey.set(`apple:${theirs.appleId}`, entry)
    if (theirs.openLibraryEditionKey) byKey.set(`ol:${theirs.openLibraryEditionKey}`, entry)
  }
  return (book) => {
    if ('id' in book) return byKey.get(`id:${book.id}`) ?? null
    if (book.source === 'manual') return byKey.get(manualKey(book)) ?? null
    const keys = [
      book.isbn13 && `isbn:${book.isbn13}`,
      book.appleId && `apple:${book.appleId}`,
      book.openLibraryEditionKey && `ol:${book.openLibraryEditionKey}`,
    ]
    for (const key of keys) if (key && byKey.has(key)) return byKey.get(key)!
    return null
  }
}

/**
 * Her Library, ready to answer "does she have this row's book, under any
 * edition?" (issue #104): an entry whose Book has the same work title (brackets
 * and subtitle dropped) and an author with the first author's surname. After
 * Change edition the entry holds another edition than the file's ISBN finds,
 * so the Book itself no longer matches (`libraryIndex`). For a finished row
 * that has an end day, her entry's latest read must not have ended on another
 * day; an entry without a read, or a read without a day, still matches. The
 * database applies the same rule (`import_books`), so this only spares the
 * lookups. Edited dates, or a title she changed, may still import a second
 * entry: accepted, her own edit. An entry imported from one of the file's
 * other rows of the work (`otherKeys`, looked up in `imported`: key → entry
 * id) is another edition she shelved and never matches (#111).
 */
export function libraryTitleIndex(
  entries: readonly LibraryEntry[],
  imported: ReadonlyMap<string, string> = new Map(),
): (row: Pick<ImportBook, 'title' | 'authors' | 'status' | 'session' | 'otherKeys'>) => LibraryEntry | null {
  const byTitle = new Map<string, LibraryEntry[]>()
  for (const entry of entries) {
    const key = workTitle(entry.book.title)
    if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), entry])
  }
  return (row) => {
    const candidates = byTitle.get(workTitle(row.title))
    if (!candidates) return null
    const wanted = surname(row.authors[0])
    const endedOn = row.status === 'finished' ? row.session?.endedOn : null
    const siblings = new Set((row.otherKeys ?? []).map((key) => imported.get(key)).filter(Boolean))
    return (
      candidates.find((entry) => {
        if (siblings.has(entry.id)) return false
        // Another volume of the same series shares the work title ("Heartstopper: Volume Two").
        if (!sameVolume(row.title, entry.book.title)) return false
        if (wanted && !entry.book.authors.some((name) => surname(name) === wanted)) return false
        const ended = entry.latestSession?.endedOn
        return !(endedOn && ended && ended !== endedOn)
      }) ?? null
    )
  }
}

/** The member's entry for one Book, if she has it (`libraryIndex`). */
export function entryFor(book: Book | BookSnapshot, entries: readonly LibraryEntry[]): LibraryEntry | null {
  return libraryIndex(entries)(book)
}

/**
 * Every entry the member imported from a supported app's export before (any of
 * them): its key → the entry's id. Asked page by page (the API answers 1,000
 * rows a request), so a library of any size is known whole.
 */
export async function importedKeys(client: SupabaseClient): Promise<Result<Map<string, string>>> {
  const keys = new Map<string, string>()
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('library_entries')
      .select('id, import_key')
      .not('import_key', 'is', null)
      .order('id')
      .range(from, from + page - 1)
      .returns<{ id: string; import_key: string }[]>()
    if (error) return { data: null, error: mapLibraryError(error) }
    for (const row of data) {
      if (SUPPORTED_SOURCES.some((source) => row.import_key.startsWith(`${source}:`))) keys.set(row.import_key, row.id)
    }
    if (data.length < page) return { data: keys, error: null }
  }
}

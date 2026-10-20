import type { SupabaseClient } from '@supabase/supabase-js'
import { importedKeys, libraryTitleIndex } from './bookImport'
import { createCatalogueSearch } from './catalogueSearch'
import { decodeExport, NotACsvFileError } from './import/csv'
import { parseExport } from './import/detect'
import { MissingColumnsError, UnknownExportError, type ImportBook, type ImportSource } from './import/rows'

/**
 * What the device does of an import (proposal #329): reads the file, as before, and makes what the server job needs of it, the rows
 * that are worth uploading. The lookups, the covers and the write are the job's (`data/importJob.ts`); nothing here asks a
 * source anything.
 *
 * A row is not uploaded when it is decided already: imported by an earlier run of this file (`import_key`), or hers under another
 * edition (the title index, #104); the job is told how many (`already`), they count as "kept" in its summary.
 *
 * Framework-free (the client and the day come in), so Vitest reads real exports through it.
 */

/**
 * Why a file could not be used. Copy: `import.fileError.<code>`. `notCsv`: a spreadsheet or anything else that is no text table;
 * `notSupported`: a CSV no supported app wrote; `storygraph`, `librarything`, `bookshelf`: another app's CSV, told by its header,
 * which BetterReads does not read yet; `missingColumns`: a supported app's export without columns its rows need; `empty`: no
 * book in it; `unreadable`; `unknown`: her Library could not be read.
 */
export type FileError = 'notSupported' | 'notCsv' | 'storygraph' | 'librarything' | 'bookshelf' | 'missingColumns' | 'empty' | 'unreadable' | 'unknown'

export type Prepared =
  | {
      ok: true
      source: ImportSource
      /** Books in the file. */
      books: number
      /** Rows to upload (each a parsed row with the Collections she keeps for it). */
      rows: Record<string, unknown>[]
      /** Rows the device left out: decided already. */
      already: number
    }
  | { ok: false; error: FileError; detail?: { source: ImportSource; columns: string[] } }

/** A row over this is trimmed (the server refuses a row over 20 kB, and one such row would refuse the whole file). */
const ROW_MAX_CHARS = 14_000

/** The parsed row as uploaded: all her other shelves are kept as Collections (there is no step left to decline them in). */
export function uploadRow(book: ImportBook): Record<string, unknown> {
  const row: Record<string, unknown> = { ...book, collections: [...new Set(book.shelves)] }
  if (JSON.stringify(row).length > ROW_MAX_CHARS) {
    // Only a runaway review can be that long: the book is imported without its text.
    row.session = book.session ? { ...book.session, review: null } : null
    row.earlierReads = book.earlierReads.slice(0, 20)
    row.problems = []
  }
  return row
}

/** Reads the file's bytes and decides which rows the job gets. Never throws. */
export async function prepareUpload(client: SupabaseClient, bytes: Uint8Array, today: string): Promise<Prepared> {
  let parsed: ReturnType<typeof parseExport>
  try {
    parsed = parseExport(decodeExport(bytes), today)
  } catch (error) {
    if (error instanceof MissingColumnsError) return { ok: false, error: 'missingColumns', detail: { source: error.source, columns: error.missing } }
    if (error instanceof NotACsvFileError) return { ok: false, error: 'notCsv' }
    if (error instanceof UnknownExportError) return { ok: false, error: error.app ?? 'notSupported' }
    return { ok: false, error: 'unreadable' }
  }
  if (!parsed.books.length) return { ok: false, error: 'empty' }

  // What she has already: rows imported before are not uploaded again, nor are books she holds under another edition.
  const catalogue = createCatalogueSearch(client)
  const [keys, library] = await Promise.all([importedKeys(client), catalogue.libraryEntries().catch(() => null)])
  if (keys.error || !library) return { ok: false, error: 'unknown' }
  const ownedUnderAnyEdition = libraryTitleIndex(library, keys.data)
  const rows: Record<string, unknown>[] = []
  for (const book of parsed.books) {
    if (keys.data.has(book.key) || ownedUnderAnyEdition(book)) continue
    rows.push(uploadRow(book))
  }
  return { ok: true, source: parsed.source, books: parsed.books.length, rows, already: parsed.books.length - rows.length }
}

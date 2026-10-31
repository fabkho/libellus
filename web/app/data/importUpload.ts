import type { SupabaseClient } from '@supabase/supabase-js'
import { importedKeys, libraryTitleIndex } from './bookImport'
import { createCatalogueSearch } from './catalogueSearch'
import { decodeExport, NotACsvFileError } from './import/csv'
import { parseExport } from './import/detect'
import {
  HardcoverZipError,
  MissingColumnsError,
  UnknownExportError,
  type ImportBook,
  type ImportFile,
  type ImportSource,
  type ZipErrorCode,
} from './import/rows'

/**
 * What the device does of an import (proposal #329): reads the file, as before, and makes what the server job needs of it, the rows
 * that are worth uploading. The lookups, the covers and the write are the job's (`data/importJob.ts`); nothing here asks a
 * source anything.
 *
 * A Hardcover "everything" zip (docs/plans/hardcover-zip.md) is read here too, behind `options.zip` (the picker's flag,
 * `NUXT_PUBLIC_IMPORT_ZIP`): the bytes decide, not the name (`PK\x03\x04` is a zip, anything else is read as a CSV, as before). Its
 * reader is loaded only then (a lazy chunk). What a zip knows beyond a CSV goes to the job (plan, PR 2): the session's `progress`
 * on the row, and `collectionOrder` and `emptyCollections` with the start (`Prepared`), and so does the cover address (`coverHint`: the
 * job checks it again and uses it as its `hardcover` cover source, plan PR 3). A CSV carries none of these, so its upload is what it was.
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
 * book in it; `unreadable`; `unknown`: her Library could not be read. A Hardcover zip: `zipUnknown` (no manifest, or another format),
 * `zipVersion` (a newer layout), `zipMissing` (files it lacks, in `detail.files`), `zipTooBig` (over a limit, hardcoverZip.ts).
 */
export type FileError =
  | 'notSupported'
  | 'notCsv'
  | 'storygraph'
  | 'librarything'
  | 'bookshelf'
  | 'missingColumns'
  | 'empty'
  | 'unreadable'
  | 'unknown'
  | Exclude<ZipErrorCode, 'unreadable'>

/** What a failure adds to its message: the columns a CSV lacks, or the files a zip lacks. */
export type FileErrorDetail = { source: ImportSource; columns: string[] } | { files: string[] }

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
      /** Hardcover zip: her ranked lists with the keys of their rows in rank order (sent with the start; empty for a CSV). */
      collectionOrder: NonNullable<ImportFile['collectionOrder']>
      /** Hardcover zip: her lists without a book (sent with the start; empty for a CSV). */
      emptyCollections: string[]
    }
  | { ok: false; error: FileError; detail?: FileErrorDetail }

/** A row over this is trimmed (the server refuses a row over 20 kB, and one such row would refuse the whole file). */
const ROW_MAX_CHARS = 14_000

/**
 * The parsed row as uploaded: all her other shelves are kept as Collections (there is no step left to decline them in).
 * What only a zip carries goes along: the session's progress (the job writes it, `import_books`) and the cover address
 * (`coverHint`, a Hardcover address the job uses as a cover source).
 */
export function uploadRow(book: ImportBook): Record<string, unknown> {
  const session = book.session ?? null
  const row: Record<string, unknown> = { ...book, session, collections: [...new Set(book.shelves)] }
  if (JSON.stringify(row).length > ROW_MAX_CHARS) {
    // Only a runaway review can be that long: the book is imported without its text.
    row.session = session ? { ...session, review: null } : null
    row.earlierReads = book.earlierReads.slice(0, 20)
    row.problems = []
  }
  return row
}

/** `PK\x03\x04`: a zip's first entry. */
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

/** The file's rows: a zip (when `zip`) with the Hardcover reader, loaded now; anything else as a CSV of any supported app. Throws. */
async function parseFile(bytes: Uint8Array, today: string, zip: boolean): Promise<ImportFile> {
  if (zip && isZip(bytes)) {
    const { readHardcoverZip, mapHardcoverExport } = await import('./import/hardcoverZip')
    return mapHardcoverExport(await readHardcoverZip(bytes), today)
  }
  return parseExport(decodeExport(bytes), today)
}

/** Reads the file's bytes and decides which rows the job gets. Never throws. */
export async function prepareUpload(client: SupabaseClient, bytes: Uint8Array, today: string, options: { zip?: boolean } = {}): Promise<Prepared> {
  let parsed: ImportFile
  try {
    parsed = await parseFile(bytes, today, options.zip ?? false)
  } catch (error) {
    if (error instanceof MissingColumnsError) return { ok: false, error: 'missingColumns', detail: { source: error.source, columns: error.missing } }
    if (error instanceof NotACsvFileError) return { ok: false, error: 'notCsv' }
    if (error instanceof UnknownExportError) return { ok: false, error: error.app ?? 'notSupported' }
    if (error instanceof HardcoverZipError) {
      if (error.code === 'zipMissing') return { ok: false, error: 'zipMissing', detail: { files: error.files } }
      return { ok: false, error: error.code }
    }
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
  return {
    ok: true,
    source: parsed.source,
    books: parsed.books.length,
    rows,
    already: parsed.books.length - rows.length,
    collectionOrder: parsed.collectionOrder ?? [],
    emptyCollections: parsed.emptyCollections ?? [],
  }
}

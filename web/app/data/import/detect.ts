import { canonicalRows, readCsv } from './csv'
import { goodreadsAdapter } from './goodreads'
import { hardcoverAdapter } from './hardcover'
import {
  mapRows,
  missingColumns,
  MissingColumnsError,
  UnknownExportError,
  type ImportAdapter,
  type ImportFile,
  type ImportSource,
  type OtherApp,
} from './rows'

/**
 * Which app wrote a file (issue #111): the member drops any supported export
 * and Libellus tells by its header, never by asking. Each adapter names the
 * columns that point to its app with a weight (3: only that app writes it;
 * goodreads.ts, hardcover.ts); a header scores the sum of the ones it has, in
 * any order and case. The best score from `MIN_SCORE` up decides; a header
 * that scores for an app but lacks the columns its rows need is that app's
 * export with columns missing (`MissingColumnsError`, naming them); a header
 * that scores for none is no supported export (`UnknownExportError`, naming
 * the app that wrote it when its header tells: StoryGraph, LibraryThing,
 * Bookshelf).
 *
 * A new app is one more adapter in `ADAPTERS`.
 */

/** Every app whose export Libellus reads, in the order the Import page names them. */
export const ADAPTERS: readonly ImportAdapter[] = [goodreadsAdapter, hardcoverAdapter]

export const SUPPORTED_SOURCES: readonly ImportSource[] = ADAPTERS.map((adapter) => adapter.source)

/** The least score that makes a header an app's: one column only that app writes, or a few that point to it. */
export const MIN_SCORE = 3

/** How strongly a header points to an adapter's app. */
export function scoreHeader(adapter: Pick<ImportAdapter, 'signature'>, columns: readonly string[]): number {
  const have = new Set(columns.map((column) => column.toLowerCase()))
  return Object.entries(adapter.signature).reduce((score, [name, weight]) => score + (have.has(name.toLowerCase()) ? weight : 0), 0)
}

/** Which other app wrote a CSV, by its header; null when none we know. */
export function otherAppOf(columns: readonly string[]): OtherApp | null {
  const has = (name: string) => columns.some((column) => column.toLowerCase() === name.toLowerCase())
  if (has('Read Status') && (has('Star Rating') || has('Authors'))) return 'storygraph'
  if (has('Primary Author') || (has('Book Id') && has('Collections') && has('Entry Date'))) return 'librarything'
  if (has('Name') && has('Status') && has('Finished')) return 'bookshelf'
  return null
}

/**
 * The adapter a header belongs to. Throws UnknownExportError when it is no
 * supported app's, MissingColumnsError when it is one's but incomplete.
 */
export function detectExport(columns: readonly string[]): ImportAdapter {
  let best: ImportAdapter | null = null
  let bestScore = 0
  for (const adapter of ADAPTERS) {
    const score = scoreHeader(adapter, columns)
    if (score > bestScore) {
      best = adapter
      bestScore = score
    }
  }
  if (!best || bestScore < MIN_SCORE) throw new UnknownExportError(otherAppOf(columns))
  const missing = missingColumns(best, columns)
  if (missing.length) throw new MissingColumnsError(best.source, missing)
  return best
}

/** Reads a file of any supported app: detects which, then maps its rows with that app's adapter. */
export function parseExport(text: string, today: string): ImportFile {
  const { columns, rows } = readCsv(text)
  const adapter = detectExport(columns)
  return mapRows(adapter, canonicalRows(rows, columns, adapter.columns), today)
}

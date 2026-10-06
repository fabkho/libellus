import Papa from 'papaparse'

/**
 * Reading an export file into a table, before anyone knows which app wrote it
 * (issue #111): the bytes as text, the delimiter, the header. Framework-free
 * and source-neutral; the adapters (goodreads.ts, hardcover.ts) say what the
 * columns mean, detect.ts which adapter a header belongs to.
 *
 * What a file may have gone through: a BOM; Windows-1252 instead of UTF-8 and
 * `;` instead of `,` once a spreadsheet saved it again (Excel in most of
 * Europe); Excel's own `sep=;` first line; quoted header cells; header cells
 * with stray spaces or another case.
 */

/** One row of the file: its cells by (canonical) column name. */
export type Row = Record<string, string | undefined>

/** A file that is no text table at all: a spreadsheet, a zip, an image. */
export class NotACsvFileError extends Error {
  constructor() {
    super('Not a CSV file')
    this.name = 'NotACsvFileError'
  }
}

/**
 * The file's bytes as text: UTF-8 as the apps write it, else Windows-1252 (a
 * file a spreadsheet saved again on Windows), so umlauts survive either way.
 * Throws NotACsvFileError for something that is no text at all (an `.xlsx`, a
 * zip, an image: NUL bytes or a zip's `PK` signature).
 */
export function decodeExport(bytes: Uint8Array): string {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new NotACsvFileError()
  if (bytes.subarray(0, 4096).includes(0)) throw new NotACsvFileError()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** A header cell as written, made comparable: no BOM, quotes or doubled spaces. */
export const headerName = (name: string) =>
  name
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The file as a table: its columns (as written, tidied) and its rows. The
 * delimiter is found from the header (`,`, `;`, tab), or taken from Excel's
 * `sep=` line when the file starts with one.
 */
export function readCsv(text: string): { columns: string[]; rows: Row[] } {
  let body = text.replace(/^\uFEFF/, '')
  const sep = /^"?sep=(.)"?\r?\n/i.exec(body)
  if (sep) body = body.slice(sep[0].length)
  const parsed = Papa.parse<Row>(body, {
    header: true,
    skipEmptyLines: 'greedy',
    ...(sep ? { delimiter: sep[1] } : { delimitersToGuess: [',', ';', '\t'] }),
    transformHeader: headerName,
  })
  return { columns: (parsed.meta.fields ?? []).filter(Boolean), rows: parsed.data }
}

/**
 * The rows with their cells under the names an adapter reads, whatever case the
 * file wrote them in (`Hardcover Book Id` → `Hardcover Book ID`). Columns the
 * adapter does not know stay as they are.
 */
export function canonicalRows(rows: readonly Row[], columns: readonly string[], known: readonly string[]): Row[] {
  const byLower = new Map(known.map((name) => [name.toLowerCase(), name]))
  const renames = columns
    .map((column) => [column, byLower.get(column.toLowerCase())] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]) && pair[0] !== pair[1])
  if (!renames.length) return [...rows]
  return rows.map((row) => {
    const copy: Row = { ...row }
    for (const [written, name] of renames) {
      copy[name] = row[written]
      delete copy[written]
    }
    return copy
  })
}

/**
 * Counts of a Hardcover "everything" zip as the import reads it (docs/plans/hardcover-zip.md, "Local acceptance"): NUMBERS ONLY, never a
 * title, a name, a date, a list name or an id, so a real export (a person's data) can be measured without a word of it leaving
 * the terminal. Run it before each release that touches the zip reader, on a fresh export: one renamed field shows up as a count
 * that moved.
 *
 *   pnpm tsx scripts/import-zip-counts.ts /path/to/hardcover-export.zip
 *
 * Prints, one `name: number` per line: rows (library, list-only, skipped by code), by status, reads (sessions, earlier, undated),
 * ratings, reviews, progress (page, percent), ISBN-13 (library, list-only), Collections (total, ranked, empty) and cover hints
 * (kept, under the least side, another host, none; library and list-only apart).
 */
import { readFileSync } from 'node:fs'
import { mapHardcoverExport, readHardcoverZip, type CoverCount } from '../app/data/import/hardcoverZip'
import type { ImportBook } from '../app/data/import/rows'

const path = process.argv[2]
if (!path) {
  console.error('import-zip-counts: name the zip: pnpm tsx scripts/import-zip-counts.ts /path/to/export.zip')
  process.exit(2)
}

const count = <T>(items: readonly T[], test: (item: T) => boolean) => items.filter(test).length
const today = new Date().toISOString().slice(0, 10)
const covers: Record<'library' | 'listOnly', Record<string, number>> = { library: {}, listOnly: {} }
const onCover: CoverCount = (kind, verdict) => {
  covers[kind][verdict] = (covers[kind][verdict] ?? 0) + 1
}

const exp = await readHardcoverZip(new Uint8Array(readFileSync(path)))
const file = mapHardcoverExport(exp, today, onCover)
const fromList = (book: ImportBook) => book.problems.some((problem) => problem.code === 'fromList')
const library = file.books.filter((book) => !fromList(book))
const listOnly = file.books.filter(fromList)

const lines: [string, number][] = [
  ['rows', file.books.length],
  ['rows library', library.length],
  ['rows list-only', listOnly.length],
]
const skipped = new Map<string, number>()
for (const skip of file.skipped) skipped.set(skip.problem.code, (skipped.get(skip.problem.code) ?? 0) + 1)
for (const [code, total] of [...skipped].sort()) lines.push([`skipped ${code}`, total])
const sessions = file.books.flatMap((book) => (book.session ? [book.session] : []))
lines.push(
  ['status finished', count(file.books, (book) => book.status === 'finished')],
  ['status finished, abandoned', count(sessions, (session) => session.outcome === 'abandoned')],
  ['status reading', count(file.books, (book) => book.status === 'reading')],
  ['status want to read', count(file.books, (book) => book.status === 'want_to_read')],
  ['status want to read, library', count(library, (book) => book.status === 'want_to_read')],
  ['status want to read, list-only', listOnly.length],
  ['reads sessions', sessions.length],
  ['reads earlier', file.books.reduce((sum, book) => sum + book.earlierReads.length, 0)],
  ['reads undated (a session or a read without a day)', count(sessions, (session) => session.outcome === 'finished' && !session.endedOn) + file.books.reduce((sum, book) => sum + book.extraReads, 0)],
  ['ratings', count(sessions, (session) => session.rating !== null)],
  ['reviews', count(sessions, (session) => session.review !== null)],
  ['progress page', count(sessions, (session) => Boolean(session.progress && 'page' in session.progress))],
  ['progress percent', count(sessions, (session) => Boolean(session.progress && 'percent' in session.progress))],
  ['isbn13 library', count(library, (book) => book.isbn13 !== null)],
  ['isbn13 list-only', count(listOnly, (book) => book.isbn13 !== null)],
)
const names = new Set([...file.books.flatMap((book) => book.shelves), ...(file.emptyCollections ?? [])])
lines.push(
  ['collections', names.size],
  ['collections ranked', file.collectionOrder?.length ?? 0],
  ['collections empty', file.emptyCollections?.length ?? 0],
)
for (const kind of ['library', 'listOnly'] as const) {
  for (const verdict of ['kept', 'small', 'otherHost', 'none']) lines.push([`cover hints ${kind} ${verdict}`, covers[kind][verdict] ?? 0])
}
for (const [name, total] of lines) console.log(`${name}: ${total}`)

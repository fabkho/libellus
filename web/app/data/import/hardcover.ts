import type { EntryStatus } from '../library'
import { plainText } from '../apple'
import type { Row } from './csv'
import { normalize, splitSeriesTitle } from './readingTracker'
import {
  clipReview,
  collectionNames,
  field,
  importDay,
  importKey,
  importRating,
  isAbandonedShelf,
  isbnPair,
  isMangledIsbn,
  MAX_EXTRA_READS,
  positive,
  tidy,
  yearOf,
  type ImportAdapter,
  type ImportBook,
  type ImportProblem,
  type ImportRead,
  type ImportSession,
  type SkippedRow,
} from './rows'
import { languageCode } from './editions'

/**
 * The Hardcover adapter of the import (issue #111): one row of a Hardcover
 * export → the normalised import row (rows.ts).
 *
 * Hardcover writes one CSV (Account → Exports → CSV export) and reads the same
 * columns back as its "custom CSV import format"
 * (hardcover.app/pages/custom-csv-import-format, checked 2026-10): so both a
 * real export and a file a member made in that format by hand read here.
 * Header, in the order Hardcover writes it:
 *   Title, Author, Series, Status, Privacy, Hardcover Book ID,
 *   Hardcover Edition ID, ISBN 10, ISBN 13, ASIN, Media, Country Code,
 *   Language Code, Binding, Pages, Duration in Seconds, Publish Date,
 *   Publisher, Genres, Moods, Tags, Content Warnings, Lists, Date Added,
 *   Date Started, Date Finished, Rating, Review, Review Contains Spoilers,
 *   Sponsored Review, Review Date, Review URL, Review Media URL,
 *   Private Notes, Owned, Compilation, Review Slate
 * - `Title` without the series; `Series` `Mistborn (#1.0), The Cosmere`;
 * - `Author` comma-separated with roles: `Roberto Bolaño, Natasha Wimmer (Translator)`;
 * - `Status` `Want to Read`, `Currently Reading`, `Read`, `Did Not Finish`,
 *   `Paused`, `None` / `Ignored` (any case);
 * - `Date Started` and `Date Finished` comma-separated `YYYY-MM-DD`, one per
 *   read: the n-th start belongs to the n-th finish (a finish alone is a read
 *   with no start);
 * - `Rating` 0.5–5 in halves; `Review` text (Markdown, `\n` for a break);
 * - `Lists` comma-separated, each with an optional position `(#19)`;
 * - `Owned` `true`/`false` in the export, `Yes`/`No` in the custom format;
 * - `Media` `Book`, `Ebook`, `Audio`/`Audiobook`; `Language Code` `en`.
 *
 * The mapping:
 * - `Read` → Finished: the latest read is the row's session (its start and
 *   finish, the Rating as quarters, the review); the reads before it are
 *   earlier finished reads with their days;
 * - `Did Not Finish` → Finished, the latest read abandoned (no rating); reads
 *   before it finished;
 * - `Currently Reading` → an open read from its start (Date Added, else today,
 *   without one); finished reads before it as earlier reads. `Paused` reads the
 *   same, with a note (Libellus has no pause);
 * - `Want to Read` and anything else → Want to read, no reads;
 * - `None` / `Ignored` → skipped (Hardcover keeps it off her library too);
 * - Lists → Collections the preview offers (positions dropped), and `Owned`
 *   → the Collection "Owned";
 * - edition hints for the lookup: ISBN-13/10, Language Code, Media or Binding,
 *   Pages, the year of Publish Date, Publisher. Genres, moods, tags, content
 *   warnings, private notes, privacy and spoiler flags stay out.
 *
 * Key: `hardcover:<Hardcover Book ID>` (Hardcover keeps one per book in her
 * library), else the ISBN or the title and author.
 */

export const HARDCOVER_KEY_PREFIX = 'hardcover:'

/** Credits that are not the author's: dropped from the authors. */
const AUTHOR_ROLE = /^author$/i

/** `Roberto Bolaño, Natasha Wimmer (Translator)` → `['Roberto Bolaño']`; only credited roles when no author is left. */
export function hardcoverAuthors(value: string): string[] {
  const credits = value
    .split(',')
    .map(tidy)
    .filter(Boolean)
    .map((credit) => {
      const role = /^(.*?)\s*\(([^()]*)\)$/.exec(credit)
      return role ? { name: tidy(role[1]!), role: tidy(role[2]!) } : { name: credit, role: null }
    })
    .filter((credit) => credit.name)
  const authors = credits.filter((credit) => !credit.role || AUTHOR_ROLE.test(credit.role))
  const names = (authors.length ? authors : credits.slice(0, 1)).map((credit) => credit.name)
  return [...new Map(names.map((name) => [normalize(name), name])).values()]
}

/** `Mistborn (#1.0), The Cosmere` → `Mistborn, #1`: the first series, as Goodreads writes it. */
export function hardcoverSeries(value: string): string | null {
  const first = tidy(value.split(/,(?![^(]*\))/)[0] ?? '')
  if (!first) return null
  const position = /^(.*?)\s*\(#?\s*([\d.]+)\)$/.exec(first)
  if (!position) return first
  const number = Number(position[2])
  return Number.isFinite(number) && number > 0 ? `${position[1]}, #${number}` : position[1]!
}

/** `Owned, Favourites (#19)` → `['Owned', 'Favourites']`. */
export function hardcoverLists(value: string): string[] {
  return value
    .split(',')
    .map((name) => tidy(name).replace(/\s*\(#?\s*[\d.]+\)$/, ''))
    .filter(Boolean)
}

const truthy = (value: string) => /^(true|yes|y|1)$/i.test(value.trim())

/** The reads of a row: the n-th start with the n-th finish, oldest first. Days that are no day are dropped (`dateInvalid`). */
function hardcoverReads(started: string, finished: string, today: string, problems: ImportProblem[]): ImportRead[] {
  const invalid = () => {
    if (!problems.some((problem) => problem.code === 'dateInvalid')) problems.push({ code: 'dateInvalid' })
  }
  const days = (value: string) =>
    value.split(/[,;]/).map((text) => {
      const day = importDay(text, today)
      if (day === 'invalid') {
        invalid()
        return null
      }
      return day
    })
  // An empty list is no read; one empty cell between commas is a read without that day.
  const starts = started.trim() ? days(started) : []
  const ends = finished.trim() ? days(finished) : []
  const reads: ImportRead[] = []
  for (let index = 0; index < Math.max(starts.length, ends.length); index++) {
    let startedOn = starts[index] ?? null
    const endedOn = ends[index] ?? null
    if (startedOn && endedOn && endedOn < startedOn) {
      invalid()
      startedOn = null
    }
    if (startedOn || endedOn) reads.push({ startedOn, endedOn })
  }
  const at = (read: ImportRead) => read.endedOn ?? read.startedOn ?? ''
  return reads.sort((a, b) => at(a).localeCompare(at(b)))
}

/** Maps one row. `today` (`YYYY-MM-DD`, the member's) bounds the dates. A skipped row when it cannot be a book. */
export function mapHardcoverRow(row: Row, index: number, today: string): ImportBook | SkippedRow {
  const problems: ImportProblem[] = []
  const number = index + 1
  const rawTitle = tidy(field(row, 'Title'))
  if (!rawTitle) return { row: number, title: '', problem: { code: 'noTitle' } }
  const { title, seriesTitle } = splitSeriesTitle(rawTitle)

  const shelf = tidy(field(row, 'Status'))
  const statusName = shelf.toLowerCase()
  if (statusName === 'none' || statusName === 'ignored') return { row: number, title, problem: { code: 'notShelved' } }

  const { isbn13, isbn10 } = isbnPair(field(row, 'ISBN 13'), field(row, 'ISBN 10'))
  if (!isbn13 && (isMangledIsbn(field(row, 'ISBN 13')) || isMangledIsbn(field(row, 'ISBN 10')))) problems.push({ code: 'isbnMangled' })

  const added = importDay(field(row, 'Date Added'), today)
  if (added === 'invalid') problems.push({ code: 'dateInvalid' })
  const addedOn = added === 'invalid' ? null : added
  const reads = hardcoverReads(field(row, 'Date Started'), field(row, 'Date Finished'), today, problems)

  let rating = importRating(field(row, 'Rating'))
  if (rating === undefined) {
    problems.push({ code: 'ratingInvalid' })
    rating = null
  }
  // The custom format writes a line break as `\n`; Markdown stays as it is.
  const reviewText = field(row, 'Review').replace(/\\n/g, '\n')
  const review = clipReview(plainText(reviewText || undefined) ?? null, problems)

  let status: EntryStatus
  let session: ImportSession | null = null
  let earlierReads: ImportRead[] = []
  if (statusName === 'read' || isAbandonedShelf(statusName)) {
    status = 'finished'
    const abandoned = statusName !== 'read'
    const last = reads.at(-1) ?? { startedOn: null, endedOn: null }
    if (abandoned && rating !== null) problems.push({ code: 'abandonedRating' })
    session = {
      startedOn: last.startedOn,
      endedOn: last.endedOn,
      outcome: abandoned ? 'abandoned' : 'finished',
      rating: abandoned ? null : rating,
      review,
    }
    earlierReads = reads.slice(0, -1)
  } else if (statusName === 'currently reading' || statusName === 'paused') {
    status = 'reading'
    if (statusName === 'paused') problems.push({ code: 'paused' })
    // The open read: the latest one without a finish; the finished ones before it stay as reads.
    const open = [...reads].reverse().find((read) => !read.endedOn) ?? null
    session = { startedOn: open?.startedOn ?? addedOn ?? today, endedOn: null, outcome: null, rating: null, review: null }
    earlierReads = reads.filter((read) => read !== open && read.endedOn && read.endedOn <= session!.startedOn!)
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  } else {
    status = 'want_to_read'
    if (statusName && statusName !== 'want to read') problems.push({ code: 'otherShelf', shelf })
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  }
  earlierReads = earlierReads.slice(-MAX_EXTRA_READS)
  if (earlierReads.length) problems.push({ code: 'earlierReads', count: earlierReads.length })

  const media = tidy(field(row, 'Media'))
  const binding = tidy(field(row, 'Binding')) || (/audio/i.test(media) ? 'Audiobook' : media && !/^book$/i.test(media) ? media : '') || null
  const shelves = collectionNames([...hardcoverLists(field(row, 'Lists')), ...(truthy(field(row, 'Owned')) ? ['Owned'] : [])])
  const book = {
    title: title.slice(0, 500),
    series: hardcoverSeries(field(row, 'Series')) ?? seriesTitle,
    authors: hardcoverAuthors(field(row, 'Author')),
    isbn13,
    isbn10,
    pageCount: positive(field(row, 'Pages')),
    year: yearOf(field(row, 'Publish Date').slice(0, 4)),
    originalYear: null,
    binding,
    language: languageCode(field(row, 'Language Code')),
    publisher: tidy(field(row, 'Publisher')) || null,
  }
  const bookId = field(row, 'Hardcover Book ID')
  return {
    source: 'hardcover',
    key: importKey('hardcover', bookId, book),
    sourceId: /^\d{1,12}$/.test(bookId) ? bookId : null,
    row: number,
    ...book,
    shelf: shelf || 'Want to Read',
    shelves,
    status,
    session,
    earlierReads,
    extraReads: 0,
    otherKeys: [],
    addedOn,
    problems,
  }
}

export const hardcoverAdapter: ImportAdapter = {
  source: 'hardcover',
  required: ['Title', 'Author', 'Status'],
  signature: {
    'Hardcover Book ID': 3,
    'Hardcover Edition ID': 3,
    'Review Slate': 3,
    'Review Contains Spoilers': 2,
    'Sponsored Review': 2,
    'Duration in Seconds': 2,
    'Review Media URL': 2,
    'ISBN 13': 1,
    'ISBN 10': 1,
    'Date Started': 1,
    'Date Finished': 1,
    Lists: 1,
    Media: 1,
    'Language Code': 1,
    'Country Code': 1,
    Compilation: 1,
    Owned: 1,
    'Publish Date': 1,
  },
  columns: [
    'Title', 'Author', 'Series', 'Status', 'Privacy', 'Hardcover Book ID', 'Hardcover Edition ID', 'ISBN 10', 'ISBN 13', 'ASIN',
    'Media', 'Country Code', 'Language Code', 'Binding', 'Pages', 'Duration in Seconds', 'Publish Date', 'Publisher', 'Genres',
    'Moods', 'Tags', 'Content Warnings', 'Lists', 'Date Added', 'Date Started', 'Date Finished', 'Rating', 'Review',
    'Review Contains Spoilers', 'Sponsored Review', 'Review Date', 'Review URL', 'Review Media URL', 'Private Notes', 'Owned',
    'Compilation', 'Review Slate',
  ],
  map: mapHardcoverRow,
}

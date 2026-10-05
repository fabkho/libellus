import {
  LIBRARY_FILE_VERSION,
  type KnownReadingStatus,
  type LibraryBook,
  type LibraryBookAssets,
  type LibraryPalette,
  type RegalLibraryFile,
} from './regalLibraryFile.ts'

/**
 * The Regal export (issue #22): a member's Library as a Regal library file,
 * version 2 (`regalLibraryFile.ts`), the one input of Regal, the owner's 3D
 * bookshelf. Pure and deterministic: the same Library gives the same file,
 * byte for byte (`generatedAt` aside), so Regal assets (`pnpm regal-assets`)
 * finds every Book it has seen before and rebuilds nothing.
 *
 * A Libellus Book is one edition, which is what Regal calls a Book too, so one
 * Library entry is one Book in the file:
 *
 * - `id` is the Book's id (the edition, not the entry): stable across exports
 *   and re-adds, unique within a Library (one entry per Book).
 * - `status` follows from the latest Reading session (`sortSessions`, the order
 *   of `latest_session`): none → `to-read` (Want to read), open →
 *   `currently-reading`, finished → `read`, abandoned → `dnf`.
 * - `dateStarted` is the latest session's start; `dateRead`, `rating` and the
 *   `review` come from the latest *finished* read, so a re-read in progress or
 *   abandoned keeps what the last finish said. A Book never finished takes the
 *   review of its latest read (an abandoned read may have one). `rating` is the
 *   stored quarters (1–20) as stars (0.25–5); unrated is left out (Regal: 0).
 * - `readCount` is the number of finished reads (re-reads included).
 * - `pages` is the member's own page count for the entry when they set one
 *   (`pageCountOverride`, issue #60: an ebook's differ from the edition's), else
 *   the edition's.
 * - `dateAdded` is the day the entry was made, in `timeZone`.
 * - Cover: `assets.front` is the Cover URL (http(s) only), `assets.palette` is
 *   made from the Cover's two precomputed colours (`coverPalette`). The
 *   thumbhash has no place in the format and is left out.
 * - Left out, because Libellus does not know them: `seriesTitle` (the title
 *   is stored as the source gives it), `binding`, `originalYear`, `genre`,
 *   `quotes`, `reviewHasSpoiler`, Spine and back art. Regal assets fills what
 *   it can (art, pile copies, colours, a blurb where `description` is missing).
 * - Empty values are left out rather than written as null: both mean
 *   "unknown" to Regal, and a lean file diffs well.
 *
 * Books are written in the order of their ids (Regal sorts on its own), and
 * every Book's fields in one fixed order.
 */

export type RegalExportOptions = {
  /** `generatedAt`: an ISO 8601 date-time with `Z` or an offset. */
  generatedAt: string
  /** `owner`, as Regal shows it to visitors ("Fabian"). Left out when absent. */
  owner?: string | null
  /** `generator`, for debugging. */
  generator?: string
  /** The zone `dateAdded` is a day in (IANA name). Default UTC. */
  timeZone?: string
  /** Only Books with these statuses; default all four. */
  statuses?: readonly KnownReadingStatus[]
}

/** A Cover's two precomputed colours, `#rrggbb` (`CoverColors` in `../books.ts`). */
export type RegalCoverColors = { dominant: string; secondary: string }

/**
 * One Library entry, as much of it as the export reads. `MemberLibraryEntry`
 * (`memberLibrary.ts`, the web script's read) is one; so is what the
 * `regal-export` edge function reads (supabase/functions/regal-export). Spelled
 * out here instead of imported from the app, so this file, `carryArt.ts` and
 * `regalLibraryFile.ts` stay a closed set of pure modules (relative imports with
 * their `.ts` extension, nothing else) that Deno runs as they are.
 */
export type RegalExportEntry = {
  /** When the Book entered the Library (ISO date-time). */
  addedAt: string
  /** The member's own total pages for this entry (issue #60), null = the edition's. */
  pageCountOverride?: number | null
  book: {
    id: string
    title: string
    authors: string[]
    isbn13: string | null
    isbn10: string | null
    pageCount: number | null
    year: number | null
    publisher: string | null
    description: string | null
    coverUrl: string | null
    coverColors: RegalCoverColors | null
  }
  /** Newest first (`sortSessions`): the open one, then by the day they ended. */
  sessions: readonly RegalExportSession[]
}

export type RegalExportSession = {
  startedOn: string | null
  endedOn: string | null
  outcome: 'finished' | 'abandoned' | null
  /** Quarter stars, 1–20. */
  rating: number | null
  review: string | null
}

export const REGAL_GENERATOR = 'libellus'

const ISBN13 = /^97[89]\d{10}$/
const ISBN10 = /^\d{9}[\dX]$/
const HEX_COLOUR = /^#[\da-f]{6}$/i
const HTTP_URL = /^https?:\/\/\S+$/i

const positiveInteger = (value: number | null | undefined) => (value && Number.isInteger(value) && value > 0 ? value : null)

/** The Reading status of an entry, from its sessions (newest first). */
export function regalStatus(sessions: RegalExportEntry['sessions']): KnownReadingStatus {
  const latest = sessions[0]
  if (!latest) return 'to-read'
  if (!latest.outcome) return 'currently-reading'
  return latest.outcome === 'finished' ? 'read' : 'dnf'
}

/** One Library entry as a Book of the library file. */
export function regalBook(entry: RegalExportEntry, { timeZone = 'UTC' }: Pick<RegalExportOptions, 'timeZone'> = {}): LibraryBook {
  const { book, sessions } = entry
  const latest = sessions[0] ?? null
  const finished = sessions.filter((session) => session.outcome === 'finished')
  const lastFinished = finished[0] ?? null
  const speaking = lastFinished ?? latest

  const result: LibraryBook = {
    id: book.id,
    title: book.title.trim(),
    authors: book.authors.map((name) => name.trim()).filter(Boolean),
    status: regalStatus(sessions),
  }
  const set = <K extends keyof LibraryBook>(key: K, value: LibraryBook[K] | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') result[key] = value
  }
  set('isbn13', book.isbn13 && ISBN13.test(book.isbn13) ? book.isbn13 : null)
  set('isbn10', book.isbn10 && ISBN10.test(book.isbn10) ? book.isbn10 : null)
  set('pages', positiveInteger(entry.pageCountOverride) ?? positiveInteger(book.pageCount))
  set('yearPublished', book.year && Number.isInteger(book.year) ? book.year : null)
  set('dateRead', lastFinished?.endedOn)
  set('dateStarted', latest?.startedOn)
  set('dateAdded', dayIn(entry.addedAt, timeZone))
  set('rating', lastFinished?.rating ? lastFinished.rating / 4 : null)
  set('review', speaking?.review?.trim())
  set('readCount', finished.length || null)
  set('description', book.description?.trim())
  set('publisher', book.publisher?.trim())
  set('assets', regalAssets(book.coverUrl, book.coverColors))
  return result
}

/** The Cover as `assets`: its URL as the front, its colours as a palette. Null when there is neither. */
export function regalAssets(coverUrl: string | null, coverColors: RegalCoverColors | null): LibraryBookAssets | null {
  const assets: LibraryBookAssets = {}
  if (coverUrl && HTTP_URL.test(coverUrl.trim())) assets.front = coverUrl.trim()
  if (coverColors && HEX_COLOUR.test(coverColors.dominant) && HEX_COLOUR.test(coverColors.secondary)) {
    assets.palette = coverPalette(coverColors)
  }
  return Object.keys(assets).length ? assets : null
}

/** The whole Library as a library file. */
export function exportRegalLibrary(entries: readonly RegalExportEntry[], options: RegalExportOptions): RegalLibraryFile {
  const wanted = options.statuses ? new Set<string>(options.statuses) : null
  const books = entries
    .map((entry) => regalBook(entry, options))
    .filter((book) => !wanted || wanted.has(book.status))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    version: LIBRARY_FILE_VERSION,
    generatedAt: options.generatedAt,
    ...(options.owner?.trim() ? { owner: options.owner.trim() } : {}),
    generator: options.generator ?? REGAL_GENERATOR,
    books,
  }
}

/** An instant (ISO date-time) as the calendar day it falls on in a time zone, `YYYY-MM-DD`. */
export function dayIn(instant: string, timeZone: string): string | null {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// -------------------------------------------------------------- the palette

/**
 * Spine colours from the Cover's two precomputed colours, chosen the way
 * Regal's `spinePalette` chooses them from Cover pixels
 * (app/utils/covers/palette.ts there, commit e1842aa): the background is the
 * dominant colour; the text is the secondary one when it reads on it (WCAG
 * contrast ≥ 4.5), else Regal's ink or paper, whichever contrasts more; the
 * accent is the secondary one when it stands out at all (≥ 1.8), else the
 * text. Regal assets replaces it with one measured from the front's spine
 * edge when it has the image; this is what Regal shows until then.
 */
export function coverPalette({ dominant, secondary }: RegalCoverColors): LibraryPalette {
  const background = fromHex(dominant)
  const second = fromHex(secondary)
  const readable = contrast(PAPER, background) >= contrast(INK, background) ? PAPER : INK
  const text = contrast(second, background) >= 4.5 ? second : readable
  const accent = contrast(second, background) >= 1.8 ? second : text
  return { background: toHex(background), text: toHex(text), accent: toHex(accent) }
}

type RGB = [number, number, number]

/** Regal's ink and paper (palette.ts there). */
const INK: RGB = [0x2c, 0x2c, 0x2a]
const PAPER: RGB = [0xf5, 0xf2, 0xeb]

const toHex = (rgb: RGB) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

function fromHex(hex: string): RGB {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as RGB
}

/** WCAG relative luminance, 0–1. */
function luminance([r, g, b]: RGB): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1–21. */
function contrast(a: RGB, b: RGB): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

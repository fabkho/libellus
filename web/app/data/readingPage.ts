import type { SupabaseClient } from '@supabase/supabase-js'
import type { CoverColors } from './books'

/**
 * Share with friends (issue #171): a member's public reading page and her Book
 * cards. Framework-free, so Vitest drives it in plain Node and a native port
 * copies it 1:1.
 *
 * Her side (signed in): the page is off until she turns it on; on, it has an
 * unguessable address `/r/<token>`; turning it off or a new link kills every
 * address handed out before. She picks its sections and shares single Books as
 * cards (`/r/<token>/book/<book id>`), each with or without her review.
 *
 * The visitor's side (anyone, signed out included): `publicPage` and
 * `publicCard` read what the database publishes for a token
 * (`public_reading_page`, `public_book_card`,
 * supabase/migrations/20261011030000_reading_pages.sql): only the sections she
 * turned on, never her address, notes or highlights. Null is "no such page":
 * a link that was never, or no longer is, the page's.
 */

/** The page's sections, in the page's order. */
export const READING_PAGE_SECTIONS = ['reading', 'year', 'favourites', 'finished', 'shelf'] as const
export type ReadingPageSection = (typeof READING_PAGE_SECTIONS)[number]
export type ReadingPageSections = Record<ReadingPageSection, boolean>

/** A token as the database makes it: 16 random bytes, base64url. */
export const READING_PAGE_TOKEN = /^[A-Za-z0-9_-]{22}$/

/** Her settings. `token` null: the page is off. */
export type ReadingPageSettings = { token: string | null; sections: ReadingPageSections }

/** What a visitor sees of a Book. */
export type PublicBook = {
  id: string
  title: string
  authors: string[]
  year: number | null
  coverUrl: string | null
  coverThumbhash: string | null
  coverColors: CoverColors | null
}

/** This year's figures: counts only, no Books (stats.ts' YearFigures, as far as the page shows them). */
export type PublicYear = {
  year: number
  books: number
  pages: number
  pagesMissing: number
  rated: number
  unrated: number
  /** Mean Rating in quarters, null with nothing rated. */
  average: number | null
  medianDays: number | null
  rereads: number
  /** Finished reads per month, January first. */
  months: number[]
}

/** Her shelf: the owner's is Regal's (the published library file, #23), anyone else's a row of covers. */
export type PublicShelf = { kind: 'regal' } | { kind: 'covers'; books: PublicBook[] }

/** A page as a visitor sees it. A section she turned off is absent. */
export type PublicReadingPage = {
  name: string | null
  sections: ReadingPageSections
  reading?: { book: PublicBook; startedOn: string | null }[]
  year?: PublicYear
  favourites?: { book: PublicBook; rating: number }[]
  finished?: { book: PublicBook; endedOn: string | null; rating: number | null; review: string | null }[]
  shelf?: PublicShelf
}

/** A Book card as a visitor sees it. */
export type PublicBookCard = {
  name: string | null
  book: PublicBook
  status: 'want_to_read' | 'reading' | 'finished'
  endedOn: string | null
  rating: number | null
  review: string | null
}

/** A Book she shared as a card; `review`: her review goes with it. */
export type SharedBook = { bookId: string; review: boolean }

export type ReadingPageErrorCode =
  | 'not_signed_in'
  | 'reading_page_off'
  | 'reading_page_sections_invalid'
  | 'entry_not_found'
  | 'offline'
  | 'unknown'
export type ReadingPageResult<T> = { data: T; error: null } | { data: null; error: ReadingPageErrorCode }

/** The page's address on this origin. */
export function readingPagePath(token: string): string {
  return `/r/${token}`
}

/** A Book card's address on this origin. */
export function bookCardPath(token: string, bookId: string): string {
  return `/r/${token}/book/${bookId}`
}

// ------------------------------------------------------------------ the rows

type SettingsRow = {
  token: string | null
  show_reading: boolean
  show_year: boolean
  show_favourites: boolean
  show_finished: boolean
  show_shelf: boolean
}

type PublicBookRow = {
  id: string
  title: string
  authors: string[] | null
  published_year: number | null
  cover_url: string | null
  cover_thumbhash: string | null
  cover_dominant: string | null
  cover_secondary: string | null
}

type PublicPageRow = {
  name: string | null
  sections: ReadingPageSections
  reading?: { book: PublicBookRow; started_on: string | null }[]
  year?: {
    year: number
    books: number
    pages: number
    pages_missing: number
    rated: number
    unrated: number
    average: number | null
    median_days: number | null
    rereads: number
    months: number[]
  }
  favourites?: { book: PublicBookRow; rating: number }[]
  finished?: { book: PublicBookRow; ended_on: string | null; rating: number | null; review: string | null }[]
  shelf?: { kind: 'regal' } | { kind: 'covers'; books: PublicBookRow[] }
}

type PublicCardRow = {
  name: string | null
  book: PublicBookRow
  status: PublicBookCard['status']
  ended_on: string | null
  rating: number | null
  review: string | null
}

/** Every section on: what a page starts with (the table's defaults). */
export const ALL_SECTIONS: ReadingPageSections = { reading: true, year: true, favourites: true, finished: true, shelf: true }

export function settingsFromRow(row: SettingsRow | null): ReadingPageSettings {
  if (!row) return { token: null, sections: { ...ALL_SECTIONS } }
  return {
    token: row.token,
    sections: {
      reading: row.show_reading,
      year: row.show_year,
      favourites: row.show_favourites,
      finished: row.show_finished,
      shelf: row.show_shelf,
    },
  }
}

export function publicBookFromRow(row: PublicBookRow): PublicBook {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors ?? [],
    year: row.published_year,
    coverUrl: row.cover_url,
    coverThumbhash: row.cover_thumbhash,
    coverColors: row.cover_dominant && row.cover_secondary ? { dominant: row.cover_dominant, secondary: row.cover_secondary } : null,
  }
}

export function publicPageFromRow(row: PublicPageRow): PublicReadingPage {
  const page: PublicReadingPage = { name: row.name, sections: { ...ALL_SECTIONS, ...row.sections } }
  if (row.reading) page.reading = row.reading.map((r) => ({ book: publicBookFromRow(r.book), startedOn: r.started_on }))
  if (row.year) {
    const y = row.year
    page.year = {
      year: y.year,
      books: y.books,
      pages: y.pages,
      pagesMissing: y.pages_missing,
      rated: y.rated,
      unrated: y.unrated,
      average: y.average,
      medianDays: y.median_days,
      rereads: y.rereads,
      months: y.months,
    }
  }
  if (row.favourites) page.favourites = row.favourites.map((f) => ({ book: publicBookFromRow(f.book), rating: f.rating }))
  if (row.finished) {
    page.finished = row.finished.map((f) => ({ book: publicBookFromRow(f.book), endedOn: f.ended_on, rating: f.rating, review: f.review }))
  }
  if (row.shelf) page.shelf = row.shelf.kind === 'regal' ? { kind: 'regal' } : { kind: 'covers', books: row.shelf.books.map(publicBookFromRow) }
  return page
}

export function publicCardFromRow(row: PublicCardRow): PublicBookCard {
  return { name: row.name, book: publicBookFromRow(row.book), status: row.status, endedOn: row.ended_on, rating: row.rating, review: row.review }
}

// ------------------------------------------------------------- the repository

export type ReadingPages = {
  /** Her settings; a page never turned on is off with every section on. */
  settings: () => Promise<ReadingPageResult<ReadingPageSettings>>
  /** On (keeps its address if it has one) or off (the address is gone). */
  setOn: (on: boolean) => Promise<ReadingPageResult<ReadingPageSettings>>
  /** A new address; the old one is dead. Refused while the page is off. */
  renewLink: () => Promise<ReadingPageResult<ReadingPageSettings>>
  /** Switches the sections named; the rest stay. */
  setSections: (sections: Partial<ReadingPageSections>) => Promise<ReadingPageResult<ReadingPageSettings>>
  /** The Book as she shared it, or null when she has not. */
  sharedBook: (bookId: string) => Promise<ReadingPageResult<SharedBook | null>>
  /** Shares the Book as a card, with or without her review. Refused while the page is off. */
  shareBook: (bookId: string, review: boolean) => Promise<ReadingPageResult<SharedBook>>
  /** Takes the card back (it stays where her page shows the Book anyway). */
  unshareBook: (bookId: string) => Promise<ReadingPageResult<null>>
  /** The page behind a token, for anyone; null when there is none. */
  publicPage: (token: string) => Promise<ReadingPageResult<PublicReadingPage | null>>
  /** A Book card behind a token, for anyone; null when there is none. */
  publicCard: (token: string, bookId: string) => Promise<ReadingPageResult<PublicBookCard | null>>
}

function mapError(failure: { message?: string; code?: string }): ReadingPageErrorCode {
  const message = failure.message ?? ''
  for (const code of ['reading_page_off', 'reading_page_sections_invalid', 'entry_not_found', 'not_signed_in'] as const) {
    if (message.includes(code)) return code
  }
  if (failure.code === '42501' || failure.code === 'PGRST301') return 'not_signed_in'
  return 'unknown'
}

/** A Book id the database can take: a uuid. Anything else is "no such card" without asking. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createReadingPages(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): ReadingPages {
  const SETTINGS = 'token, show_reading, show_year, show_favourites, show_finished, show_shelf'

  async function write(fn: string, args: Record<string, unknown>): Promise<ReadingPageResult<ReadingPageSettings>> {
    if (!online()) return { data: null, error: 'offline' }
    const { data, error } = await client.rpc(fn, args).single<SettingsRow>()
    if (error) return { data: null, error: mapError(error) }
    return { data: settingsFromRow(data), error: null }
  }

  return {
    async settings() {
      const { data, error } = await client.from('reading_pages').select(SETTINGS).maybeSingle<SettingsRow>()
      if (error) return { data: null, error: mapError(error) }
      return { data: settingsFromRow(data), error: null }
    },

    setOn: (on) => write('set_reading_page', { p_on: on }),
    renewLink: () => write('renew_reading_page_link', {}),
    setSections: (sections) => write('set_reading_page_sections', { p_sections: sections }),

    async sharedBook(bookId) {
      const { data, error } = await client
        .from('reading_page_books')
        .select('book_id, review')
        .eq('book_id', bookId)
        .maybeSingle<{ book_id: string; review: boolean }>()
      if (error) return { data: null, error: mapError(error) }
      return { data: data ? { bookId: data.book_id, review: data.review } : null, error: null }
    },

    async shareBook(bookId, review) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client
        .rpc('share_book_card', { p_book: bookId, p_review: review })
        .single<{ book_id: string; review: boolean }>()
      if (error) return { data: null, error: mapError(error) }
      return { data: { bookId: data.book_id, review: data.review }, error: null }
    },

    async unshareBook(bookId) {
      if (!online()) return { data: null, error: 'offline' }
      const { error } = await client.rpc('unshare_book_card', { p_book: bookId })
      if (error) return { data: null, error: mapError(error) }
      return { data: null, error: null }
    },

    async publicPage(token) {
      if (!READING_PAGE_TOKEN.test(token)) return { data: null, error: null }
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('public_reading_page', { p_token: token })
      if (error) return { data: null, error: mapError(error) }
      return { data: data ? publicPageFromRow(data as PublicPageRow) : null, error: null }
    },

    async publicCard(token, bookId) {
      if (!READING_PAGE_TOKEN.test(token) || !UUID.test(bookId)) return { data: null, error: null }
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('public_book_card', { p_token: token, p_book: bookId })
      if (error) return { data: null, error: mapError(error) }
      return { data: data ? publicCardFromRow(data as PublicCardRow) : null, error: null }
    },
  }
}

import type { EntryStatus } from '../library'

/**
 * One work as the author page and the series lists show it (the database's
 * `work_card`): in the member's language where there is an edition in it, her
 * own edition's title and cover where she has one, with her entry of it.
 */
export type WorkCard = {
  workId?: string
  wikidataId?: string
  openLibraryKey?: string
  title: string
  year?: number
  kind?: 'novel' | 'novella' | 'collection' | 'short-story' | 'nonfiction' | 'poetry' | 'graphic' | 'other'
  /** Its place in the series it is listed under. */
  position?: number
  coverUrl?: string
  genres?: string[]
  /** A representative edition in the asked language: what "+ Want to read" can add by ISBN. */
  edition?: { title: string | null; isbn13: string | null; openlibrary_edition_key: string | null; cover_url: string | null }
  /** 'member' for her own Book she placed in a series herself. */
  source?: 'member'
  /** Her Library entry of the work, if she has one. */
  entry?: {
    entryId: string
    bookId: string
    status: EntryStatus
    /** Quarter stars 1–20 of her latest finished read. */
    rating?: number
    finishedOn?: string
  }
}

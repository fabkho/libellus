import type { CoverColors } from '~/data/books'
import type { WorkCard } from '~/data/enrich/works'
import type { SeriesLine } from './enrich'

/**
 * What the Book page can show of a Book in the first frame: whatever the row, card or tile that opened it already
 * knew. A list hands it over when its link is touched (`rememberPreview`, from the `press` of the link) and the page
 * reads it once, synchronously, when it is set up (`previewOf`); the page's own read of the Book (the Catalogue, a
 * source) replaces it when it comes, and what it carries that the preview did not (the description, the editions, the
 * links, her entry) arrives behind skeletons. Never written to the device and never shown as the page's data: it holds
 * the hero until the Book is there (docs/MOTION.md, "A book opens at once").
 *
 * Only what the opener knows *of this edition*. A work card's year is the work's first publication, not the edition's, so
 * it is left out; a page count is shown only where the opener carried one. Framework-free, so a native port keeps the
 * same rule and `tests/book-preview.test.ts` pins it.
 */
export interface BookPreview {
  title: string
  authors: readonly string[]
  /** The cover as the opener showed it (the page shows this very picture, never another of the same edition). */
  coverUrl: string | null
  coverKey?: string | null
  coverWidths?: readonly number[] | null
  coverThumbhash?: string | null
  coverColors?: CoverColors | null
  pageCount?: number | null
  /** Where it stands in its series, as the opener said it ("Book 2 of 9 · The Expanse"). */
  series?: SeriesLine | null
  /** What a Placeholder cover is of: the edition's ISBN when the opener knew one (the page's own identity for it). */
  identity?: string | null
}

/** How many previews are kept (the last ones handed over): a session opens a handful of Books from lists. */
export const PREVIEWS_KEPT = 50

const previews = new Map<string, BookPreview>()

/** A list hands over what it knows of the Book its link opens (`key` is the address' key: `/book/<key>`). */
export function rememberPreview(key: string | null | undefined, preview: BookPreview | null | undefined) {
  if (!key || !preview?.title) return
  // The newest last, so the oldest is the one that goes.
  previews.delete(key)
  previews.set(key, preview)
  if (previews.size > PREVIEWS_KEPT) previews.delete(previews.keys().next().value!)
}

/** What the page can show of the Book at `key` before its own answer, if a list handed anything over. */
export function previewOf(key: string): BookPreview | null {
  return previews.get(key) ?? null
}

/** Another member's session, or a sign-out: nothing of the last one is kept. */
export function forgetPreviews() {
  previews.clear()
}

/** A work as a row of a series or an author lists it: its title and cover, and where it stands when the row said. */
export function previewFromWork(work: WorkCard, series: SeriesLine | null = null): BookPreview {
  return {
    title: work.title,
    authors: [],
    coverUrl: work.coverUrl ?? null,
    coverKey: work.coverKey ?? null,
    coverWidths: work.coverWidths ?? null,
    series,
    identity: work.edition?.isbn13 ?? null,
  }
}

/** What a card that carries a Book (a Library entry, a friend's tile, a search result) has of it: a Book, a snapshot or a social card's. */
export interface PreviewSource {
  id?: string
  title: string
  authors: readonly string[]
  coverUrl?: string | null
  coverKey?: string | null
  coverWidths?: readonly number[] | null
  coverThumbhash?: string | null
  coverColors?: CoverColors | null
  pageCount?: number | null
  isbn13?: string | null
}

/** A card that carries the Book: everything its tile shows of it. */
export function previewFromBook(book: PreviewSource, series: SeriesLine | null = null): BookPreview {
  return {
    title: book.title,
    authors: book.authors,
    coverUrl: book.coverUrl ?? null,
    coverKey: book.coverKey ?? null,
    coverWidths: book.coverWidths ?? null,
    coverThumbhash: book.coverThumbhash ?? null,
    coverColors: book.coverColors ?? null,
    pageCount: book.pageCount ?? null,
    series,
    identity: book.isbn13 ?? book.id ?? null,
  }
}

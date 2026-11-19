/**
 * Where the reader is in a book, as the chrome and the progress writer read it
 * (#131 phase 2). foliate reports a relocation as its own fraction of the whole
 * file, a section index, the chapter from the table of contents and minutes
 * left; the reader's own place is a fraction of the *body* (back matter such as
 * Project Gutenberg's licence is not part of "the end"), with the facts the
 * chrome shows beside it.
 *
 * Framework-free: the paginator's numbers come in as a plain object, never as
 * the `<foliate-view>` element, so Vitest drives every case with a rectangle of
 * numbers and a native port reimplements it 1:1.
 */

/** How far through the book, in words a member reads (the engine's `Relocation`, re-exported there). */
export interface Relocation {
  /** How far through the body (the PG licence and other back matter after it do not count), 0–1. */
  fraction: number
  /** How far through the current section, 0–1. */
  sectionFraction: number
  sectionIndex: number
  chapter: string | null
  chapterHref: string | null
  minutesLeftInChapter: number
  minutesLeftInBook: number
  cfi: string
  /** On the last page of the body (or past it). */
  atEnd: boolean
  atStart: boolean
  /** Scroll flow: the chapter is no taller than the screen (nothing to scroll). */
  fits: boolean
  reason: string | null
}

/** foliate's `relocate` detail: its own fraction of the file, and what it knows about the place. */
export interface RelocateDetail {
  fraction: number
  cfi: string
  tocItem?: { label?: string; href?: string } | null
  section?: { current: number }
  time?: { section: number; total: number }
  reason?: string
}

/**
 * The paginator as this calculation needs it: the numbers it holds, and the
 * flow it is in. The engine reads them off the renderer element (`flow` is the
 * attribute, the rest are its properties) and passes them in.
 */
export interface RelocationRenderer {
  /** The `flow` attribute: `'scrolled'` scrolls a chapter, anything else (or null) turns pages. */
  flow: string | null
  /** The page showing, 1-based, and how many there are (pages only). */
  page: number
  pages: number
  /** The scroll offset and the whole chapter's height (scroll only). */
  start?: number
  size: number
  /** The visible height of the paginator. */
  viewSize: number
  /** Scroll flow: where the visible part ends. */
  end: number
  /** How far through the current section, from the view's own relocation detail. */
  fraction?: number
  reason?: string
}

/** A page is the last one of its section within this much of the section's end (px, scroll flow). */
const LAST_PAGE_SLACK = 4

/**
 * foliate's relocation, normalised: the body fraction, the end of the body (and
 * of the book), the chapter, the minutes left, and the flags the chrome reads.
 * The minutes left in the book leave out the back matter's share of them.
 */
export function normalizeRelocation(detail: RelocateDetail, renderer: RelocationRenderer, bodyEnd: number, bodyIndex: number): Relocation {
  const index = detail.section?.current ?? 0
  const fraction = Math.min(1, Math.max(0, detail.fraction / bodyEnd))
  const scrolled = renderer.flow === 'scrolled'
  const lastPage = scrolled ? renderer.viewSize - renderer.end < LAST_PAGE_SLACK : renderer.page >= renderer.pages - 2
  const atEnd = index > bodyIndex || (index === bodyIndex && lastPage)
  // The share of the reading time that falls past the body's end, out of the whole file's time.
  const backMatterMinutes = Math.max(0, ((1 - bodyEnd) * (detail.time?.total ?? 0)) / Math.max(1e-6, 1 - detail.fraction))
  return {
    fraction: atEnd ? 1 : fraction,
    sectionFraction: renderer.fraction ?? 0,
    sectionIndex: index,
    chapter: detail.tocItem?.label?.trim() || null,
    chapterHref: detail.tocItem?.href ?? null,
    minutesLeftInChapter: Math.max(0, detail.time?.section ?? 0),
    minutesLeftInBook: Math.max(0, (detail.time?.total ?? 0) - backMatterMinutes),
    cfi: detail.cfi,
    atEnd,
    atStart: index === 0 && (renderer.fraction ?? 0) === 0,
    fits: scrolled && renderer.viewSize - renderer.size < LAST_PAGE_SLACK,
    reason: renderer.reason ?? null,
  }
}

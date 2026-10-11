/**
 * "Read as" (issue #169, shared decisions in #166): how the member read a Book,
 * on paper, as an ebook or as an audiobook. It is hers, not the edition's:
 * an edition does not say how she read it, so a word she never said stays
 * unsaid. One value per library entry (`library_entries.read_as`), null while
 * she has not said; the Library's Read as filter and the stats use it. Changing
 * edition presets a word she had from the new edition's format when that is
 * read another way (`move_entry_to`, the database's); the format default below
 * is for the word she never said.
 *
 * Not to be confused with an edition's *format* (hardcover, paperback, ebook,
 * audiobook: PR #165's `book_format`), which says what the edition is. Where an
 * edition's format is known it is the default for an unset Read as (`readAsOf`).
 *
 * Framework-free like every repository: a native client copies it 1:1.
 */

export type ReadAs = 'physical' | 'ebook' | 'audiobook'
export const READ_AS: readonly ReadAs[] = ['physical', 'ebook', 'audiobook']

export function isReadAs(value: unknown): value is ReadAs {
  return typeof value === 'string' && (READ_AS as readonly string[]).includes(value)
}

/**
 * What an edition's format says about how it is read: hardcover and paperback
 * (and `physical`) are paper, an ebook and an audiobook are themselves. Null
 * when the format is unknown (or none of those).
 */
export function readAsFromFormat(format: string | null | undefined): ReadAs | null {
  if (format === 'hardcover' || format === 'paperback' || format === 'physical') return 'physical'
  if (format === 'ebook' || format === 'audiobook') return format
  return null
}

/** The slice of an entry Read as is read from: PR #165 adds `formatOverride` and the Book's `format`; before it they are absent. */
export type ReadAsSource = {
  readAs?: ReadAs | null
  formatOverride?: string | null
  book: { format?: string | null }
}

/**
 * The Read as that counts for an entry: her own word, else what the edition's
 * format implies (her own word on the format first, then the source's), else
 * null.
 */
export function readAsOf(entry: ReadAsSource): ReadAs | null {
  return entry.readAs ?? readAsFromFormat(entry.formatOverride ?? entry.book.format)
}

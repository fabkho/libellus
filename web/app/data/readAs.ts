/**
 * "Read as" (issue #169, shared decisions in #166): how the member read a Book,
 * on paper, as an ebook or as an audiobook. It is hers, not the edition's, and
 * it said what an edition cannot: an edition does not say how she read it.
 *
 * **The app no longer asks.** The owner's decision (15 Nov 2026): the edition's
 * format is the answer. Choosing an edition sets `format_override` ("what my
 * copy is"), and there is no other "how I read it" to set — the Read as control
 * in the ⋮ menu, the one in the Finish sheet and the Library's Read as filter
 * are gone. What is left here is the type of a column that is kept but unread:
 *
 *  - `library_entries.read_as` stays (empty in production, never written by the
 *    app any more). Dropping a live table's column is a migration and the owner's
 *    rule is additive-only on live tables; a later release can drop it once
 *    nothing references it. `set_read_as` stays in the database for the same
 *    reason.
 *  - `readAsOf` is still the rule for what that column or an edition's format
 *    says, so the rows written before today (and the pgTAP tests that pin them)
 *    keep a single reading. Nothing in the app reads it.
 *
 * Not to be confused with an edition's *format* (hardcover, paperback, ebook,
 * audiobook: PR #165's `book_format`), which says what the edition is and is the
 * one thing the app keeps (`formatOverride`, the Change edition flow).
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

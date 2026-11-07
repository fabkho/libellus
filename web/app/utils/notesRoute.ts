/**
 * The addresses of the Notes screens (`/notes/<book>` the Notes page, `/notes/<book>/<chapter>` a chapter: its number, or `whole` for *The whole book*). Only what a route's
 * `validate` and the Book page's button need, in a file with no chat layer, no store and no types in it: `validate` runs in the entry, so what it imports is the entry's
 * (tests/notes-entry.test.ts). A page whose address is not one is the app's normal 404. The rest of the lookups are utils/notes.ts's.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The Book id the Notes page was opened from (`/notes/<book>`). */
export const isBookId = (value: unknown): boolean => typeof value === 'string' && UUID.test(value)

/** The last row of a chapter list, "The whole book", is `whole` in an address. */
export const WHOLE_SEGMENT = 'whole'

/** A chapter's segment: its number, or `whole`. */
export const isChapterSegment = (value: unknown): boolean => value === WHOLE_SEGMENT || (typeof value === 'string' && /^[1-9]\d{0,2}$/.test(value))

export const notesPath = (bookId: string): string => `/notes/${bookId}`

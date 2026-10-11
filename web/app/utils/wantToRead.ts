import type { FeedKind } from '../data/feed'
import { isNotFinished, type LibraryEntry } from '../data/library'
import type { SocialBook } from '../data/socialShapes'

/**
 * The *Want to read* control on a friend's finished Book (social v2a, contract §3). Pure: whether the add is
 * offered for a Book, from the member's own Library (`wantState` says what the control is, a Book she has
 * included). A Manual book is the
 * friend's own and cannot be read by anyone else; nor is a Book the check could not confirm ("Outside the catalogue").
 */
export function canWantToRead(book: Pick<SocialBook, 'manual'> & { unverified?: boolean }, entry: Pick<LibraryEntry, 'status'> | null): boolean {
  // An unverified Book (the check could not confirm it) is nothing to add: it has no title to keep.
  return !book.manual && !book.unverified && entry === null
}

/** The feed entries that carry the button: what a friend finished, reviewed or started. Not her Want to read, nor a read she gave up. */
export function carriesWantToRead(kind: FeedKind): boolean {
  return kind === 'finished' || kind === 'reviewed' || kind === 'started'
}

/** Where a Book she has stands, for the quiet bookmark that opens it: the key of `social.state`. */
export type WantWhere = 'wantToRead' | 'reading' | 'read' | 'notFinished'

/**
 * What the Want to read control of a friend's Book is for her (social v2a, variant B: an icon in the row's right column):
 * `add` (a bookmark with a plus: adds it as Want to read), `have` (a filled, quiet bookmark that opens the Book, with where
 * it stands: *On your Want to read*, *Reading*, *Read*, *Not finished*), or null (a Manual book, or one the check could not confirm).
 */
export function wantState(
  book: Pick<SocialBook, 'manual'> & { unverified?: boolean },
  entry: LibraryEntry | null,
): { kind: 'add' } | { kind: 'have'; where: WantWhere } | null {
  if (book.manual || book.unverified) return null
  if (!entry) return { kind: 'add' }
  if (entry.status === 'want_to_read') return { kind: 'have', where: 'wantToRead' }
  if (entry.status === 'reading') return { kind: 'have', where: 'reading' }
  return { kind: 'have', where: isNotFinished(entry) ? 'notFinished' : 'read' }
}

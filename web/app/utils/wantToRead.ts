import type { FeedKind } from '../data/feed'
import { isNotFinished, type LibraryEntry } from '../data/library'
import type { SocialBook } from '../data/socialShapes'

/**
 * The *Want to read* button beside a friend's finished Book (social v2a, contract §3): what it says
 * for a Book, from the member's own Library. Pure: the Library store's entry goes in, the face comes
 * out; the component draws it and the store adds.
 *
 * - `add`: the Book is not in her Library; the button adds it as Want to read.
 * - `in`: it is; the button says where (Want to read, Reading, Read, or Not finished for a read she
 *   stopped) and opens the Book.
 * - null: no button. A Manual book is the friend's own and cannot be read by anyone else.
 */
export type WantToReadFace =
  | { kind: 'add' }
  | { kind: 'in'; where: 'want_to_read' | 'reading' | 'finished' | 'not_finished' }

export function wantToReadFace(book: Pick<SocialBook, 'manual'>, entry: Pick<LibraryEntry, 'status' | 'latestSession'> | null): WantToReadFace | null {
  if (book.manual) return null
  if (!entry) return { kind: 'add' }
  if (entry.status === 'finished' && isNotFinished(entry as LibraryEntry)) return { kind: 'in', where: 'not_finished' }
  return { kind: 'in', where: entry.status }
}

/** The feed entries that carry the button: what a friend finished, reviewed or started. Not her Want to read, nor a read she gave up. */
export function carriesWantToRead(kind: FeedKind): boolean {
  return kind === 'finished' || kind === 'reviewed' || kind === 'started'
}

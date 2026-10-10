import type { FeedKind } from '../data/feed'
import type { LibraryEntry } from '../data/library'
import type { SocialBook } from '../data/socialShapes'

/**
 * The *Want to read* button on a friend's finished Book (social v2a, contract §3). Pure: whether the
 * button is there for a Book, from the member's own Library. It is only there to add: a Book she already
 * has (in any list) shows nothing, so the feed never repeats what her Library knows. A Manual book is the
 * friend's own and cannot be read by anyone else.
 */
export function canWantToRead(book: Pick<SocialBook, 'manual'>, entry: Pick<LibraryEntry, 'status'> | null): boolean {
  return !book.manual && entry === null
}

/** The feed entries that carry the button: what a friend finished, reviewed or started. Not her Want to read, nor a read she gave up. */
export function carriesWantToRead(kind: FeedKind): boolean {
  return kind === 'finished' || kind === 'reviewed' || kind === 'started'
}

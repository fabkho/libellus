import type { TestMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueEditionKey } from '../tests/support/stack'
import { friendWithSharedBooks } from './bothRead'

/**
 * The fixtures of "Potential buddy reads" (docs/parity.md): the viewer and a friend (each follows the other, accepted) and a few Catalogue
 * Books on their lists. A Book carries no cover (the Placeholder), as the other social fixtures' do.
 */

export type Pile = 'want' | 'reading' | 'finished'

/** A Catalogue Book, optionally with a cover host address (`cover`), tagged with the run. */
export async function catalogueBook(title: string, author: string, cover?: string): Promise<string> {
  const [book] = await sql<{ id: string }>(
    `insert into public.books (title, authors, publisher, source, openlibrary_edition_key, format, cover_url)
     values ($1, $2, $3, 'openlibrary', $4, 'paperback', $5) returning id`,
    [runTitle(title), [author], TEST_PUBLISHER, uniqueEditionKey(), cover ?? null],
  )
  return book!.id
}

/** The Book on a member's pile: Want to read (no read), Currently reading (an open read) or Finished (a finished read); `minutesAgo`: when it was added (the lists are newest first). */
export async function onPile(member: TestMember, bookId: string, pile: Pile, minutesAgo = 0): Promise<void> {
  const [entry] = await sql<{ id: string }>(
    `insert into public.library_entries (member_id, book_id, added_at) values ($1, $2, now() - ($3::int * interval '1 minute')) returning id`,
    [member.id, bookId, minutesAgo],
  )
  if (pile === 'want') return
  await sql(
    `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating)
     values ($1, current_date - 20, $2::date, $3::public.session_outcome, null)`,
    [entry!.id, pile === 'finished' ? new Date().toISOString().slice(0, 10) : null, pile === 'finished' ? 'finished' : null],
  )
}

/** What the friend shows of her reading (her switches; each on unless said): her Want to read, Currently reading and Finished. */
export async function friendShows(friend: TestMember, shows: { want?: boolean; reading?: boolean; finished?: boolean }): Promise<void> {
  await sql(
    `insert into public.social_settings (member_id, follow_token, show_want, show_reading, show_finished)
     values ($1, private.reading_page_token(), $2, $3, $4)
     on conflict (member_id) do update set show_want = $2, show_reading = $3, show_finished = $4`,
    [friend.id, shows.want ?? true, shows.reading ?? true, shows.finished ?? true],
  )
}

/** The viewer's friend, named, with no Book of their own on any pile yet. */
export const friendOf = (viewer: TestMember, name = 'Ida') => friendWithSharedBooks(viewer, 0, { name })

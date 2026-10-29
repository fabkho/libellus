import { signUpMember, type TestMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueEditionKey } from '../tests/support/stack'

/**
 * The fixtures of "You both read" (docs/plans/shared-books-slideshow.md, H): two members who are friends,
 * with a given number of Books both of them finished, and nothing else. The viewer is the flow's own
 * member (`signUpMember`, `signedIn`); the friend is made here and tagged with the run, so the global
 * teardown removes her, her Library and the Catalogue rows with them.
 *
 * The Books carry no cover: the reel and the poster draw the Placeholder then, which is the state a
 * Book the Catalogue knows nothing about is in, and no flow reaches a cover host for it (e2e/fixtures.ts,
 * `noLiveApis`). The covers themselves are e2e/covers' and the perf harness's to prove.
 */

/** Her name, as a member sets it: the pills and the figures line read it. */
async function name(id: string, name: string) {
  await sql('update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id = $1', [
    id,
    JSON.stringify({ name }),
  ])
}

/**
 * A member the viewer and she both follow (each follow accepted, the way the two of them asked and let
 * in), with `count` Books they both finished: her reads are hers, newest first by `ended_on`, and the
 * viewer finished each of them a day later.
 */
export async function friendWithSharedBooks(
  viewer: TestMember,
  count: number,
  {
    name: herName = 'Ida',
    covers = false,
    unrated = [],
    coverless = [],
    disagree = [],
  }: {
    name?: string
    /** The Books carry a cover (a cover CDN address, which the flows answer with a picture); default none, the Placeholder. */
    covers?: boolean
    /** Indexes (newest of hers first, 0 …) of Books neither of them rated: no pills row in their caption. The reel opens on the LAST. */
    unrated?: number[]
    /** With `covers`: indexes of Books that carry none, as the Catalogue has some. */
    coverless?: number[]
    /** Indexes of Books she rated far below you (a disagreement of more than half a star, which the section names under its figures). */
    disagree?: number[]
  } = {},
): Promise<TestMember> {
  const friend = await signUpMember()
  await name(friend.id, herName)
  if (!(await sql('select 1 from auth.users where id = $1 and raw_user_meta_data ->> $$name$$ is not null', [viewer.id])).length) {
    await name(viewer.id, 'Anna')
  }
  for (const [a, b] of [
    [viewer.id, friend.id],
    [friend.id, viewer.id],
  ]) {
    await sql(
      `insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())
       on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null`,
      [a, b],
    )
  }
  if (count === 0) return friend

  const titles = Array.from({ length: count }, (_, index) => runTitle(`Shared ${index + 1}`))
  for (const [index, title] of titles.entries()) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, publisher, source, openlibrary_edition_key, format, cover_url)
       values ($1, $2, $3, 'openlibrary', $4, 'paperback', $5) returning id`,
      [
        title,
        [`Author ${index + 1}`],
        TEST_PUBLISHER,
        uniqueEditionKey(),
        covers && !coverless.includes(index) ? `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/${uniqueEditionKey()}.jpg/600x900bb.jpg` : null,
      ],
    )
    for (const [member, daysAgo] of [
      [friend.id, index + 2],
      [viewer.id, index + 1],
    ] as const) {
      const [entry] = await sql<{ id: string }>(
        'insert into public.library_entries (member_id, book_id) values ($1, $2) returning id',
        [member, book!.id],
      )
      await sql(
        `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating)
         values ($1, current_date - $2::int, current_date - $3::int, 'finished', $4)`,
        [entry!.id, daysAgo + 14, daysAgo, unrated.includes(index) ? null : member === friend.id ? (disagree.includes(index) ? 8 : 18) : 20],
      )
    }
  }
  return friend
}

/** Her page's address, as the viewer opens it. */
export const friendPath = (friend: TestMember) => `/friends/${friend.id}`

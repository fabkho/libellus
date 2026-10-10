import type { Book } from './books'

/**
 * Social v1 (docs/proposals/social-v1-contract.md): the shapes the social repositories share
 * (data/social.ts, data/feed.ts, data/memberStats.ts), and how the database's JSON becomes them.
 * Framework-free, like every repository here; a native port copies it 1:1.
 *
 * The database answers with snake_case keys and every key present (null where there is no
 * value); the app reads camelCase. Nothing here talks to the database.
 */

/** What a social call can refuse, as the database raises it (contract §1.1), plus the client's own. */
export type SocialErrorCode =
  | 'offline'
  | 'not_signed_in'
  | 'not_found'
  | 'follow_self'
  | 'follow_limit'
  | 'rate_limited'
  | 'social_sections_invalid'
  | 'entry_not_found'
  | 'unknown'

export type SocialResult<T> = { data: T; error: null } | { data: null; error: SocialErrorCode }

const RAISED: readonly SocialErrorCode[] = [
  'not_signed_in',
  'not_found',
  'follow_self',
  'follow_limit',
  'rate_limited',
  'social_sections_invalid',
  'entry_not_found',
]

/** A refusal as the database worded it, as a code. An id that is no id finds nobody. */
export function mapSocialError(failure: { message?: string; code?: string }): SocialErrorCode {
  const message = failure.message ?? ''
  const raised = RAISED.find((code) => message === code)
  if (raised) return raised
  if (failure.code === '22P02') return 'not_found'
  return 'unknown'
}

/** A member as others see her: never her address. `photo`: her avatar's path, when the caller may see it. */
export type MemberCard = { id: string; name: string | null; photo: string | null }

type CardJson = { id: string; name: string | null; photo: string | null }

export function cardFromJson(json: CardJson): MemberCard {
  return { id: json.id, name: json.name ?? null, photo: json.photo ?? null }
}

/** A Book as the social answers carry it. `manual`: a Manual book, which a follower cannot open. */
export type SocialBook = Pick<Book, 'id' | 'title' | 'authors' | 'year' | 'coverUrl' | 'coverThumbhash' | 'coverColors'> & {
  manual: boolean
  /** One the server check could not confirm: no title, authors or cover (utils/unverifiedBook.ts). */
  unverified: boolean
}

type BookJson = {
  id: string
  title: string | null
  authors: string[] | null
  published_year: number | null
  cover_url: string | null
  cover_thumbhash: string | null
  cover_dominant: string | null
  cover_secondary: string | null
  manual: boolean
  unverified?: boolean | null
}

export function socialBookFromJson(json: BookJson): SocialBook {
  return {
    id: json.id,
    title: json.title ?? '',
    authors: json.authors ?? [],
    year: json.published_year ?? null,
    coverUrl: json.cover_url ?? null,
    coverThumbhash: json.cover_thumbhash ?? null,
    coverColors:
      json.cover_dominant && json.cover_secondary ? { dominant: json.cover_dominant, secondary: json.cover_secondary } : null,
    manual: Boolean(json.manual),
    unverified: Boolean(json.unverified),
  }
}

/**
 * Social v2a, the review's flag (contract §1.1), on every answer that hands another member's review out.
 * `spoilers`: the author flagged it (false when the review is not shown at all); `folded`: it is
 * flagged and the caller has not finished the same Book, so the client hides it behind "Show anyway"
 * (the review is still in the answer). Her own answers are never folded.
 */
export type ReviewFlags = { spoilers: boolean; folded: boolean }

type ReviewFlagsJson = { spoilers?: boolean | null; folded?: boolean | null }

export function reviewFlagsFromJson(json: ReviewFlagsJson): ReviewFlags {
  return { spoilers: Boolean(json.spoilers), folded: Boolean(json.folded) }
}

/**
 * Social v2a, likes (contract §1.2), on a finished read of another member: `sessionId` is the read a like
 * is on (null on a row that is no finished read), `likes` the count of the likes the database still
 * allows, `liked` whether the caller gave one.
 */
export type LikeFields = { sessionId: string | null; likes: number; liked: boolean }

type LikeFieldsJson = { sessionId?: string | null; likes?: number | null; liked?: boolean | null }

export function likeFieldsFromJson(json: LikeFieldsJson): LikeFields {
  return { sessionId: json.sessionId ?? null, likes: Number(json.likes ?? 0), liked: Boolean(json.liked) }
}

/** What `like` and `unlike` answer: the count now, and whether the caller likes it. */
export type LikeResult = { likes: number; liked: boolean }

/** Home's "Your circle": one of her reads that was liked lately. `at`: the newest like (ISO). */
export type RecentLike = { session: string; book: SocialBook; likers: MemberCard[]; count: number; at: string }

type BookJsonOf = Parameters<typeof socialBookFromJson>[0]

export type RecentLikeJson = { session: string; book: BookJsonOf; likers: CardJson[]; count: number; at: string }

export function recentLikeFromJson(json: RecentLikeJson): RecentLike {
  return {
    session: json.session,
    book: socialBookFromJson(json.book),
    likers: json.likers.map(cardFromJson),
    count: Number(json.count),
    at: json.at,
  }
}

/** One side of "You both read": a rating in quarters (null: none, or hers not shown) and the day it ended. */
export type ReadOf = { rating: number | null; endedOn: string | null }

/** A Book the caller and a member both finished: her edition, and each side's latest finished read. */
export type BothRead = { book: SocialBook; mine: ReadOf; hers: ReadOf }

export type BothReadJson = {
  book: BookJsonOf
  mine: { rating: number | null; endedOn: string | null }
  hers: { rating: number | null; endedOn: string | null }
}

export function bothReadFromJson(json: BothReadJson): BothRead {
  const side = (read: BothReadJson['mine']): ReadOf => ({ rating: read.rating ?? null, endedOn: read.endedOn ?? null })
  return { book: socialBookFromJson(json.book), mine: side(json.mine), hers: side(json.hers) }
}

/** The members she follows who read (or want to read) the same Book as hers: three cards at most, and how many more. */
export type CircleBook = { book: string; members: MemberCard[]; more: number }

export type CircleBookJson = { book: string; members: CardJson[]; more: number }

export function circleBookFromJson(json: CircleBookJson): CircleBook {
  return { book: json.book, members: json.members.map(cardFromJson), more: Number(json.more) }
}

/** The most Books `circleReading` / `circleWant` look at in one call (the database's limit too). */
export const CIRCLE_BOOKS_MAX = 50

/** What her followers see, section by section; all on by default. */
export const SOCIAL_SECTIONS = ['reading', 'want', 'finished', 'ratings', 'reviews', 'abandoned', 'year'] as const
export type SocialSection = (typeof SOCIAL_SECTIONS)[number]
export type SocialSections = Record<SocialSection, boolean>

/** Where the caller stands with a member. */
export type FollowState = 'self' | 'none' | 'requested' | 'following'

/** One of a member's finished Books on her profile: her latest finished read of it. */
export type MemberFinished = LikeFields &
  ReviewFlags & { book: SocialBook; endedOn: string | null; rating: number | null; review: string | null }

/** Another member's profile (contract §1.5, member_profile). `visible` false: the card of a private account. */
export type MemberProfile =
  | { member: MemberCard; private: boolean; state: FollowState; visible: false }
  | {
      member: MemberCard
      private: boolean
      state: FollowState
      visible: true
      followsYou: boolean
      sections: SocialSections
      /** The earliest day of a read she shows; null with none. */
      since: string | null
      /** Entries, not reads; a count whose section is off is null. */
      counts: { read: number | null; reading: number | null; want: number | null }
      reading: { book: SocialBook; startedOn: string | null }[]
      want: { book: SocialBook; addedOn: string }[]
      finished: MemberFinished[]
    }

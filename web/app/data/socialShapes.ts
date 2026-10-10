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

/** What her followers see, section by section; all on by default. */
export const SOCIAL_SECTIONS = ['reading', 'want', 'finished', 'ratings', 'reviews', 'abandoned', 'year'] as const
export type SocialSection = (typeof SOCIAL_SECTIONS)[number]
export type SocialSections = Record<SocialSection, boolean>

/** Where the caller stands with a member. */
export type FollowState = 'self' | 'none' | 'requested' | 'following'

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
      finished: { book: SocialBook; endedOn: string | null; rating: number | null; review: string | null }[]
    }

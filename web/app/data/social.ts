import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from './network'
import {
  cardFromJson,
  mapSocialError,
  socialBookFromJson,
  type FollowState,
  type MemberCard,
  type MemberProfile,
  type SocialBook,
  type SocialErrorCode,
  type SocialResult,
  type SocialSections,
} from './socialShapes'

/**
 * Following (social v1, docs/proposals/social-v1-contract.md §2): her own social settings (private or
 * public, what her followers see, her follow link), opening someone's link, asking to follow,
 * answering, unfollowing, blocking, her people, and another member's profile. Every rule is the
 * database's (contract §1.5); this file only calls its functions and reads what they answer.
 *
 * What never leaves the database: a member's address (a card carries a name and a photo path, nothing
 * else), the reading of anyone the caller may not see (a profile of a private account she does not
 * follow is the card alone), and whether an id belongs to a member at all (a stranger, a blocked
 * member and a renewed link all answer the same). Offline, every call is refused with `offline`
 * before anything is sent, as every repository here does.
 */

export type {
  FollowState,
  MemberCard,
  MemberProfile,
  SocialBook,
  SocialErrorCode,
  SocialResult,
  SocialSection,
  SocialSections,
} from './socialShapes'
export { SOCIAL_SECTIONS } from './socialShapes'

/** Her own settings. `link`: the token of her follow link; `requests`: asks waiting for her answer. */
export type MySocial = { private: boolean; sections: SocialSections; link: string; requests: number }

/** What a follow link opens: the member behind it and where the caller stands with her. */
export type FollowTarget = { member: MemberCard; private: boolean; state: FollowState }

export type People = {
  following: MemberCard[]
  followers: (MemberCard & { followsBack: boolean })[]
  requests: (MemberCard & { askedAt: string })[]
  requested: MemberCard[]
}

export interface Social {
  /** Her settings; the first call makes them (private, every section on, a fresh link). */
  mine(): Promise<SocialResult<MySocial>>
  /** Going public accepts the requests waiting and drops the declined ones. */
  setPrivate(on: boolean): Promise<SocialResult<MySocial>>
  /** Switches the sections named; the rest stay. */
  setSections(sections: Partial<SocialSections>): Promise<SocialResult<MySocial>>
  /** A new link; the old one answers null. */
  renewLink(): Promise<SocialResult<MySocial>>
  /** The member behind a link token; null for an unknown, renewed or blocked link. */
  target(token: string): Promise<SocialResult<FollowTarget | null>>
  follow(member: string): Promise<SocialResult<'following' | 'requested'>>
  withdraw(member: string): Promise<SocialResult<void>>
  answer(member: string, accept: boolean): Promise<SocialResult<void>>
  unfollow(member: string): Promise<SocialResult<void>>
  removeFollower(member: string): Promise<SocialResult<void>>
  block(member: string): Promise<SocialResult<void>>
  unblock(member: string): Promise<SocialResult<void>>
  people(): Promise<SocialResult<People>>
  blocked(): Promise<SocialResult<MemberCard[]>>
  /** A member's profile; null when she is not reachable (and for herself). */
  profile(member: string): Promise<SocialResult<MemberProfile | null>>
  /** Her whole Want to read (the profile's See all); null when not visible or switched off. */
  want(member: string): Promise<SocialResult<{ book: SocialBook; addedOn: string }[] | null>>
}

/** `https://<site>/f/<token>`: the link the share sheet hands out. */
export function followLink(origin: string, token: string): string {
  return `${origin}/f/${token}`
}

// ------------------------------------------------------------- the database's JSON

type CardJson = Parameters<typeof cardFromJson>[0]
type BookJson = Parameters<typeof socialBookFromJson>[0]

type MySocialJson = { private: boolean; sections: SocialSections; link: string; requests: number }
type FollowTargetJson = { member: CardJson; private: boolean; state: FollowState }
type PeopleJson = {
  following: CardJson[]
  followers: (CardJson & { followsBack: boolean })[]
  requests: (CardJson & { askedAt: string })[]
  requested: CardJson[]
}
type ProfileJson =
  | { member: CardJson; private: boolean; state: FollowState; visible: false }
  | {
      member: CardJson
      private: boolean
      state: FollowState
      visible: true
      followsYou: boolean
      sections: SocialSections
      since: string | null
      counts: { read: number | null; reading: number | null; want: number | null }
      reading: { book: BookJson; startedOn: string | null }[]
      want: { book: BookJson; addedOn: string }[]
      finished: { book: BookJson; endedOn: string | null; rating: number | null; review: string | null }[]
    }

function mySocialFromJson(json: MySocialJson): MySocial {
  return { private: json.private, sections: { ...json.sections }, link: json.link, requests: Number(json.requests) }
}

function targetFromJson(json: FollowTargetJson): FollowTarget {
  return { member: cardFromJson(json.member), private: json.private, state: json.state }
}

function peopleFromJson(json: PeopleJson): People {
  return {
    following: json.following.map(cardFromJson),
    followers: json.followers.map((f) => ({ ...cardFromJson(f), followsBack: Boolean(f.followsBack) })),
    requests: json.requests.map((r) => ({ ...cardFromJson(r), askedAt: r.askedAt })),
    requested: json.requested.map(cardFromJson),
  }
}

function profileFromJson(json: ProfileJson): MemberProfile {
  const member = cardFromJson(json.member)
  if (!json.visible) return { member, private: json.private, state: json.state, visible: false }
  return {
    member,
    private: json.private,
    state: json.state,
    visible: true,
    followsYou: Boolean(json.followsYou),
    sections: { ...json.sections },
    since: json.since ?? null,
    counts: { read: json.counts.read ?? null, reading: json.counts.reading ?? null, want: json.counts.want ?? null },
    reading: json.reading.map((r) => ({ book: socialBookFromJson(r.book), startedOn: r.startedOn ?? null })),
    want: json.want.map((w) => ({ book: socialBookFromJson(w.book), addedOn: w.addedOn })),
    finished: json.finished.map((f) => ({
      book: socialBookFromJson(f.book),
      endedOn: f.endedOn ?? null,
      rating: f.rating ?? null,
      review: f.review ?? null,
    })),
  }
}

// ------------------------------------------------------------- the repository

export function createSocial(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): Social {
  /** One call to a database function: offline refused first, a refusal mapped, the answer read by `read`. */
  async function call<J, T>(fn: string, args: Record<string, unknown>, read: (json: J) => T): Promise<SocialResult<T>> {
    if (!online()) return { data: null, error: 'offline' }
    const answer = await client.rpc(fn, args)
    // A connection that answers nothing is offline, not an unknown failure (as memberStats.ts has it).
    if (isNoAnswer(answer)) return { data: null, error: 'offline' }
    if (answer.error) return { data: null, error: mapSocialError(answer.error) }
    return { data: read(answer.data as J), error: null }
  }

  const nothing = () => undefined

  return {
    mine: () => call('my_social', {}, mySocialFromJson),
    setPrivate: (on) => call('set_private', { p_private: on }, mySocialFromJson),
    setSections: (sections) => call('set_social_sections', { p_sections: sections }, mySocialFromJson),
    renewLink: () => call('renew_follow_link', {}, mySocialFromJson),

    target: (token) => call<FollowTargetJson | null, FollowTarget | null>('follow_target', { p_token: token }, (j) => (j ? targetFromJson(j) : null)),

    follow: (member) => call<{ state: 'following' | 'requested' }, 'following' | 'requested'>('follow', { p_member: member }, (j) => j.state),
    withdraw: (member) => call('withdraw_request', { p_member: member }, nothing),
    answer: (member, accept) => call('answer_request', { p_member: member, p_accept: accept }, nothing),
    unfollow: (member) => call('unfollow', { p_member: member }, nothing),
    removeFollower: (member) => call('remove_follower', { p_member: member }, nothing),
    block: (member) => call('block', { p_member: member }, nothing),
    unblock: (member) => call('unblock', { p_member: member }, nothing),

    people: () => call('my_people', {}, peopleFromJson),
    blocked: () => call<CardJson[], MemberCard[]>('my_blocked', {}, (j) => j.map(cardFromJson)),

    profile: (member) => call<ProfileJson | null, MemberProfile | null>('member_profile', { p_member: member }, (j) => (j ? profileFromJson(j) : null)),
    want: (member) =>
      call<{ book: BookJson; addedOn: string }[] | null, { book: SocialBook; addedOn: string }[] | null>(
        'member_want',
        { p_member: member },
        (j) => (j ? j.map((w) => ({ book: socialBookFromJson(w.book), addedOn: w.addedOn })) : null),
      ),
  }
}

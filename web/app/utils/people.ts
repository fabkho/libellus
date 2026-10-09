import type { MemberCard, People } from '~/data/socialShapes'

/**
 * What People and the member sheet decide (social v1, U3), apart from the screens so a test pins it and
 * a native port copies it. Nothing here talks to anything.
 */

export type PeopleSegment = 'following' | 'followers' | 'requests'

/** The segments, in order: Requests only while a request waits (or a row she just answered still shows). */
export function peopleSegments(requestsShown: boolean): PeopleSegment[] {
  return requestsShown ? ['following', 'followers', 'requests'] : ['following', 'followers']
}

/** The segment the page opens on: Requests when one waits, else Following. */
export function startSegment(requestsShown: boolean): PeopleSegment {
  return requestsShown ? 'requests' : 'following'
}

/** What a member's sheet offers, in order. Block is always there; Unfollow and Remove by what she knows of the relation. */
export type MemberAction = 'unfollow' | 'remove' | 'block'

export function memberActions(relation: { following: boolean; follower: boolean }): MemberAction[] {
  const actions: MemberAction[] = []
  if (relation.following) actions.push('unfollow')
  if (relation.follower) actions.push('remove')
  actions.push('block')
  return actions
}

/** What a Follow back answered, or what she asked before: shown at once, whatever the lists still say. */
export type FollowBack = 'following' | 'requested'

/** Follow back's face on a follower row: the button, the word Requested, or nothing. */
export type FollowBackFace = 'offer' | 'requested' | null

/**
 * A follower she does not follow back gets Follow back, unless she asked already (then Requested); what
 * she answered on this page (`answered`) wins over the list, which is read again only afterwards.
 */
export function followBackFace(
  member: { id: string; followsBack: boolean },
  asked: ReadonlySet<string>,
  answered: ReadonlyMap<string, FollowBack>,
): FollowBackFace {
  const reply = answered.get(member.id)
  if (reply) return reply === 'requested' ? 'requested' : null
  if (member.followsBack) return null
  return asked.has(member.id) ? 'requested' : 'offer'
}

/** A request row: waiting for her answer, or answered Accept on this page (and what Follow back said since). */
export type RequestState = 'asked' | 'accepted' | FollowBack
export type RequestItem = MemberCard & { askedAt: string; state: RequestState }

/**
 * The Requests segment: the requests waiting, plus the ones she accepted here, which stay (saying they
 * follow her now, with Follow back) until she leaves the page; newest ask first, as the database
 * lists them. Declined ones are gone at once (`gone`).
 */
export function requestRows(
  waiting: People['requests'],
  accepted: ReadonlyMap<string, RequestItem>,
  gone: ReadonlySet<string>,
): RequestItem[] {
  const rows = new Map<string, RequestItem>()
  for (const request of waiting) if (!gone.has(request.id)) rows.set(request.id, { ...request, state: 'asked' })
  for (const item of accepted.values()) rows.set(item.id, item)
  return [...rows.values()].sort((a, b) => Date.parse(b.askedAt) - Date.parse(a.askedAt))
}

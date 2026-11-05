import type { ChapterView } from '#layers/chat/app/utils/veil'
import type { BuddyMember, BuddyRead } from '~/data/buddyReads'
import type { MemberCard } from '~/data/socialShapes'

/**
 * A buddy read's room as its screen draws it (pages/together/[id]/index.vue): the Sections as rows, the track of the members by
 * Section and the choices of "Where are you?". Pure functions on plain data (Vitest drives them in Node). Nothing here is finer than
 * a Section: a member is shown in her Section or at the end, never at a page or a percent (plan part 5.5).
 */

/** A row of the Sections list: the room ("Before we start"), a part or "The whole book". */
export type RoomRow = {
  /** The thread's route segment: `room`, or the Section's id. */
  segment: string
  /** The Section's id; null for the room. */
  id: string | null
  kind: 'room' | 'part' | 'end'
  /** The number drawn in mono (nothing for the room, which has none). */
  number: string
  /** The Section's position (1…N, N + 1 for the whole book); 0 for the room. */
  position: number
  /** The title as stored: drawn only on an open row. Empty on a veiled one, whatever it is called (a renamed title can spoil). */
  title: string
  count: number
  /** A number only on an open row: a veiled row's news is a spoiler too. */
  unread: number
  veiled: boolean
  /** Who is in this Section; never on a veiled row (no avatar-of-who-is-there beyond a count). */
  faces: MemberCard[]
}

/** The room's segment of the route: the thread without a Section. */
export const ROOM_SEGMENT = 'room'

/** A view of one Section for her (the store's `view`): the veil's answer. */
export type SectionView = Pick<ChapterView, 'open' | 'veiled' | 'showTitle' | 'showUnread'>

const cardOf = (member: BuddyMember): MemberCard => ({ id: member.id, name: member.name, photo: member.photo })

/**
 * The rows, in the order of the screen: "Before we start" (the room, always open), the Sections, "The whole book" last. `viewOf`
 * is the store's `view(read, section)`; a Section it does not know is drawn veiled (nothing leaks on a doubt).
 */
export function roomRows(read: BuddyRead, viewOf: (sectionId: string) => SectionView | null, titleOf: (chapter: BuddyRead['chapters'][number]) => string = (chapter) => chapter.title): RoomRow[] {
  const rows: RoomRow[] = [
    { segment: ROOM_SEGMENT, id: null, kind: 'room', number: '', position: 0, title: '', count: read.room.count, unread: read.room.unread, veiled: false, faces: [] },
  ]
  const parts = read.chapters.filter((c) => c.kind === 'chapter').length
  for (const chapter of [...read.chapters].sort((a, b) => a.position - b.position)) {
    const view = viewOf(chapter.id)
    const veiled = view ? view.veiled : true
    const kind = chapter.kind === 'end' ? 'end' : 'part'
    const position = kind === 'end' ? parts + 1 : chapter.position
    rows.push({
      segment: chapter.id,
      id: chapter.id,
      kind,
      number: String(chapter.position),
      position,
      title: veiled ? '' : titleOf(chapter),
      count: chapter.count,
      unread: !veiled && view?.showUnread ? chapter.unread : 0,
      veiled,
      faces: veiled ? [] : read.members.filter((m) => inSection(m, position, parts)).map(cardOf),
    })
  }
  return rows
}

/**
 * Whether a title already says its number aloud ("Section 9", "Abschnitt 9"): it ends with the number on its own, not as the tail of a longer one
 * ("Chapter 19" does not say 9) or of a range ("Section 1–2" does not say 2). An open row whose title says it is named by the title alone.
 */
export function titleSaysNumber(title: string, number: string): boolean {
  if (!number) return false
  const text = title.trim()
  if (!text.endsWith(number)) return false
  const before = text.slice(0, text.length - number.length).slice(-1)
  return before === '' || !/[\p{N}–-]/u.test(before)
}

/** Whether a member stands in the Section at `position` (1…N), or at the end (N + 1). */
export function inSection(member: Pick<BuddyMember, 'where'>, position: number, parts: number): boolean {
  const where = member.where
  if (!where) return false
  if (where.kind === 'section') return where.section === position
  if (where.kind === 'end') return position === parts + 1
  return false
}

/** Where a member stands on the track, as a place along the bar (0…1), or null when it is not set (or hidden across a block). */
export function trackPlace(member: Pick<BuddyMember, 'where'>, parts: number): number | null {
  const where = member.where
  if (!where || where.kind === 'not_set' || parts < 1) return null
  if (where.kind === 'end') return 1
  // The middle of her Section: Section k of N sits between (k - 1) / N and k / N.
  return Math.min(1, Math.max(0, (where.section - 0.5) / parts))
}

/** A member on the track. `at`: where she is drawn along the bar, in percent, after the avatars have been kept apart. */
export type TrackMember = { member: BuddyMember; at: number; place: number }

/**
 * The members who have a Section, left to right, each at her Section's place but never closer than `gap` percent to the one
 * before it (two readers of one Section stand side by side, overlapping a little, and a crowd stays inside the bar). The order is
 * the order of the places, hers first on a tie so her own ring is never hidden under another's.
 */
export function trackOf(members: readonly BuddyMember[], parts: number, me: string | null, gap = 7): TrackMember[] {
  const placed = members
    .map((member) => ({ member, place: trackPlace(member, parts) }))
    .filter((x): x is { member: BuddyMember; place: number } => x.place !== null)
    .sort((a, b) => a.place - b.place || Number(b.member.id === me) - Number(a.member.id === me))
  const at = placed.map((x) => x.place * 100)
  for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i]!, at[i - 1]! + gap)
  // Pushed past the end by the ones before it: pulled back from the right.
  if (at.length) at[at.length - 1] = Math.min(at[at.length - 1]!, 100)
  for (let i = at.length - 2; i >= 0; i--) at[i] = Math.min(at[i]!, at[i + 1]! - gap)
  return placed.map((x, i) => ({ member: x.member, place: x.place, at: Math.max(0, at[i]!) }))
}

/** What "Where are you?" offers: "automatic", Section 1…N and "I've read it". `through`: the value `set_buddy_hand` takes (null: automatic). */
export type MarkerChoice = { key: string; kind: 'auto' | 'section' | 'end'; section: number | null; through: number | null }

export function markerChoices(parts: number): MarkerChoice[] {
  const choices: MarkerChoice[] = [{ key: 'auto', kind: 'auto', section: null, through: null }]
  // Reading Section k is "through k - 1" parts.
  for (let k = 1; k <= parts; k++) choices.push({ key: `section-${k}`, kind: 'section', section: k, through: k - 1 })
  choices.push({ key: 'end', kind: 'end', section: null, through: parts })
  return choices
}

/** The choice that is hers now: the hand when she set one, else automatic. */
export function currentChoice(hand: number | null, parts: number): string {
  if (hand === null) return 'auto'
  if (hand >= parts) return 'end'
  return `section-${Math.max(0, hand) + 1}`
}

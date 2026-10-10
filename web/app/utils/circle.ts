// Shapes and wording of the two circle features of social v2a (contract §1.3, §1.4), kept apart from
// data/socialShapes.ts until the data layer (task A) has its own: the components take these as props.
import type { SocialBook } from '~/data/social'
import type { MemberCard } from '~/data/socialShapes'

/** Followed members reading (or wanting) one of her Books, as `circle_reading` / `circle_want` hand them: at most three cards, and how many more there are. */
export type CircleGroup = { members: readonly MemberCard[]; more: number }

/** One Book both read (`both_read`): her own read, and hers (no rating without `show_ratings`). */
export type BothReadItem = {
  book: SocialBook
  mine: { rating: number | null; endedOn: string | null }
  hers: { rating: number | null; endedOn: string | null }
}

/** How the names of a circle are said: all of them up to three, else the first two and the count of the rest ("Anna, Ben and 2 others"). */
export function circleNameParts(names: readonly string[], more: number): { key: 'one' | 'two' | 'three' | 'others'; args: Record<string, string | number>; count: number } {
  const total = names.length + Math.max(0, more)
  if (total <= 1) return { key: 'one', args: { a: names[0] ?? '' }, count: 1 }
  if (total === 2) return { key: 'two', args: { a: names[0] ?? '', b: names[1] ?? '' }, count: 2 }
  if (total === 3 && names.length === 3) return { key: 'three', args: { a: names[0]!, b: names[1]!, c: names[2]! }, count: 3 }
  return { key: 'others', args: { a: names[0] ?? '', b: names[1] ?? '', count: total - 2 }, count: total - 2 }
}

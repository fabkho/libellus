import { feedDays, type FeedEntry, type FeedRow } from '../data/feed'
import type { MemberCard, SocialBook } from '../data/socialShapes'
import { feedBatchKey, feedVerbKey } from './feedView'

/**
 * What Home's "Your circle" decides before it draws (social v1, U8): which finished Book gets the
 * card, and what is left for the list, one row per member. Pure, so the tests pin it and a native
 * port copies it. The input is the feed store's loaded entries, newest first.
 *
 * - The card is the newest `finished` or `reviewed` entry that is a row of its own (not folded into
 *   a batch of three or more), at most `CARD_DAYS` old. None: no card.
 * - The card's finish leaves the list, and so does the same member's other finish or review of the
 *   same Book (a review is written after the finish: both are one fact to the reader). Her other
 *   activity still makes her row. What is left is batched again (`feedDays`), since a batch that
 *   lost a member of its three may be none any more.
 * - The list groups the rows by member, ordered by each member's newest row; a row holds at most
 *   `CIRCLE_PHRASES` of her newest events (two single entries of one verb are one phrase with both titles), the day is her newest event's, the covers are those of
 *   the Books her phrases name (at most `CIRCLE_COVERS`). At most `CIRCLE_MEMBERS` rows.
 */

/** The days back a finish is still "this week's". */
export const CARD_DAYS = 7
/** How many members the list shows: a glance, the feed's page has the rest. */
export const CIRCLE_MEMBERS = 3
/** How many events one member's sentence holds. */
export const CIRCLE_PHRASES = 2
/** How many covers the fan shows. */
export const CIRCLE_COVERS = 3

const DAY_MS = 86_400_000

/** One thing a member did, as a piece of her sentence: an entry (a verb and its Book, or its two Books when her two newest events are of one kind) or a batch (a verb and a count). */
export type CirclePhrase =
  | { type: 'entry'; verb: ReturnType<typeof feedVerbKey>; books: SocialBook[] }
  | { type: 'batch'; key: ReturnType<typeof feedBatchKey>; count: number }

/** The finished Book that gets the card. `verb`: "finished", or "reviewed" when only the review is within the week. */
export type CircleCard = {
  member: MemberCard
  book: SocialBook
  verb: 'finished' | 'reviewed'
  rating: number | null
  review: string | null
  at: string
}

export type CircleFriend = { member: MemberCard; day: string; phrases: CirclePhrase[]; books: SocialBook[] }

export type CircleView = { card: CircleCard | null; friends: CircleFriend[] }

type Options = {
  /** The moment the section is drawn at. */
  now: Date
  /** The member's own calendar day of a moment (`YYYY-MM-DD`), as the feed buckets days. */
  dayOf: (at: string) => string
}

const isFinish = (entry: FeedEntry) => entry.kind === 'finished' || entry.kind === 'reviewed'

/** The entry that gets the card, or null. Rows folded into a batch are not candidates. */
function pickCard(entries: readonly FeedEntry[], { now, dayOf }: Options): FeedEntry | null {
  const since = now.getTime() - CARD_DAYS * DAY_MS
  let best: FeedEntry | null = null
  for (const day of feedDays(entries, dayOf)) {
    for (const row of day.rows) {
      if (row.type !== 'entry' || !isFinish(row.entry)) continue
      const at = Date.parse(row.entry.at)
      if (!(at >= since)) continue
      if (!best || at > Date.parse(best.at)) best = row.entry
    }
  }
  return best
}

function cardOf(picked: FeedEntry, same: readonly FeedEntry[]): CircleCard {
  // `same` is newest first, the picked one among it: the rating and review are the newest that has one.
  const rated = same.find((entry) => entry.rating)
  const reviewed = same.find((entry) => entry.review)
  return {
    member: picked.member,
    book: picked.book,
    verb: same.some((entry) => entry.kind === 'finished') ? 'finished' : 'reviewed',
    rating: picked.rating ?? rated?.rating ?? null,
    review: picked.review ?? reviewed?.review ?? null,
    at: picked.at,
  }
}

function phraseOf(row: FeedRow): CirclePhrase {
  return row.type === 'entry'
    ? { type: 'entry', verb: feedVerbKey(row.entry.kind, row.entry.again), books: [row.entry.book] }
    : { type: 'batch', key: feedBatchKey(row.kind), count: row.entries.length }
}

/** Her phrases: one per row, except two single entries of one verb, which are one phrase with both Books. */
function phrasesOf(rows: readonly FeedRow[]): CirclePhrase[] {
  const [first, second] = rows.map(phraseOf)
  if (first?.type === 'entry' && second?.type === 'entry' && first.verb === second.verb) {
    return [{ type: 'entry', verb: first.verb, books: [...first.books, ...second.books] }]
  }
  return [first, second].filter((phrase): phrase is CirclePhrase => Boolean(phrase))
}

function booksOf(row: FeedRow): SocialBook[] {
  return row.type === 'entry' ? [row.entry.book] : row.entries.map((entry) => entry.book)
}

export function circleView(entries: readonly FeedEntry[], options: Options): CircleView {
  const picked = pickCard(entries, options)
  const same = picked
    ? entries.filter((entry) => entry.member.id === picked.member.id && entry.book.id === picked.book.id && isFinish(entry))
    : []
  const card = picked ? cardOf(picked, same) : null

  const gone = new Set(same.map((entry) => entry.id))
  const rest = gone.size ? entries.filter((entry) => !gone.has(entry.id)) : entries

  // Members in the order of their newest row, each with her rows (newest first) and the day of the first.
  const byMember = new Map<string, { member: MemberCard; day: string; rows: FeedRow[] }>()
  for (const { day, rows } of feedDays(rest, options.dayOf)) {
    for (const row of rows) {
      const member = row.type === 'entry' ? row.entry.member : row.member
      const group = byMember.get(member.id)
      if (group) group.rows.push(row)
      else byMember.set(member.id, { member, day, rows: [row] })
    }
  }

  const friends = [...byMember.values()].slice(0, CIRCLE_MEMBERS).map(({ member, day, rows }) => {
    const told = rows.slice(0, CIRCLE_PHRASES)
    const books = new Map<string, SocialBook>()
    for (const row of told) for (const book of booksOf(row)) if (!books.has(book.id)) books.set(book.id, book)
    return { member, day, phrases: phrasesOf(told), books: [...books.values()].slice(0, CIRCLE_COVERS) }
  })

  return { card, friends }
}

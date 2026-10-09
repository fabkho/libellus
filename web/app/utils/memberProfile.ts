import type { MemberProfile, SocialBook } from '../data/socialShapes'
import { yearsOf, type StatsRead, type StatsYear } from '../data/stats'

/**
 * What another member's profile shows (social v1, U4), decided apart from the screen so a test pins
 * it and a native port copies it: which blocks her switches leave, and the Library line with only
 * the counts she shows. Nothing here talks to anything.
 */

/** A profile the caller may see (`visible`): the other shape is a private account's card. */
export type VisibleProfile = Extract<MemberProfile, { visible: true }>

/** How many of her Want to read the profile carries (the newest); the rest is behind *See all*. */
export const WANT_SHOWN = 12

/** The blocks of her profile, in the order they stand; each is on or off. */
export type MemberBlocks = {
  /** Currently reading: covers. */
  reading: boolean
  /** Want to read: the newest covers. */
  want: boolean
  /** *See all* under it: she has more than the profile carries. */
  wantAll: boolean
  /** The year pills, the four figures, By year / By month, Records and Authors: her figures. */
  figures: boolean
  /** Ratings, a block of the figures that follows her Ratings switch too. */
  ratings: boolean
  /** Recently finished. */
  finished: boolean
  /** Years in review: the cards to her year pages. */
  yearCards: boolean
}

/**
 * Which blocks her switches leave. `record`: her reading record, null while it is not in (`loading`)
 * or when it is not for the caller (her *Year in review and figures* switch is off). Her figures
 * need that switch and *Finished* (without it the record holds only what she put down, which is no
 * year in review); a record with nothing finished closes them. While the record is on its way they
 * stand as placeholders for a member who has finished something (`counts.read`).
 */
export function memberBlocks(profile: VisibleProfile, record: { reads: readonly StatsRead[] } | null, loading: boolean): MemberBlocks {
  const s = profile.sections
  const figuresOn = s.year && s.finished
  const years = record ? yearsOf(record.reads as StatsRead[]) : []
  const figures = figuresOn && (record ? years.length > 0 : loading && profile.counts.read !== 0)
  return {
    reading: s.reading && profile.reading.length > 0,
    want: s.want && profile.want.length > 0,
    wantAll: s.want && (profile.counts.want ?? 0) > profile.want.length,
    figures,
    ratings: figures && s.ratings,
    finished: s.finished && profile.finished.length > 0,
    yearCards: figures && years.length > 0,
  }
}

/**
 * The Library line under her name, with only the counts she shows ("12 read · 1 reading · 4 want"):
 * a count her switch hides (null) takes its part of the line with it, never a made-up zero. `template`
 * is the message with `{read}`, `{reading}` and `{want}`, its parts divided by " · ". Null with nothing to say.
 */
export function libraryLine(
  counts: { read: number | null; reading: number | null; want: number | null },
  template: (marks: { read: string; reading: string; want: string }) => string,
  format: (count: number) => string = String,
): string | null {
  const keys = ['read', 'reading', 'want'] as const
  const mark = (key: (typeof keys)[number]) => `\u0001${key}\u0001`
  const parts = template({ read: mark('read'), reading: mark('reading'), want: mark('want') })
    .split(' · ')
    .filter((part) => keys.every((key) => !part.includes(mark(key)) || counts[key] !== null))
    .map((part) =>
      keys.reduce((line, key) => {
        const n = counts[key]
        return line.replace(mark(key), n === null ? '' : format(n))
      }, part),
    )
  return parts.length ? parts.join(' · ') : null
}

/** A Book of hers the member can open: a Manual book is not in the Catalogue, so it opens nothing. */
export function bookPathOf(book: Pick<SocialBook, 'id' | 'manual'>): string | null {
  return book.manual ? null : `/book/${book.id}`
}

/** The year pills' value after her years changed: the one in view if she still has it, else All. */
export function yearIn(year: StatsYear, reads: readonly StatsRead[]): StatsYear {
  return year === 'all' || yearsOf(reads as StatsRead[]).includes(year) ? year : 'all'
}

/**
 * Her figures as her Ratings switch allows: with it off her stars come through as nothing, so "N not rated
 * yet" under the Average would tell something that is not true (she may have rated them all). The line goes.
 */
export function figuresWithRatings<T extends { unrated: number }>(figures: T, ratingsOn: boolean): T {
  return ratingsOn ? figures : { ...figures, unrated: 0 }
}

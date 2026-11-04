import { DEFAULT_PAGES_PER_PART, groupingsFor, planByCount, planByPages, planProblem, type ChapterRange } from '#layers/chat/app/utils/chapters'
import type { BuddySectionInput, SectionsFrom } from '~/data/buddyReads'

/**
 * Starting a buddy read, the rules of the setup sheet (components/together/SetupSheet.vue, docs/plans/buddy-read-shared.md part 5.1): how a
 * division of the Book becomes the Sections `create_buddy_read` takes, what is wrong with a draft, and which of her Library entries can
 * follow a read. Pure functions on plain data (Vitest drives them in Node); the arithmetic is the chat layer's (`chapters.ts`), the words
 * are the caller's (`label`), because a Section's label is stored text in the host's language and the layer has no words.
 */

/** A read has 2 to 12 members, the host among them: so the host invites at most this many. */
export const MAX_INVITES = 11
/** The count the setup starts with. */
export const DEFAULT_SECTION_COUNT = 10
/** The database takes a start day within a year either side of today (`buddy_starts_invalid`); a day inside 365 is safe whatever the time zone. */
export const STARTS_WITHIN_DAYS = 365

/** How the Book is divided: by a number of parts (`per` of them to a Section above 30), or by pages. */
export type SetupPlan = { from: 'count'; count: number | null; per: number } | { from: 'pages'; pageCount: number | null; perPart: number | null }

/** What the sheet has so far. */
export type SetupDraft = {
  /** The Catalogue Book of her Library entry. */
  bookId: string | null
  plan: SetupPlan
  /** The people she invites (followed members), without duplicates. */
  invite: string[]
  /** `YYYY-MM-DD`, or null for today. */
  startsOn: string | null
}

/** What can be wrong, in the order the steps ask: the Book, the Sections, the start day, the invitations. */
export type SetupProblem = 'book' | 'count' | 'pages' | 'starts' | 'invites'

/** The order the steps are shown in; the sheet's Back and Next walk it. */
export const SETUP_STEPS = ['book', 'sections', 'invite'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** A fraction as the database stores it: four places. */
const fourPlaces = (n: number): number => Math.round(n * 10000) / 10000

/** The number of parts of a plan the way the layer would make them (0 when the numbers are out of range). */
export function partsIn(plan: SetupPlan): ChapterRange[] {
  if (plan.from === 'count') return planByCount(plan.count ?? NaN, plan.per)
  return planByPages(plan.pageCount ?? NaN, plan.perPart ?? DEFAULT_PAGES_PER_PART)
}

/** Which groupings the sheet offers for a count of parts (only 1 up to 30, then 2 and 3). */
export const groupingsOf = (count: number | null): readonly number[] => groupingsFor(count ?? 0)

/** What is wrong with the division, or null: the layer's own check (`count`: outside 1–100; `pages`: no page count, or above 100 parts). */
export function planIssue(plan: SetupPlan): 'count' | 'pages' | null {
  if (plan.from === 'count') return planProblem({ from: 'count', count: plan.count, per: plan.per })
  return planProblem({ from: 'pages', pageCount: plan.pageCount, per: plan.perPart ?? DEFAULT_PAGES_PER_PART })
}

/**
 * The Sections a plan makes, as `create_buddy_read` takes them: one `part` for each range, then the one `end`, "The whole book" (to_fraction 1).
 * By count a part ends at `to / count`; by pages at `end page / page count`. Null when the plan has a problem, or when four places could not
 * keep the parts apart (the database needs each part to end after the one before). `label` words a range (`Section 3`, `Section 3–4`).
 */
export function sectionsOf(plan: SetupPlan, label: (range: ChapterRange) => string, endLabel: string): { sections: BuddySectionInput[]; from: SectionsFrom; pageCount: number | null } | null {
  if (planIssue(plan)) return null
  const ranges = partsIn(plan)
  const parts: BuddySectionInput[] = ranges.map((range) =>
    plan.from === 'count'
      ? { kind: 'part', label: label(range), toFraction: fourPlaces(range.to / plan.count!) }
      : { kind: 'part', label: label(range), startPage: range.startPage!, endPage: range.endPage!, toFraction: fourPlaces(Math.min(1, range.endPage! / plan.pageCount!)) },
  )
  for (let i = 1; i < parts.length; i++) if (parts[i]!.toFraction <= parts[i - 1]!.toFraction) return null
  return {
    sections: [...parts, { kind: 'end', label: endLabel, toFraction: 1 }],
    from: plan.from,
    pageCount: plan.from === 'pages' ? plan.pageCount : null,
  }
}

/** `YYYY-MM-DD` as a day count, for comparing days without a time zone. */
const dayNumber = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000)
}

/** Whether a start day is one the database takes: a real day within a year of `today` (both `YYYY-MM-DD`). */
export function startsOk(day: string | null, today: string): boolean {
  if (day === null || day === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false
  return Math.abs(dayNumber(day) - dayNumber(today)) <= STARTS_WITHIN_DAYS
}

/** The first thing wrong with a draft, or null when it can be sent. `todayIs`: today as `YYYY-MM-DD`. */
export function setupProblem(draft: SetupDraft, todayIs: string): SetupProblem | null {
  if (!draft.bookId) return 'book'
  const issue = planIssue(draft.plan)
  if (issue) return issue
  if (!startsOk(draft.startsOn, todayIs)) return 'starts'
  if (new Set(draft.invite).size > MAX_INVITES) return 'invites'
  return null
}

/** Whether a step may be left forwards: the Book step needs a Book and a good start day, the Sections step a division. */
export function stepReady(step: SetupStep, draft: SetupDraft, todayIs: string): boolean {
  if (step === 'book') return !!draft.bookId && startsOk(draft.startsOn, todayIs)
  if (step === 'sections') return planIssue(draft.plan) === null
  return setupProblem(draft, todayIs) === null
}

/** The word "Sections" a division is shown as: how many parts it has, the whole-book Section not counted. */
export const sectionCount = (plan: SetupPlan): number => partsIn(plan).length

/**
 * The rows the preview shows: the first few parts, then how many more there are, then the last part and "The whole book" (always at the end).
 * `shown` is how many rows are drawn at most (the sheet is short on a phone).
 */
export function previewOf<T>(sections: readonly T[], shown = 4): { head: T[]; more: number; tail: T | null } {
  if (sections.length <= shown + 1) return { head: sections.slice(0, -1), more: 0, tail: sections.at(-1) ?? null }
  const head = sections.slice(0, shown - 1)
  return { head, more: sections.length - 1 - head.length, tail: sections.at(-1) ?? null }
}

/** A Library entry that may follow a read: the same Book, or (by the server's say) another edition of it. */
export type EntryChoice = { id: string; bookId: string; title: string; authors: readonly string[] }

/**
 * Her entries that can follow a read: the ones of the very Book first (the database accepts them without asking), then the ones with the same
 * title, which may be another edition of the work (the database decides: `buddy_entry_invalid` says no). `sameTitle` says whether two titles are one.
 */
export function entryChoices<E extends EntryChoice>(entries: readonly E[], book: { id: string; title: string }, sameTitle: (a: string, b: string) => boolean): { exact: E[]; similar: E[] } {
  const exact = entries.filter((e) => e.bookId === book.id)
  const similar = entries.filter((e) => e.bookId !== book.id && sameTitle(book.title, e.title))
  return { exact, similar }
}


/** `https://<site>/t/<token>`: the link the host hands out (the twin of `followLink` in data/social.ts). */
export const buddyLink = (origin: string, token: string): string => `${origin}/t/${token}`

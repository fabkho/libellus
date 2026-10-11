/**
 * Pick my next book (issue #259, PROTOTYPE): the rules of the picker, framework-free so Vitest
 * drives them in plain Node and a native port copies them 1:1.
 *
 * - The candidates: Books the member is in the mood for, from her Want to read list (an entry) or
 *   from search (a snapshot, not in her Library yet). Between `PICK_MIN` and `PICK_MAX`, each once.
 * - The draw: one candidate, uniformly, with `crypto.getRandomValues` (unbiased: rejection
 *   sampling), decided BEFORE any animation. Never the Book picked last time, unless it is the
 *   only one left.
 * - The rounds: Decline drops the shown Book and draws again among the rest; the last one is
 *   picked without a draw (`PickRound.alone`); none left is the end (`PickRound` null).
 * - Accept: what "Start reading" does with the shown Book (`acceptAction`): an entry is started,
 *   a search result is added as Currently reading through the app's add flow.
 * Nothing here writes; nothing writes before Accept.
 */
import { bookKey, type Book, type BookSnapshot } from './books'
import type { LibraryEntry } from './library'

/** At least two to choose between, and a deal short enough to watch. */
export const PICK_MIN = 2
export const PICK_MAX = 12

/** The three animations being compared (A, B, C): a card deck, Regal's Stack, a wheel. */
export const PICK_VARIANTS = ['deck', 'stack', 'wheel'] as const
export type PickVariant = (typeof PICK_VARIANTS)[number]

/** `?variant=a|b|c` (or the name itself) → the variant; anything else → null. */
export function variantFromParam(value: unknown): PickVariant | null {
  const text = String(Array.isArray(value) ? value[0] : (value ?? '')).trim().toLowerCase()
  const byLetter: Record<string, PickVariant> = { a: 'deck', b: 'stack', c: 'wheel' }
  if (byLetter[text]) return byLetter[text]
  return (PICK_VARIANTS as readonly string[]).includes(text) ? (text as PickVariant) : null
}

/** One Book in the running: from her Library (an entry) or from search (a snapshot). */
export type PickCandidate =
  | { kind: 'entry'; key: string; entryId: string; book: Book }
  | { kind: 'search'; key: string; book: BookSnapshot | Book }

export function candidateOfEntry(entry: LibraryEntry): PickCandidate {
  return { kind: 'entry', key: bookKey(entry.book), entryId: entry.id, book: entry.book }
}

/**
 * A search hit as a candidate: an entry on her Want to read list is that entry; a Book she is
 * reading or has finished cannot be her next one (null); anything else joins as a snapshot.
 */
export function candidateOfHit(hit: { key: string; book: BookSnapshot | Book; entry: LibraryEntry | null }): PickCandidate | null {
  if (hit.entry) return hit.entry.status === 'want_to_read' ? candidateOfEntry(hit.entry) : null
  return { kind: 'search', key: hit.key, book: hit.book }
}

export type CandidateChange = { candidates: PickCandidate[]; refused: 'full' | null }

/** Adds a candidate (once). Refused when the list is full. */
export function addCandidate(list: readonly PickCandidate[], candidate: PickCandidate, max = PICK_MAX): CandidateChange {
  if (list.some((c) => c.key === candidate.key)) return { candidates: [...list], refused: null }
  if (list.length >= max) return { candidates: [...list], refused: 'full' }
  return { candidates: [...list, candidate], refused: null }
}

export function removeCandidate(list: readonly PickCandidate[], key: string): PickCandidate[] {
  return list.filter((c) => c.key !== key)
}

/** A tap on a Book in the list: in if it was out, out if it was in. */
export function toggleCandidate(list: readonly PickCandidate[], candidate: PickCandidate, max = PICK_MAX): CandidateChange {
  if (list.some((c) => c.key === candidate.key)) return { candidates: removeCandidate(list, candidate.key), refused: null }
  return addCandidate(list, candidate, max)
}

export function canPick(list: readonly PickCandidate[]): boolean {
  return list.length >= PICK_MIN && list.length <= PICK_MAX
}

// ------------------------------------------------------------------- the draw

/** Fills the array with random values: `crypto.getRandomValues` in the app, a seeded one in tests. */
export type RandomSource = (into: Uint32Array) => Uint32Array

export const cryptoRandom: RandomSource = (into) => globalThis.crypto.getRandomValues(into)

const RANGE = 2 ** 32

/** An index in [0, n), every one equally likely: values past the last whole multiple of n are drawn again. */
export function randomIndex(n: number, random: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`randomIndex: ${n} is not a count`)
  if (n === 1) return 0
  const limit = RANGE - (RANGE % n)
  const one = new Uint32Array(1)
  for (;;) {
    const value = random(one)[0]!
    if (value < limit) return value % n
  }
}

/**
 * The winner among the candidates, as an index: uniform among all of them but the one picked
 * last time (`previous`, a key), which only wins when it is the only one.
 */
export function drawWinner(candidates: readonly { key: string }[], previous: string | null, random: RandomSource = cryptoRandom): number {
  if (!candidates.length) throw new Error('drawWinner: no candidates')
  const open = candidates.map((c, index) => ({ c, index })).filter(({ c }) => c.key !== previous)
  const pool = open.length ? open : candidates.map((c, index) => ({ c, index }))
  return pool[randomIndex(pool.length, random)]!.index
}

// ----------------------------------------------------------------- the rounds

/** One round: the Books still in the running, which of them won, and whether there was a draw at all. */
export type PickRound = {
  number: number
  candidates: PickCandidate[]
  winner: number
  /** The only one left: picked without a draw (and without an animation). */
  alone: boolean
}

/** The first round over the chosen candidates. */
export function firstRound(candidates: readonly PickCandidate[], previous: string | null, random: RandomSource = cryptoRandom): PickRound {
  if (!candidates.length) throw new Error('firstRound: no candidates')
  return {
    number: 1,
    candidates: [...candidates],
    winner: drawWinner(candidates, previous, random),
    alone: candidates.length === 1,
  }
}

/** Decline: the shown Book leaves the running and the rest are drawn again; null when none is left. */
export function declineRound(round: PickRound, random: RandomSource = cryptoRandom): PickRound | null {
  const declined = round.candidates[round.winner]!
  const rest = round.candidates.filter((_, index) => index !== round.winner)
  if (!rest.length) return null
  return {
    number: round.number + 1,
    candidates: rest,
    winner: drawWinner(rest, declined.key, random),
    alone: rest.length === 1,
  }
}

export function winnerOf(round: PickRound): PickCandidate {
  return round.candidates[round.winner]!
}

/** The others still in the running (the row of small covers beside the result). */
export function othersOf(round: PickRound): PickCandidate[] {
  return round.candidates.filter((_, index) => index !== round.winner)
}

// --------------------------------------------------------------------- Accept

/**
 * What Accept ("Start reading") does: an entry on her Want to read list is started (the Start
 * reading action, `start_reading`); a search result goes through the add flow with Currently
 * reading (`add_to_library` with a first read). Nothing else.
 */
export type AcceptAction = { kind: 'start'; entryId: string } | { kind: 'add'; book: BookSnapshot | Book; status: 'reading' }

export function acceptAction(candidate: PickCandidate): AcceptAction {
  return candidate.kind === 'entry' ? { kind: 'start', entryId: candidate.entryId } : { kind: 'add', book: candidate.book, status: 'reading' }
}

import { finishedIn, type StatsRead, type StatsYear } from '../stats'
import { compareGenres, type GenreId } from './genres'

/**
 * The Profile's figures by genre (issue #168: "Your year: 40 % sci-fi"), worked out from the
 * finished reads of a year (or of all years) and the genres of the entries they belong to
 * (`createBookGenres(client).library()`: hers where she corrected them, else the computed ones).
 * Framework-free like `stats.ts`, so a native client computes the same figures from the same rows.
 *
 * The rules:
 * - A read counts as `stats.ts` counts it: a finished read in the year it ended, re-reads
 *   included.
 * - A Book counts once in each of its (up to three) genres, so the shares of a year can add up
 *   to more than 100 %: "40 % sci-fi" says four of ten books were sci-fi, not that the other six
 *   were not something else.
 * - The share is of the reads that have a genre; a read of a Book no source could place (and
 *   she has not placed) is counted in `without` and is in no share.
 * - Most read first; on a tie the canonical order of the list (`compareGenres`), so the order
 *   never jumps between two loads.
 */

export type GenreFigure = {
  genre: GenreId
  /** Finished reads of a Book with this genre. */
  count: number
  /** Of the reads that have a genre, 0–1. */
  share: number
}

export type GenreFigures = {
  year: StatsYear
  /** Every genre read in the year, most read first. */
  genres: GenreFigure[]
  /** Finished reads in the year with at least one genre: what the shares are of. */
  placed: number
  /** Finished reads in the year of a Book with none. */
  without: number
}

/** The genres of an entry (by the entry's id), or undefined while they are not known. */
export type GenresOfEntry = (entryId: string) => readonly GenreId[] | undefined

export function genreFiguresOf(reads: readonly StatsRead[], year: StatsYear, genresOf: GenresOfEntry): GenreFigures {
  const counts = new Map<GenreId, number>()
  let placed = 0
  let without = 0
  for (const read of finishedIn(reads, year)) {
    const genres = [...new Set(genresOf(read.entryId) ?? [])]
    if (!genres.length) {
      without++
      continue
    }
    placed++
    for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  const genres = [...counts.entries()]
    .map(([genre, count]) => ({ genre, count, share: count / placed }))
    .sort((a, b) => b.count - a.count || compareGenres(a.genre, b.genre))
  return { year, genres, placed, without }
}

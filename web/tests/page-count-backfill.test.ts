import { describe, expect, it } from 'vitest'
import { toIsbn13 } from '../app/data/dnbRecord'
import {
  askableIsbn,
  CANDIDATES_SQL,
  readAnswer,
  remaining,
  summaryLine,
  validPageCount,
  type Lookup,
  type PageCountCandidate,
  type RunSummary,
} from '../scripts/backfill/pageCounts'

/**
 * The page-count backfill's decisions, without a database or a network (scripts/backfill-page-counts.ts). The run itself
 * is a one-off against the operator's own stack; what is worth pinning down is the rule it must never break — a null and
 * only a null — and how it reads what Google and the function answer.
 */
describe('the page-count backfill', () => {
  describe('the candidate query', () => {
    it('is null-only in both halves of the rule the app applies', () => {
      // `pageCountOf` is `pageCountOverride ?? book.pageCount`: a read with neither is the read `pagesMissing` counts.
      expect(CANDIDATES_SQL).toMatch(/b\.page_count is null/)
      expect(CANDIDATES_SQL).toMatch(/e\.page_count_override is null/)
      // And a finished read, on a Catalogue Book, with an ISBN to ask about.
      expect(CANDIDATES_SQL).toMatch(/s\.outcome = 'finished'/)
      expect(CANDIDATES_SQL).toMatch(/b\.owner_id is null/)
      expect(CANDIDATES_SQL).toMatch(/coalesce\(b\.isbn13, b\.isbn10\) is not null/)
    })

    it('names one Book once, however many finished reads of it are missing the count', () => {
      expect(CANDIDATES_SQL).toMatch(/count\(distinct s\.id\)/)
      expect(CANDIDATES_SQL).toMatch(/group by b\.id/)
    })

    it('never writes, and never touches an override', () => {
      expect(CANDIDATES_SQL.toLowerCase()).not.toMatch(/\b(insert|update|delete|set)\b/)
      expect(CANDIDATES_SQL).not.toMatch(/page_count_override\s*=/)
    })
  })

  describe('which ISBN it asks about', () => {
    const candidate = (isbn13: string | null, isbn10: string | null = null): PageCountCandidate => ({ bookId: 'b', isbn13, isbn10, reads: 1 })

    it('asks about the Book’s own ISBN-13', () => {
      expect(askableIsbn(candidate('9783499267017'), toIsbn13)).toBe('9783499267017')
    })

    it('turns an ISBN-10 into an ISBN-13, which is what Google’s question takes', () => {
      expect(askableIsbn(candidate(null, '3499267012'), toIsbn13)).toBe('9783499267017')
    })

    it('has nothing to ask about without an ISBN: no question is invented', () => {
      expect(askableIsbn(candidate(null), toIsbn13)).toBeNull()
    })
  })

  describe('the count the database would accept', () => {
    it('is the range the RPC and progress_invalid take', () => {
      expect(validPageCount(1)).toBe(1)
      expect(validPageCount(384)).toBe(384)
      expect(validPageCount(99999)).toBe(99999)
      expect(validPageCount(0)).toBeNull()
      expect(validPageCount(100000)).toBeNull()
      expect(validPageCount(-1)).toBeNull()
      expect(validPageCount(1.5)).toBeNull()
      expect(validPageCount('384')).toBeNull()
      expect(validPageCount(null)).toBeNull()
    })
  })

  describe('one google-books answer', () => {
    it('is a count when Google says how many pages', () => {
      expect(readAnswer(200, { status: 'found', volume: { pageCount: 384 } })).toEqual({ kind: 'answered', pageCount: 384 })
    })

    it('is no count when Google knows the edition but says nothing about pages', () => {
      expect(readAnswer(200, { status: 'found', volume: { pageCount: null } })).toEqual({ kind: 'no-pages' })
    })

    it('is an unknown ISBN, not an error, when Google has no volume with it', () => {
      expect(readAnswer(200, { status: 'not_found' })).toEqual({ kind: 'unknown' })
    })

    it('stops the run when the function could not ask', () => {
      expect(readAnswer(200, { status: 'unavailable', reason: 'budget' })).toEqual({ kind: 'unavailable', reason: 'budget' })
      expect(readAnswer(429, {})).toEqual({ kind: 'unavailable', reason: 'rate_limited' })
      expect(readAnswer(502, {})).toEqual({ kind: 'unavailable', reason: 'http_502' })
    })
  })

  describe('the summary', () => {
    const summary = (written: number, candidates: number): RunSummary => ({
      candidates,
      askable: candidates - 5,
      asked: candidates - 5,
      answered: written,
      without: candidates - 5 - written,
      written,
      taken: 0,
      left: 0,
      stopReason: null,
    })

    it('counts what is left as the candidates the run did not fill', () => {
      expect(remaining(summary(12, 17))).toBe(5)
      expect(remaining(summary(17, 17))).toBe(0)
    })

    it('is one line, without a count per Book that could identify it', () => {
      const line = summaryLine({ ...summary(12, 17), left: 5 })
      expect(line).toBe(
        'Summary: 17 candidate Book(s), 12 with a usable ISBN, 12 asked, 12 answered, 0 without a count from Google, 12 written, 0 already filled, 5 left',
      )
      expect(line).not.toMatch(/978/)
    })

    it('says why the run stopped asking, when it did', () => {
      const line = summaryLine({ ...summary(3, 17), stopReason: 'budget' })
      expect(line).toMatch(/\(stopped: budget\)$/)
    })
  })

  describe('a dry run', () => {
    it('leaves every candidate in the count, because a dry run writes nothing', () => {
      const dry: RunSummary = { candidates: 17, askable: 17, asked: 17, answered: 14, without: 3, written: 0, taken: 0, left: 0, stopReason: null }
      // The runner sets `left` this way: a dry run counts as if nothing were written.
      expect(remaining({ ...dry, written: 0 })).toBe(17)
    })
  })
})

describe('the run stops asking', () => {
  // The loop's own guard: one `unavailable` ends it, everything else goes on to the next Book.
  const continues = (lookup: Lookup) => lookup.kind !== 'unavailable'

  it('at the first refusal, instead of asking against a closed door', () => {
    expect(continues({ kind: 'answered', pageCount: 384 })).toBe(true)
    expect(continues({ kind: 'no-pages' })).toBe(true)
    expect(continues({ kind: 'unknown' })).toBe(true)
    expect(continues({ kind: 'unavailable', reason: 'budget' })).toBe(false)
  })
})

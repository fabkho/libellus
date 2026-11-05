import { describe, expect, it } from 'vitest'
import { GROUPING_ABOVE, planByCount, planByPages } from '#layers/chat/app/utils/chapters'
import {
  buddyLink,
  DEFAULT_SECTION_COUNT,
  entryChoices,
  groupingsOf,
  MAX_INVITES,
  partsIn,
  previewOf,
  sectionsOf,
  setupProblem,
  startsOk,
  stepReady,
  type SetupDraft,
  type SetupPlan,
} from '@/utils/buddySetup'

/** The setup sheet's rules (components/together/SetupSheet.vue): Sections from the chat layer's arithmetic, what is wrong with a draft, which entries follow a read. */
const label = (r: { from: number; to: number }) => `Section ${r.from === r.to ? r.from : `${r.from}–${r.to}`}`
const WHOLE = 'The whole book'
const count = (n: number | null, per = 1): SetupPlan => ({ from: 'count', count: n, per })
const pages = (pageCount: number | null, perPart: number | null = 50): SetupPlan => ({ from: 'pages', pageCount, perPart })
const TODAY = '2026-11-15'
const draft = (over: Partial<SetupDraft> = {}): SetupDraft => ({ bookId: 'book-1', plan: count(5), invite: [], startsOn: null, ...over })

describe('Sections by count, through the layer', () => {
  it('makes one Section for each part and the whole book last, ending at k / N', () => {
    const made = sectionsOf(count(5), label, WHOLE)!
    expect(made.from).toBe('count')
    expect(made.pageCount).toBeNull()
    expect(made.sections.map((s) => [s.kind, s.label, s.toFraction])).toEqual([
      ['part', 'Section 1', 0.2],
      ['part', 'Section 2', 0.4],
      ['part', 'Section 3', 0.6],
      ['part', 'Section 4', 0.8],
      ['part', 'Section 5', 1],
      ['end', WHOLE, 1],
    ])
    expect(made.sections.every((s) => s.startPage === undefined)).toBe(true)
  })

  it('stores a fraction to four places, strictly rising, for any count up to 100', () => {
    for (const n of [1, 3, 7, 30, 31, 33, 64, 99, 100]) {
      const sections = sectionsOf(count(n), label, WHOLE)!.sections
      expect(sections).toHaveLength(n + 1)
      for (const s of sections) expect(Math.round(s.toFraction * 10000) / 10000).toBe(s.toFraction)
      sections.slice(0, n).forEach((s, i, all) => i && expect(s.toFraction).toBeGreaterThan(all[i - 1]!.toFraction))
      expect(sections.at(-1)).toMatchObject({ kind: 'end', toFraction: 1 })
    }
  })

  it('groups above 30: 2 or 3 parts to a Section, the last one shorter, the label the range', () => {
    const two = sectionsOf(count(61, 2), label, WHOLE)!.sections
    expect(two).toHaveLength(32)
    expect(two[0]).toMatchObject({ label: 'Section 1–2', toFraction: Math.round((2 / 61) * 10000) / 10000 })
    expect(two[30]).toMatchObject({ label: 'Section 61', toFraction: 1 })
    const three = sectionsOf(count(60, 3), label, WHOLE)!.sections
    expect(three).toHaveLength(21)
    expect(three[19]).toMatchObject({ label: 'Section 58–60', toFraction: 1 })
  })

  it('offers grouping only above 30 parts', () => {
    expect(GROUPING_ABOVE).toBe(30)
    expect(groupingsOf(30)).toEqual([1])
    expect(groupingsOf(31)).toEqual([1, 2, 3])
    expect(groupingsOf(null)).toEqual([1])
  })

  it('refuses a count outside 1 to 100, no count, or a grouping the layer does not know', () => {
    for (const n of [0, 101, -3, null, 2.5]) expect(sectionsOf(count(n as number | null), label, WHOLE)).toBeNull()
    expect(sectionsOf(count(10, 0), label, WHOLE)).toBeNull()
    expect(sectionsOf(count(10, 6), label, WHOLE)).toBeNull()
  })

  it('follows the layer: the parts are its ranges', () => {
    expect(partsIn(count(7, 2))).toEqual(planByCount(7, 2))
    expect(partsIn(count(null))).toEqual([])
  })
})

describe('Sections by pages, through the layer', () => {
  it('makes parts of so many pages with their pages, each ending at end page / page count', () => {
    const made = sectionsOf(pages(272, 100), label, WHOLE)!
    expect(made.from).toBe('pages')
    expect(made.pageCount).toBe(272)
    expect(made.sections.map((s) => [s.kind, s.startPage, s.endPage, s.toFraction])).toEqual([
      ['part', 1, 100, Math.round((100 / 272) * 10000) / 10000],
      ['part', 101, 200, Math.round((200 / 272) * 10000) / 10000],
      ['part', 201, 272, 1],
      ['end', undefined, undefined, 1],
    ])
  })

  it('hands the parts over page after page, as the database asks (each starts where the one before ended)', () => {
    const sections = sectionsOf(pages(608), label, WHOLE)!.sections
    sections.slice(1, -1).forEach((s, i) => expect(s.startPage).toBe(sections[i]!.endPage! + 1))
    expect(partsIn(pages(608))).toEqual(planByPages(608, 50))
  })

  it('refuses no page count, a size that makes more than 100 parts, or no size', () => {
    expect(sectionsOf(pages(null), label, WHOLE)).toBeNull()
    expect(sectionsOf(pages(10000, 50), label, WHOLE)).toBeNull()
    expect(sectionsOf(pages(300, 0), label, WHOLE)).toBeNull()
    expect(sectionsOf(pages(300, null), label, WHOLE)?.sections).toHaveLength(7)
  })
})

describe('a start day', () => {
  it('is empty (today), or a real day within a year of today', () => {
    expect(startsOk(null, TODAY)).toBe(true)
    expect(startsOk('', TODAY)).toBe(true)
    expect(startsOk('2026-11-15', TODAY)).toBe(true)
    expect(startsOk('2026-12-24', TODAY)).toBe(true)
    expect(startsOk('2027-11-15', TODAY)).toBe(true)
    expect(startsOk('2025-11-15', TODAY)).toBe(true)
    expect(startsOk('2027-11-30', TODAY)).toBe(false)
    expect(startsOk('2025-11-10', TODAY)).toBe(false)
    expect(startsOk('2026-02-30', TODAY)).toBe(false)
    expect(startsOk('soon', TODAY)).toBe(false)
  })
})

describe('what is wrong with a draft', () => {
  it('names the first problem, in the order the steps ask', () => {
    expect(setupProblem(draft(), TODAY)).toBeNull()
    expect(setupProblem(draft({ bookId: null, plan: count(0) }), TODAY)).toBe('book')
    expect(setupProblem(draft({ plan: count(0) }), TODAY)).toBe('count')
    expect(setupProblem(draft({ plan: pages(null) }), TODAY)).toBe('pages')
    expect(setupProblem(draft({ startsOn: '2031-01-01' }), TODAY)).toBe('starts')
    expect(setupProblem(draft({ invite: Array.from({ length: MAX_INVITES + 1 }, (_, i) => `m${i}`) }), TODAY)).toBe('invites')
    expect(setupProblem(draft({ invite: Array.from({ length: MAX_INVITES }, (_, i) => `m${i}`) }), TODAY)).toBeNull()
  })

  it('lets a step go on only when its part is good', () => {
    expect(stepReady('book', draft(), TODAY)).toBe(true)
    expect(stepReady('book', draft({ bookId: null }), TODAY)).toBe(false)
    expect(stepReady('book', draft({ startsOn: 'x' }), TODAY)).toBe(false)
    expect(stepReady('sections', draft({ plan: count(DEFAULT_SECTION_COUNT) }), TODAY)).toBe(true)
    expect(stepReady('sections', draft({ plan: count(null) }), TODAY)).toBe(false)
    expect(stepReady('invite', draft({ plan: count(null) }), TODAY)).toBe(false)
    expect(stepReady('invite', draft(), TODAY)).toBe(true)
  })
})

describe('the preview', () => {
  it('draws up to the shown rows, then how many more, then the last', () => {
    expect(previewOf([1, 2, 3, 4, 5, 6], 4)).toEqual({ head: [1, 2, 3], more: 2, tail: 6 })
    expect(previewOf([1, 2, 3, 4, 5], 4)).toEqual({ head: [1, 2, 3, 4], more: 0, tail: 5 })
    expect(previewOf([1, 2], 4)).toEqual({ head: [1], more: 0, tail: 2 })
    expect(previewOf([], 4)).toEqual({ head: [], more: 0, tail: null })
  })
})

describe('her entries that can follow a read', () => {
  const entries = [
    { id: 'e1', bookId: 'b1', title: 'Piranesi', authors: ['S. Clarke'] },
    { id: 'e2', bookId: 'b2', title: 'Piranesi', authors: ['Susanna Clarke'] },
    { id: 'e3', bookId: 'b3', title: 'Hyperion', authors: ['Dan Simmons'] },
  ]
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  it('puts the very Book first and the same title after it, and no other', () => {
    const { exact, similar } = entryChoices(entries, { id: 'b1', title: 'Piranesi' }, same)
    expect(exact.map((e) => e.id)).toEqual(['e1'])
    expect(similar.map((e) => e.id)).toEqual(['e2'])
  })

  it('finds none for a Book she does not have', () => {
    const { exact, similar } = entryChoices(entries, { id: 'b9', title: 'Dune' }, same)
    expect(exact).toEqual([])
    expect(similar).toEqual([])
  })
})

describe('addresses', () => {
  it('writes the link and the room', () => {
    expect(buddyLink('https://libellus.example', 'T'.repeat(22))).toBe(`https://libellus.example/t/${'T'.repeat(22)}`)
  })
})

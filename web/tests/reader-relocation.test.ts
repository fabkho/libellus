import { describe, expect, it } from 'vitest'
import { normalizeRelocation, type RelocateDetail, type RelocationRenderer } from '../app/data/reader/relocation'
import { BACK_MATTER, findBodyEnd, flattenToc, type TocEntry } from '../app/data/reader/toc'

/**
 * How the reader knows where it is (#131 phase 2), and what the book's own
 * structure is: `data/reader/relocation.ts` takes foliate's relocation detail
 * and the paginator's numbers and says the body fraction, the end, the minutes
 * left; `data/reader/toc.ts` says where the body ends (a Project Gutenberg
 * licence is not part of the book) and flattens the contents, back matter left
 * out. Plain Node, stubbed numbers: the engine itself is not tested here.
 */

/** A paginator in pages: the page showing out of `pages`, the whole reset for the rest. */
function pages(page: number, total: number, extra: Partial<RelocationRenderer> = {}): RelocationRenderer {
  return { flow: 'paginated', page, pages: total, size: 800, viewSize: 800, end: 800, ...extra }
}

/**
 * A paginator in scroll flow: foliate's `size` is the screen and its `viewSize` the chapter's own height there,
 * so `end` is where the visible part ends and the most it can scroll is `viewSize - size`.
 */
function scrolled(start: number, chapterHeight: number, screen = 800): RelocationRenderer {
  return { flow: 'scrolled', page: 0, pages: 0, start, size: screen, viewSize: chapterHeight, end: start + screen }
}

/** foliate's detail: its own fraction of the file, and what it knows. */
function detail(fraction: number, extra: Partial<RelocateDetail> = {}): RelocateDetail {
  return { fraction, cfi: 'epubcfi(/6/14[chap01]!/4/2/2:0)', ...extra }
}

describe('a relocation', () => {
  it('is the very start of the book: section 0, fraction 0, at its start', () => {
    const at = normalizeRelocation(detail(0, { section: { current: 0 }, cfi: 'epubcfi(/6/2!/4/2:0)' }), pages(1, 30, { fraction: 0 }), 1, 4)
    expect(at).toMatchObject({ fraction: 0, sectionFraction: 0, sectionIndex: 0, atStart: true, atEnd: false })
  })

  it('is not at its start once the section has moved on, nor on the second page of section 0', () => {
    expect(normalizeRelocation(detail(0.1, { section: { current: 1 } }), pages(1, 30, { fraction: 0 }), 1, 4).atStart).toBe(false)
    expect(normalizeRelocation(detail(0.1, { section: { current: 0 } }), pages(2, 30, { fraction: 0.05 }), 1, 4).atStart).toBe(false)
  })

  it('is the very end of the body: the last body section on its last page is fraction 1 and at its end', () => {
    // 5 sections, the body being the first 3 (sections 3 and 4 are back matter): 0.9 of the file is still inside it.
    const at = normalizeRelocation(detail(0.9, { section: { current: 2 } }), pages(20, 22), 0.75, 2)
    expect(at).toMatchObject({ fraction: 1, sectionIndex: 2, atEnd: true })
  })

  it('is past the body: a back-matter section is the end too, whatever page it is on', () => {
    const at = normalizeRelocation(detail(0.95, { section: { current: 3 } }), pages(2, 8), 0.75, 2)
    expect(at).toMatchObject({ fraction: 1, sectionIndex: 3, atEnd: true })
  })

  it('is not the end on the second-to-last page of the last body section only past it: the paginator keeps two', () => {
    // The paginator counts two pages past the text (page 1 is the cover's, the last two are its own edges).
    expect(normalizeRelocation(detail(0.7, { section: { current: 2 } }), pages(19, 22), 0.75, 2).atEnd).toBe(false)
    expect(normalizeRelocation(detail(0.7, { section: { current: 2 } }), pages(20, 22), 0.75, 2).atEnd).toBe(true)
  })

  it('with no section at all counts as the first one', () => {
    const at = normalizeRelocation(detail(0.2), pages(3, 30, { fraction: 0.1 }), 1, 4)
    expect(at.sectionIndex).toBe(0)
    expect(at.chapter).toBeNull()
    expect(at.chapterHref).toBeNull()
  })

  it('with a missing fraction comes out NaN, as the arithmetic is (see the note in the report)', () => {
    // foliate leaves `fraction` off a detail when the paginator has no pages yet (`#afterScroll`): undefined / 0.5 is
    // NaN, `Math.min`/`Math.max` keep it NaN, and so do the book's minutes (they are divided by `1 - fraction`).
    const at = normalizeRelocation({ cfi: 'epubcfi(/6/2!/4/2:0)' } as RelocateDetail, pages(3, 30), 0.5, 8)
    expect(Number.isNaN(at.fraction)).toBe(true)
    expect(Number.isNaN(at.minutesLeftInBook)).toBe(true)
    // The rest of the record is filled in as usual: the section's own fraction, the minutes left in it, the flags.
    expect(at).toMatchObject({ sectionIndex: 0, sectionFraction: 0, minutesLeftInChapter: 0, atStart: true, atEnd: false })
  })

  it('divides foliate’s fraction by the body’s end, and the section fraction is the renderer’s', () => {
    const at = normalizeRelocation(detail(0.5, { section: { current: 1 } }), pages(5, 30, { fraction: 0.42, reason: 'page' }), 0.8, 8)
    expect(at.fraction).toBeCloseTo(0.625, 10)
    expect(at.sectionFraction).toBe(0.42)
    expect(at.reason).toBe('page')
  })

  it('keeps the minutes left, and takes the back matter’s share out of the book’s', () => {
    // Halfway through a file whose body is three quarters of it, 300 minutes left: the remaining half is half back
    // matter (a quarter of the file), so half of those minutes are not hers to read.
    const at = normalizeRelocation(detail(0.5, { section: { current: 1 }, time: { section: 12, total: 300 } }), pages(5, 30), 0.75, 8)
    expect(at.minutesLeftInChapter).toBe(12)
    expect(at.minutesLeftInBook).toBe(150)
  })

  it('counts no back matter in its minutes when the body is the whole file', () => {
    const at = normalizeRelocation(detail(0.5, { section: { current: 1 }, time: { section: 12, total: 300 } }), pages(5, 30), 1, 8)
    expect(at.minutesLeftInBook).toBe(300)
  })

  it('never reports negative minutes, nor a back matter that “adds” time', () => {
    const at = normalizeRelocation(detail(0.2, { time: { section: -3, total: 100 } }), pages(5, 30), 1, 8)
    expect(at.minutesLeftInChapter).toBe(0)
    expect(at.minutesLeftInBook).toBe(100)
  })

  it('is at its end in scroll flow once the visible part reaches the chapter’s end', () => {
    // A chapter 1400 px tall on an 800 px screen: 600 px of scrolling, so at 300 there is more to come.
    expect(normalizeRelocation(detail(0.9, { section: { current: 2 } }), scrolled(300, 1400), 1, 2).atEnd).toBe(false)
    // The chapter ends 3 px above the visible bottom, inside the 4 px slack.
    expect(normalizeRelocation(detail(0.9, { section: { current: 2 } }), scrolled(597, 1400), 1, 2).atEnd).toBe(true)
  })

  it('fits in scroll flow when the chapter is no taller than the screen (a cover, a title page)', () => {
    expect(normalizeRelocation(detail(0.2), scrolled(0, 600), 1, 8).fits).toBe(true)
    expect(normalizeRelocation(detail(0.2), scrolled(0, 1600), 1, 8).fits).toBe(false)
    // In pages it says nothing: there is no scrolling at all.
    expect(normalizeRelocation(detail(0.2), pages(3, 30), 1, 8).fits).toBe(false)
  })

  it('reads the chapter from the contents entry, trimmed, empty as no chapter', () => {
    const chapter = { label: '  Chapter IV  ', href: 'text/ch04.xhtml' }
    expect(normalizeRelocation(detail(0.4, { tocItem: chapter, section: { current: 3 } }), pages(3, 30), 1, 8)).toMatchObject({
      chapter: 'Chapter IV',
      chapterHref: 'text/ch04.xhtml',
    })
    expect(normalizeRelocation(detail(0.4, { tocItem: { label: '   ' }, section: { current: 3 } }), pages(3, 30), 1, 8).chapter).toBeNull()
  })
})

describe('where the body ends', () => {
  const sections = (...ids: [string, string?][]): { id: string; linear?: string; size: number }[] =>
    ids.map(([id, linear]) => ({ id, linear, size: 100 }))
  /** One section's share of the file, evenly: n sections, each 1/n. */
  const fractions = (n: number) => Array.from({ length: n }, (_, i) => i / n)

  it('is the last section when there is no back matter', () => {
    expect(findBodyEnd(sections(['cover', 'no'], ['ch01'], ['ch02']), fractions(3))).toEqual({ index: 2, fraction: 1 })
  })

  it('stops before the licence, and the body’s fraction is where that section starts', () => {
    // 4 sections: three of the book, the licence the fourth (0.75 of the file).
    const body = findBodyEnd(sections(['cover', 'no'], ['ch01'], ['ch02'], ['licence.xhtml']), fractions(4))
    expect(body).toEqual({ index: 2, fraction: 0.75 })
  })

  it('takes every trailing licence, colophon and non-linear section, not just one', () => {
    const body = findBodyEnd(sections(['ch01'], ['ch02'], ['licence'], ['colophon'], ['cover-back', 'no']), fractions(5))
    expect(body).toEqual({ index: 1, fraction: 0.4 })
  })

  it('is the first section when every section is back matter (never below 0)', () => {
    expect(findBodyEnd(sections(['licence'], ['colophon']), fractions(2))).toEqual({ index: 0, fraction: 0.5 })
  })

  it('reads the section’s id, not its title: the licence’s own href is the filter', () => {
    expect(BACK_MATTER.test('text/licence.xhtml')).toBe(true)
    expect(BACK_MATTER.test('text/chapter-licensee.xhtml')).toBe(true)
    expect(BACK_MATTER.test('text/chapter-4.xhtml')).toBe(false)
  })
})

describe('the contents', () => {
  /** A book whose hrefs are one section each, in the order they are resolved. */
  function book(toc: TocEntry[], sections = 8) {
    const order = new Map<string, number>()
    return {
      toc,
      resolveHref: (href: string) => {
        if (href === 'nowhere') return null
        if (href === 'boom') throw new Error('a broken href')
        if (!order.has(href)) order.set(href, order.size)
        return { index: Math.min(order.get(href)!, sections - 1) }
      },
    }
  }
  const fractions = Array.from({ length: 8 }, (_, i) => i / 8)

  it('flattens one level: every entry depth 0, its start as a fraction of the body', () => {
    const toc = flattenToc(book([{ label: 'One', href: 'a' }, { label: 'Two', href: 'b' }]), fractions, 1)
    expect(toc).toEqual([
      { label: 'One', href: 'a', depth: 0, fraction: 0 },
      { label: 'Two', href: 'b', depth: 0, fraction: 0.125 },
    ])
  })

  it('flattens a nested one: the depth follows the tree, the order is the sheet’s', () => {
    const toc = flattenToc(
      book([
        { label: 'Part I', href: 'p1', subitems: [{ label: 'Chapter 1', href: 'c1' }, { label: 'Chapter 2', href: 'c2', subitems: [{ label: 'A scene', href: 's1' }] }] },
        { label: 'Part II', href: 'p2' },
      ]),
      fractions,
      1,
    )
    expect(toc.map((item) => [item.label, item.depth])).toEqual([
      ['Part I', 0],
      ['Chapter 1', 1],
      ['Chapter 2', 1],
      ['A scene', 2],
      ['Part II', 0],
    ])
    // The fractions come from the hrefs in the order they were resolved, not from the tree's depth.
    expect(toc.map((item) => item.fraction)).toEqual([0, 0.125, 0.25, 0.375, 0.5])
  })

  it('leaves the back matter’s own entries out, and the sections they name', () => {
    const toc = flattenToc(
      book([
        { label: 'Chapter 1', href: 'c1' },
        { label: 'Licence', href: 'lic' },
        { label: 'Chapter 2', href: 'c2' },
        { label: 'The Project Gutenberg eBook', href: 'pg' },
        { label: 'Colophon', href: 'col' },
      ]),
      fractions,
      1,
    )
    expect(toc.map((item) => item.label)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('trims a label, and keeps the href even when the section cannot be found', () => {
    const toc = flattenToc(book([{ label: '  Chapter 1  ', href: 'nowhere' }, { label: 'Chapter 2', href: 'boom' }]), fractions, 1)
    expect(toc).toEqual([
      { label: 'Chapter 1', href: 'nowhere', depth: 0, fraction: null },
      { label: 'Chapter 2', href: 'boom', depth: 0, fraction: null },
    ])
  })

  it('counts a chapter’s start against the body, never past it', () => {
    // The last section starts at 7/8 of the file and the body is 0.5 of it: still only 1.
    const toc = flattenToc(book([{ label: 'Chapter', href: 'last' }, { label: 'Last', href: 'last2' }, { label: 'And', href: 'last3' }, { label: 'More', href: 'last4' }, { label: 'Again', href: 'last5' }, { label: 'And again', href: 'last6' }, { label: 'Once more', href: 'last7' }]), fractions, 0.5)
    expect(toc.at(-1)!.fraction).toBe(1)
  })

  it('is an empty list for a book that has no contents at all', () => {
    expect(flattenToc({ toc: undefined, resolveHref: () => null }, fractions, 1)).toEqual([])
    expect(flattenToc({ toc: [], resolveHref: () => null }, fractions, 1)).toEqual([])
  })
})

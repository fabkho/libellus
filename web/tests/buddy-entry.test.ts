import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BuddyCard } from '@/data/buddyReads'
import { activeReads, bookEntryAction, canReadTogether, homeReads, readOfBook, unreadBadge, unreadTotal, whereWords } from '@/utils/buddyEntry'

/**
 * The entry points of a buddy read: what the Book page's action and Home's card say, as view models (utils/buddyEntry.ts, plain Node), and where the screens put
 * them (read from the sources as they are, no comment stripping). Buddy reads are for every member: the Book page offers the action on every Book, and neither
 * it nor Home loads the big store, the chat layer or the Realtime client.
 */

const book = (id: string) => ({ id, title: `Book ${id}`, authors: [], manual: false, unverified: false }) as unknown as BuddyCard['book']
const card = (id: string, bookId: string, over: Partial<BuddyCard> = {}): BuddyCard => ({
  id,
  book: book(bookId),
  status: 'active',
  startsOn: '2026-11-01',
  role: 'member',
  memberCount: 3,
  sections: 10,
  where: { kind: 'section', section: 2 },
  unread: 0,
  ...over,
})

describe('which Books can be read together', () => {
  it('takes a Catalogue Book, in her Library or not, never a Manual book or nothing', () => {
    expect(canReadTogether({ source: 'openlibrary' })).toBe(true)
    expect(canReadTogether({ source: 'apple' })).toBe(true)
    expect(canReadTogether({ source: 'manual' })).toBe(false)
    expect(canReadTogether(null)).toBe(false)
    expect(canReadTogether(undefined)).toBe(false)
  })
})

describe('her reads of a Book', () => {
  const reads = [
    card('finished', 'a', { status: 'finished' }),
    card('other', 'b'),
    card('mine', 'a', { unread: 4 }),
    card('archived', 'a', { status: 'archived' }),
  ]

  it('counts the active reads only', () => {
    expect(activeReads(reads).map((r) => r.id)).toEqual(['other', 'mine'])
    expect(activeReads(null)).toEqual([])
    expect(activeReads(undefined)).toEqual([])
  })

  it('finds the active read of a Book, never a finished or archived one', () => {
    expect(readOfBook(reads, 'a')?.id).toBe('mine')
    expect(readOfBook(reads, 'b')?.id).toBe('other')
    expect(readOfBook(reads, 'c')).toBeNull()
    expect(readOfBook([card('f', 'a', { status: 'finished' })], 'a')).toBeNull()
  })

  it('takes the first when there are two (the server sorts the newest start first)', () => {
    expect(readOfBook([card('new', 'a'), card('old', 'a')], 'a')?.id).toBe('new')
  })

  it('knows nothing before her reads were read, or for no Book', () => {
    expect(readOfBook(null, 'a')).toBeNull()
    expect(readOfBook(reads, null)).toBeNull()
    expect(readOfBook(reads, undefined)).toBeNull()
  })

  const mine = reads[2]!
  const catalogue = (id: string) => ({ id, source: 'openlibrary' })

  it('offers to open the read she is in, held or not', () => {
    expect(bookEntryAction(catalogue('a'), true, reads)).toEqual({ kind: 'open', read: mine })
    expect(bookEntryAction(catalogue('a'), false, reads)).toEqual({ kind: 'open', read: mine })
  })

  it('offers to start one otherwise, and says whether starting adds the Book to her Library', () => {
    expect(bookEntryAction(catalogue('c'), true, reads)).toEqual({ kind: 'start', adds: false })
    expect(bookEntryAction(catalogue('c'), false, reads)).toEqual({ kind: 'start', adds: true })
    expect(bookEntryAction(catalogue('c'), false, null)).toEqual({ kind: 'start', adds: true })
    expect(bookEntryAction(catalogue('a'), true, [card('f', 'a', { status: 'finished' })])).toEqual({ kind: 'start', adds: false })
  })

  it('offers to start one for a search result that is not in the Catalogue yet (no id), adding it', () => {
    expect(bookEntryAction({ source: 'openlibrary' }, false, reads)).toEqual({ kind: 'start', adds: true })
  })

  it('is not available for a Manual book, whatever her reads say, and offers nothing for no Book', () => {
    expect(bookEntryAction({ id: 'a', source: 'manual' }, true, reads)).toEqual({ kind: 'unavailable' })
    expect(bookEntryAction({ source: 'manual' }, false, null)).toEqual({ kind: 'unavailable' })
    expect(bookEntryAction(null, false, reads)).toBeNull()
    expect(bookEntryAction(undefined, true, reads)).toBeNull()
  })
})

describe("Home's card", () => {
  it('lists the active reads, those with news first, the server order within each group', () => {
    const reads = [card('a', '1'), card('fin', '2', { status: 'finished', unread: 9 }), card('b', '3', { unread: 2 }), card('c', '4'), card('d', '5', { unread: 7 })]
    expect(homeReads(reads).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('is empty with nothing read yet', () => {
    expect(homeReads(null)).toEqual([])
    expect(homeReads([])).toEqual([])
  })

  it('adds up what is new across the active reads only', () => {
    expect(unreadTotal([card('a', '1', { unread: 2 }), card('b', '2', { unread: 3 }), card('c', '3', { status: 'archived', unread: 50 })])).toBe(5)
    expect(unreadTotal(null)).toBe(0)
  })
})

describe('the unread badge', () => {
  it('shows nothing at 0, the number, then 99+', () => {
    expect(unreadBadge(0)).toBeNull()
    expect(unreadBadge(-3)).toBeNull()
    expect(unreadBadge(1)).toEqual({ text: '1', count: 1 })
    expect(unreadBadge(99)).toEqual({ text: '99', count: 99 })
    expect(unreadBadge(100)).toEqual({ text: '99+', count: 100 })
    expect(unreadBadge(2.9)).toEqual({ text: '2', count: 2 })
  })
})

describe('where she is, in words', () => {
  it('names the Section, all of it read, or not set yet', () => {
    expect(whereWords({ kind: 'section', section: 4 })).toEqual({ key: 'together.where.section', values: { n: 4 } })
    expect(whereWords({ kind: 'end' })).toEqual({ key: 'together.where.end', values: {} })
    expect(whereWords({ kind: 'not_set' })).toEqual({ key: 'together.where.notSet', values: {} })
  })
})


describe('where the screens put the entry points (read from the sources)', () => {
  const app = join(process.cwd(), 'app')
  const read = (file: string) => readFileSync(join(app, file), 'utf8')
  /** The module names a file imports as values: `import … from 'x'` on a line of its own, `import type` left out. */
  const imports = (file: string) =>
    read(file)
      .split('\n')
      .map((line) => /^\s*import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/.exec(line)?.[1])
      .filter((spec): spec is string => Boolean(spec))

  it('the Book page puts the action in the action area, under the Book’s one action and above the ebook rows, for every Book', () => {
    const page = read('pages/book/[key].vue')
    const at = (needle: string) => page.indexOf(needle)
    const row = '<TogetherBookRow :book="book" :entry="entry" />'
    expect(at(row)).toBeGreaterThan(at('data-testid="book.actions"'))
    expect(at(row)).toBeGreaterThan(at('data-testid="book.add"'))
    expect(at(row)).toBeLessThan(at('<BookEbook'))
    // Not behind a condition of its own, nor a menu: the line carries nothing but the component.
    expect(page.split('\n').filter((line) => line.includes('TogetherBookRow')).every((line) => line.trim() === row || line.includes('<!--'))).toBe(true)
  })

  it('Home draws its card without a condition and builds the ⋯ menu (with the setup sheet) only when a ⋯ is pressed', () => {
    const page = read('pages/index.vue')
    expect(page).toContain('<HomeTogether />')
    expect(page).toContain('<LazyHomeTogetherMenu v-if="togetherAsked"')
    expect(page).not.toMatch(/togetherOn|useBuddyReadsOn/)
  })

  it('a Currently reading card has the ⋯ for a Catalogue Book, asked of nothing else', () => {
    const card = read('components/home/ReadingCard.vue')
    expect(card).toContain('canReadTogether(props.entry.book)')
    expect(card).not.toMatch(/useBuddyReadsOn/)
  })

  it('the page, the card, Home’s parts and the row import no buddy read store but the small one, no data layer and no chat layer', () => {
    for (const file of ['pages/book/[key].vue', 'pages/index.vue', 'components/home/ReadingCard.vue', 'components/home/Together.vue', 'components/together/BookRow.vue']) {
      expect(imports(file).filter((spec) => /stores\/buddyRead(?![A-Za-z])|data\/buddyReads|data\/buddyLive|@fabkho\/chat|#layers\/chat/.test(spec)), file).toEqual([])
    }
  })

  it('the row builds the setup sheet only when she presses the action', () => {
    const row = read('components/together/BookRow.vue')
    expect(row).toContain('<LazyTogetherSetupSheet v-if="asked"')
  })

  it('the lazy components exist where the pages name them', () => {
    for (const file of ['components/together/BookRow.vue', 'components/home/Together.vue', 'components/home/TogetherMenu.vue']) expect(existsSync(join(app, file))).toBe(true)
  })

  it('Home reads her list through the small store and asks again on every showing', () => {
    const home = read('components/home/Together.vue')
    expect(home).toContain('invites.load({ force: true })')
    expect(home).toContain('onActivated(')
  })
})

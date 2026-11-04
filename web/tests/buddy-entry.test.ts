import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BuddyCard } from '@/data/buddyReads'
import { activeReads, bookEntryAction, canReadTogether, homeReads, readOfBook, unreadBadge, unreadTotal, whereWords } from '@/utils/buddyEntry'

/**
 * The entry points of a buddy read (W5): what the Book page's row and Home's card say, as view models (utils/buddyEntry.ts, plain Node), and the
 * rule that with buddy reads off neither entry exists: the pages draw them only behind `useBuddyReadsOn` and load them lazily, so a build or a
 * switch without the feature never loads the store or asks the server.
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
  it('takes a Catalogue Book of her Library, not a Manual book, nothing', () => {
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

  it('offers to open the read she is in, else to start one', () => {
    expect(bookEntryAction(reads, 'a')).toEqual({ kind: 'open', read: reads[2] })
    expect(bookEntryAction(reads, 'c')).toEqual({ kind: 'start' })
    expect(bookEntryAction(null, 'a')).toEqual({ kind: 'start' })
    expect(bookEntryAction([card('f', 'a', { status: 'finished' })], 'a')).toEqual({ kind: 'start' })
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

describe('with buddy reads off, neither entry exists', () => {
  const app = join(process.cwd(), 'app')
  const read = (file: string) => readFileSync(join(app, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the Book page draws the row only behind the flag and the switch, lazily', () => {
    const page = read('pages/book/[key].vue')
    expect(page).toMatch(/<LazyTogetherBookRow[^>]*v-if="[^"]*togetherOn[^"]*"/)
    expect(page).toMatch(/togetherOn = useBuddyReadsOn\(\)/)
    expect(page).toMatch(/<LazyTogetherBookRow[^>]*canReadTogether\(entry\.book\)/)
  })

  it('Home draws the card and the menu only behind the flag and the switch, lazily', () => {
    const page = read('pages/index.vue')
    expect(page).toMatch(/togetherOn = useBuddyReadsOn\(\)/)
    const uses = [...page.matchAll(/<LazyHomeTogether(?:Menu)?\b[^>]*>/g)].map((m) => m[0])
    expect(uses.length).toBeGreaterThanOrEqual(3)
    for (const use of uses) expect(use).toMatch(/v-if="togetherOn"/)
  })

  it("a Currently reading card's ... is drawn behind the same check", () => {
    const card = read('components/home/ReadingCard.vue')
    expect(card).toMatch(/useBuddyReadsOn\(\)/)
    expect(card).toMatch(/<button\s+v-if="together"/)
  })

  it('neither page imports the buddy read store or its data layer: they stay in the lazy components', () => {
    for (const file of ['pages/book/[key].vue', 'pages/index.vue', 'components/home/ReadingCard.vue']) {
      const imports = [...read(file).matchAll(/^\s*import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
      expect(imports.filter((spec) => /stores\/buddyRead(?![A-Za-z])|data\/buddyReads|data\/buddyLive/.test(spec))).toEqual([])
    }
  })

  it('the lazy components exist where the pages name them', () => {
    for (const file of ['components/together/BookRow.vue', 'components/home/Together.vue', 'components/home/TogetherMenu.vue']) expect(existsSync(join(app, file))).toBe(true)
  })

  it('Home hands the invitations over and does not ask for them a second time', () => {
    const home = read('components/home/Together.vue')
    expect(home).toMatch(/invites\.take\(/)
    expect(home).toMatch(/<TogetherInvitations[^>]*:load="false"/)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createSocial, READERS_PAGE } from '@/data/social'
import { bookReaderFromJson, bookReadersPageFromJson } from '@/data/socialShapes'
import type { BookReader } from '@/data/socialShapes'
import { compareReaders, mergeReaders, readerRank, READERS_SHOWN, withoutMember } from '@/utils/bookReaders'
import { isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Readers on a Book's page (social v2a, contract §1.5, task V2A-C6): the order and mapping the screen keeps, the
 * repository's call, and the database through it against the social stack (the privacy matrix is pgTAP's).
 */

const CARD = (id: string) => ({ id, name: id.toUpperCase(), photo: null })
const reader = (id: string, state: BookReader['state'], day: string | null, review: string | null = null): BookReader => ({
  member: { id, name: id, photo: null },
  state,
  day,
  rating: null,
  review,
  spoilers: false,
  folded: false,
  sessionId: null,
  likes: 0,
  liked: false,
})

describe('the order the screen keeps', () => {
  it('ranks finished with a review, finished, reading, abandoned, wants to read', () => {
    expect(readerRank(reader('a', 'finished', '2026-10-01', 'Good'))).toBe(1)
    expect(readerRank(reader('a', 'finished', '2026-10-01'))).toBe(2)
    expect(readerRank(reader('a', 'reading', '2026-10-01'))).toBe(3)
    expect(readerRank(reader('a', 'abandoned', '2026-10-01'))).toBe(4)
    expect(readerRank(reader('a', 'want', '2026-10-01'))).toBe(5)
  })

  it('sorts by rank, then the newest day first with a missing day last, then by member', () => {
    const list = [
      reader('w', 'want', '2026-10-09'),
      reader('r2', 'reading', null),
      reader('f2', 'finished', '2026-10-02'),
      reader('r1', 'reading', '2026-10-05'),
      reader('fr', 'finished', '2026-09-01', 'Old but reviewed'),
      reader('f1', 'finished', '2026-10-08'),
      reader('a', 'abandoned', '2026-10-01'),
      reader('b', 'reading', '2026-10-05'),
    ]
    expect([...list].sort(compareReaders).map((r) => r.member.id)).toEqual(['fr', 'f1', 'f2', 'b', 'r1', 'r2', 'a', 'w'])
  })

  it('merges a page after what is there: a member named again is replaced, the order holds', () => {
    const have = [reader('a', 'finished', '2026-10-05', 'x'), reader('b', 'finished', '2026-10-01')]
    const merged = mergeReaders(have, [reader('b', 'reading', '2026-10-09'), reader('c', 'want', '2026-10-02')])
    expect(merged.map((r) => [r.member.id, r.state])).toEqual([['a', 'finished'], ['b', 'reading'], ['c', 'want']])
  })

  it('drops a member who left her circle, and the section shows five', () => {
    expect(withoutMember([reader('a', 'want', null), reader('b', 'want', null)], 'a').map((r) => r.member.id)).toEqual(['b'])
    expect(READERS_SHOWN).toBe(5)
  })
})

describe('what the database answers, as shapes', () => {
  it('reads a row with its defaults and a page with its cursor', () => {
    expect(bookReaderFromJson({ member: CARD('m'), state: 'want', day: null })).toEqual({
      member: { id: 'm', name: 'M', photo: null },
      state: 'want',
      day: null,
      rating: null,
      review: null,
      spoilers: false,
      folded: false,
      sessionId: null,
      likes: 0,
      liked: false,
    })
    const page = bookReadersPageFromJson({
      total: 7,
      items: [{ member: CARD('m'), state: 'finished', day: '2026-10-03', rating: 18, review: 'Good', spoilers: true, folded: true, sessionId: 's', likes: 2, liked: true }],
      next: { rank: 1, day: '2026-10-03', member: 'm' },
    })
    expect(page.total).toBe(7)
    expect(page.items[0]).toMatchObject({ state: 'finished', rating: 18, review: 'Good', spoilers: true, folded: true, sessionId: 's', likes: 2, liked: true })
    expect(page.next).toEqual({ rank: 1, day: '2026-10-03', member: 'm' })
    expect(bookReadersPageFromJson({ total: 0, items: [], next: null }).next).toBeNull()
  })
})

describe('the call, with a stand-in client', () => {
  function stub(answer: { data?: unknown; error?: { message?: string; code?: string } | null; status?: number }) {
    const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 }))
    return { rpc, social: createSocial({ rpc } as never, { online: () => true }) }
  }

  it('asks book_readers with the cursor and a limit held to a page', async () => {
    const { rpc, social } = stub({ data: { total: 0, items: [], next: null } })
    await social.bookReaders('b1')
    await social.bookReaders('b1', { rank: 2, day: '2026-10-01', member: 'm' }, 5)
    await social.bookReaders('b1', null, 5000)
    await social.bookReaders('b1', null, 0)
    expect(rpc.mock.calls).toEqual([
      ['book_readers', { p_book: 'b1', p_after: null, p_limit: READERS_PAGE }],
      ['book_readers', { p_book: 'b1', p_after: { rank: 2, day: '2026-10-01', member: 'm' }, p_limit: 5 }],
      ['book_readers', { p_book: 'b1', p_after: null, p_limit: READERS_PAGE }],
      ['book_readers', { p_book: 'b1', p_after: null, p_limit: 1 }],
    ])
  })

  it('maps a refusal, and is offline before anything is sent', async () => {
    expect((await stub({ error: { message: 'rate_limited', code: 'PT429' }, status: 429 }).social.bookReaders('b')).error).toBe('rate_limited')
    const rpc = vi.fn()
    expect(await createSocial({ rpc } as never, { online: () => false }).bookReaders('b')).toEqual({ data: null, error: 'offline' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ the database

function edition(title: string, work: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['An Author'],
    isbn13: null,
    isbn10: null,
    pageCount: 200,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: `OL${Math.floor(Math.random() * 8_000_000) + 1_000_000}M`,
    openLibraryWorkKey: work,
  }
}
const workKey = () => `OL${Math.floor(Math.random() * 8_000_000) + 1_000_000}W`
void uniqueAppleId

/** Ben opens Ada's link, asks, she accepts (her account is private by default): he follows her. */
async function follows(owner: TestMember, follower: TestMember) {
  const mine = await owner.client.rpc('my_social')
  expect((await follower.client.rpc('follow_target', { p_token: mine.data.link })).error).toBeNull()
  expect((await follower.client.rpc('follow', { p_member: owner.id })).error).toBeNull()
  expect((await owner.client.rpc('answer_request', { p_member: follower.id, p_accept: true })).error).toBeNull()
}

describe('Readers through the repository, against the stack', () => {
  it('lists the followed readers of another edition of the work, in the order, and nobody else', async () => {
    const work = workKey()
    const ben = await signUpMember()
    const ada = await signUpMember()
    const cy = await signUpMember()
    const stranger = await signUpMember()
    await follows(ada, ben)
    await follows(cy, ben)

    const mine = (await createLibrary(ben.client).addToLibrary(edition('Mine', work), { status: 'want_to_read' })).data!
    const today = isoDay()
    expect((await createLibrary(ada.client).addToLibrary(edition('Hers', work), { status: 'finished', startedOn: today, endedOn: today, rating: 18, review: 'Loved it.' })).error).toBeNull()
    expect((await createLibrary(cy.client).addToLibrary(edition('Cys', work), { status: 'reading', startedOn: today })).error).toBeNull()
    expect((await createLibrary(stranger.client).addToLibrary(edition('Strangers', work), { status: 'finished', startedOn: today, endedOn: today })).error).toBeNull()

    const answer = await createSocial(ben.client).bookReaders(mine.book.id)
    expect(answer.error).toBeNull()
    expect(answer.data!.total).toBe(2)
    expect(answer.data!.items.map((r) => [r.member.id, r.state, r.rating, r.review])).toEqual([
      [ada.id, 'finished', 18, 'Loved it.'],
      [cy.id, 'reading', null, null],
    ])
    expect(answer.data!.next).toBeNull()
    expect(answer.data!.items[0]!.sessionId).toBeTruthy()

    // A page of one, then the next by the cursor.
    const first = (await createSocial(ben.client).bookReaders(mine.book.id, null, 1)).data!
    expect(first.items.map((r) => r.member.id)).toEqual([ada.id])
    expect(first.next).not.toBeNull()
    const second = (await createSocial(ben.client).bookReaders(mine.book.id, first.next, 1)).data!
    expect(second.items.map((r) => r.member.id)).toEqual([cy.id])
    expect(second.next).toBeNull()

    // The stranger, who follows nobody, sees nobody; a Book nobody reads: an empty page.
    const none = (await createSocial(stranger.client).bookReaders(mine.book.id)).data!
    expect(none).toEqual({ total: 0, items: [], next: null })
    expect((await createSocial(ben.client).bookReaders(crypto.randomUUID())).data).toEqual({ total: 0, items: [], next: null })
  })
})

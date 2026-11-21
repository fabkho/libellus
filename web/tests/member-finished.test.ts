import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createSocial, SHELF_PAGE } from '@/data/social'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Her whole finished history, a page at a time (the shelf page's Stack): `memberFinished` through the
 * repository against the local stack, with real members. Her profile carries her newest twelve; the pile
 * that is her shelf must be all of them, so the pages have to walk past the twelfth in her profile's order
 * (the read's end, newest first) without repeating a row, and the read must stay behind the very same
 * guards (who may see her at all, her *Finished* switch, a hidden Book). The rules themselves are the
 * database's (supabase/tests/member_shelf_paging_test.sql).
 */

const today = isoDay()

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 250,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: 'https://example.org/cover.jpg',
    coverThumbhash: null,
    coverColors: { dominant: '#112233', secondary: '#445566' },
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

const social = (member: TestMember) => createSocial(member.client, { online: () => true })

/** She follows him and he follows her: two members who see each other. */
const connected = (a: TestMember, b: TestMember) => [
  sql(`insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())`, [a.id, b.id]),
  sql(`insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())`, [b.id, a.id]),
]

/** A finished read of hers, ended `back` days ago; answers the entry. */
async function finished(member: TestMember, title: string, back: number) {
  const endedOn = addDays(today, -back)
  const added = await createLibrary(member.client).addToLibrary(book(title), {
    status: 'finished',
    startedOn: addDays(endedOn, -3),
    endedOn,
  })
  expect(added.error).toBeNull()
  return added.data!
}

describe('a member’s whole finished history, a page at a time', () => {
  it('walks past the twelve her profile carries, in her profile’s order and without a repeat', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await connected(ada, ben)
    // Fifteen finished reads, the first the newest, so her profile stops at twelve and three live only behind the pages.
    const entries = []
    for (let i = 1; i <= 15; i++) entries.push(await finished(ada, `Read ${i}`, i))
    const newestFirst = entries.map((entry) => entry.book.title)

    // Her profile: the newest twelve, and a count of all fifteen.
    const profile = (await social(ben).profile(ada.id)).data!
    expect(profile.visible).toBe(true)
    if (!profile.visible) throw new Error('unreachable')
    expect(profile.finished.map((row) => row.book.title)).toEqual(newestFirst.slice(0, 12))
    expect(profile.counts.read).toBe(15)

    // Her shelf's read: all fifteen, page by page.
    const first = (await social(ben).memberFinished(ada.id)).data!
    expect(first).not.toBeNull()
    expect(first!.total).toBe(15)
    const titles = [...first!.items.map((row) => row.book.title)]
    let cursor = first!.next
    let pages = 1
    while (cursor) {
      const page = (await social(ben).memberFinished(ada.id, cursor)).data!
      expect(page).not.toBeNull()
      titles.push(...page!.items.map((row) => row.book.title))
      cursor = page!.next
      pages++
      expect(pages).toBeLessThan(10)
    }
    expect(titles).toEqual(newestFirst)
    expect(new Set(titles).size).toBe(15)
    // Every row carries what her profile's rows carry: the Book, the day it ended, her Rating and review.
    expect(first!.items[0]).toMatchObject({
      book: expect.objectContaining({ id: entries[0]!.book.id, title: entries[0]!.book.title }),
      endedOn: addDays(today, -1),
      sessionId: expect.any(String),
      likes: 0,
      liked: false,
    })
  })

  it('pages by a page smaller than her history, and stops at the end', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await connected(ada, ben)
    for (let i = 1; i <= 5; i++) await finished(ada, `Small ${i}`, i)
    const first = (await social(ben).memberFinished(ada.id, null, 2)).data!
    expect(first!.items).toHaveLength(2)
    expect(first!.total).toBe(5)
    const second = (await social(ben).memberFinished(ada.id, first!.next, 2)).data!
    expect(second!.items).toHaveLength(2)
    const third = (await social(ben).memberFinished(ada.id, second!.next)).data!
    expect(third!.items).toHaveLength(1)
    expect(third!.next).toBeNull()
    expect([...first!.items, ...second!.items, ...third!.items].map((row) => row.book.title)).toEqual([
      runTitle('Small 1'),
      runTitle('Small 2'),
      runTitle('Small 3'),
      runTitle('Small 4'),
      runTitle('Small 5'),
    ])
  })

  it('holds her page size, and clamps what a caller asks for', async () => {
    // The repository sends at most `SHELF_PAGE`; the database clamps to 150 whatever arrives.
    const ada = await signUpMember()
    const ben = await signUpMember()
    await connected(ada, ben)
    for (let i = 1; i <= 3; i++) await finished(ada, `Clamped ${i}`, i)
    expect(SHELF_PAGE).toBe(100)
    expect((await social(ben).memberFinished(ada.id, null, 100)).data!.items).toHaveLength(3)
    // The database's own ceiling, asked past it: the same rows, never a refusal. (Her own history is not a
    // profile she may ask for — `private.reachable` wants two members — so Ben asks, as the shelf page does.)
    const many = await ben.client.rpc('member_finished', { p_member: ada.id, p_after: null, p_limit: 5000 })
    expect(many.error).toBeNull()
    expect((many.data as { items: unknown[] }).items).toHaveLength(3)
  })

  it('leaves a hidden Book out, and answers nothing with her Finished switch off', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await connected(ada, ben)
    await finished(ada, 'Shown', 1)
    const hidden = await finished(ada, 'Hidden', 2)

    const library = createLibrary(ada.client)
    expect((await library.setHidden(hidden.id, true)).error).toBeNull()

    const withHidden = (await social(ben).memberFinished(ada.id)).data!
    expect(withHidden!.total).toBe(1)
    expect(withHidden!.items.map((row) => row.book.title)).toEqual([runTitle('Shown')])

    // Her *Finished* switch off: the read does not happen at all (null), so the shelf page keeps its quiet state.
    expect((await social(ada).setSections({ finished: false })).error).toBeNull()
    expect((await social(ben).memberFinished(ada.id)).data).toBeNull()
    // And with no page of it either.
    expect((await social(ben).memberFinished(ada.id, null, 5)).data).toBeNull()
  })

  it('is refused to a stranger, and offline before anything is sent', async () => {
    const ada = await signUpMember()
    const stranger = await signUpMember()
    await finished(ada, 'Mine', 1)
    // Private by default, and nobody asked: no profile, so no history either.
    expect((await social(stranger).profile(ada.id)).data).toBeNull()
    expect((await social(stranger).memberFinished(ada.id)).data).toBeNull()

    const offline = createSocial(stranger.client, { online: () => false })
    expect(await offline.memberFinished(ada.id)).toEqual({ data: null, error: 'offline' })
  })
})

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createSocial, followLink } from '@/data/social'
import { isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Following (social v1, W1), through the repository against the social stack, with real members: her
 * settings, a follow link and what it shows, asking, answering, a public account, her people, blocking,
 * the database's refusals as codes, and offline. The rules themselves are the database's
 * (supabase/tests/social_*_test.sql).
 */

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

async function twoMembers() {
  const ada = await signUpMember()
  const ben = await signUpMember()
  return {
    ada,
    ben,
    adaSocial: createSocial(ada.client, { online: () => true }),
    benSocial: createSocial(ben.client, { online: () => true }),
  }
}

const ALL_ON = { reading: true, want: true, finished: true, ratings: true, reviews: true, abandoned: true, year: true }

describe('her social settings', () => {
  it('start private with every section on and a 22-character link, which followLink turns into an address', async () => {
    const { adaSocial } = await twoMembers()
    const mine = (await adaSocial.mine()).data!
    expect(mine).toEqual({ private: true, sections: ALL_ON, link: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), requests: 0 })
    expect(followLink('https://libellus.app', mine.link)).toBe(`https://libellus.app/f/${mine.link}`)
    expect((await adaSocial.mine()).data!.link).toBe(mine.link)
  })

  it('switch private and sections, and a renewed link replaces the old one', async () => {
    const { adaSocial, benSocial } = await twoMembers()
    const first = (await adaSocial.mine()).data!

    const sections = (await adaSocial.setSections({ reviews: false, year: false })).data!
    expect(sections.sections).toEqual({ ...ALL_ON, reviews: false, year: false })
    expect(sections.private).toBe(true)

    expect((await adaSocial.setPrivate(false)).data!.private).toBe(false)
    expect((await adaSocial.mine()).data!.sections.reviews).toBe(false)

    const renewed = (await adaSocial.renewLink()).data!
    expect(renewed.link).not.toBe(first.link)
    expect((await benSocial.target(first.link)).data).toBeNull()
    expect((await benSocial.target(renewed.link)).data).not.toBeNull()

    expect((await adaSocial.setSections({ nope: true } as never)).error).toBe('social_sections_invalid')
  })
})

describe('following', () => {
  it('goes from her link to a request, her answer, and her profile with the finished Book', async () => {
    const { ada, ben, adaSocial, benSocial } = await twoMembers()
    const finished = (
      await createLibrary(ada.client).addToLibrary(book('Finished Well'), { status: 'finished', startedOn: isoDay(), endedOn: isoDay(), rating: 18 })
    ).data!
    const link = (await adaSocial.mine()).data!.link

    const target = (await benSocial.target(link)).data!
    expect(target.state).toBe('none')
    expect(target.private).toBe(true)
    expect(target.member.id).toBe(ada.id)
    expect(JSON.stringify(target)).not.toContain(ada.email)

    expect((await benSocial.follow(ada.id)).data).toBe('requested')
    expect((await benSocial.target(link)).data!.state).toBe('requested')
    expect((await benSocial.people()).data!.requested.map((c) => c.id)).toEqual([ada.id])
    expect((await benSocial.profile(ada.id)).data).toMatchObject({ visible: false, state: 'requested' })
    expect((await adaSocial.mine()).data!.requests).toBe(1)

    const people = (await adaSocial.people()).data!
    expect(people.requests).toHaveLength(1)
    expect(people.requests[0]).toMatchObject({ id: ben.id, askedAt: expect.any(String) })
    expect(Number.isNaN(Date.parse(people.requests[0].askedAt))).toBe(false)

    expect((await adaSocial.answer(ben.id, true)).error).toBeNull()
    expect((await adaSocial.people()).data!.requests).toEqual([])
    expect((await adaSocial.people()).data!.followers).toEqual([expect.objectContaining({ id: ben.id, followsBack: false })])
    expect((await benSocial.people()).data!.following.map((c) => c.id)).toEqual([ada.id])

    const profile = (await benSocial.profile(ada.id)).data!
    expect(profile.visible).toBe(true)
    if (!profile.visible) throw new Error('unreachable')
    expect(profile.state).toBe('following')
    expect(profile.sections).toEqual(ALL_ON)
    expect(profile.counts.read).toBe(1)
    expect(profile.finished).toHaveLength(1)
    expect(profile.finished[0]).toMatchObject({ rating: 18, review: null })
    expect(profile.finished[0].book).toMatchObject({
      id: finished.book.id,
      title: finished.book.title,
      authors: ['Ursula K. Le Guin'],
      year: 1969,
      manual: false,
    })
  })

  it('follows a public member at once, and withdraws, unfollows and removes', async () => {
    const { ada, ben, adaSocial, benSocial } = await twoMembers()
    await adaSocial.setPrivate(false)
    expect((await benSocial.follow(ada.id)).data).toBe('following')
    expect((await benSocial.profile(ada.id)).data).toMatchObject({ visible: true, state: 'following', private: false })
    expect((await adaSocial.people()).data!.followers.map((c) => c.id)).toEqual([ben.id])

    expect((await adaSocial.removeFollower(ben.id)).error).toBeNull()
    expect((await adaSocial.people()).data!.followers).toEqual([])

    expect((await benSocial.follow(ada.id)).data).toBe('following')
    expect((await benSocial.unfollow(ada.id)).error).toBeNull()
    expect((await benSocial.people()).data!.following).toEqual([])

    await adaSocial.setPrivate(true)
    expect((await benSocial.follow(ada.id)).error).toBe('not_found')
    expect((await benSocial.target((await adaSocial.mine()).data!.link)).data).not.toBeNull()
    expect((await benSocial.follow(ada.id)).data).toBe('requested')
    expect((await benSocial.withdraw(ada.id)).error).toBeNull()
    expect((await adaSocial.people()).data!.requests).toEqual([])
  })

  it("lists her whole Want to read for a follower, and a stranger's profile is null", async () => {
    const { ada, adaSocial, benSocial } = await twoMembers()
    const library = createLibrary(ada.client)
    const first = (await library.addToLibrary(book('Wanted First'))).data!
    const second = (await library.addToLibrary(book('Wanted Second'))).data!
    await adaSocial.setPrivate(false)
    await benSocial.follow(ada.id)

    const want = (await benSocial.want(ada.id)).data!
    expect(want.map((w) => w.book.id).sort()).toEqual([first.book.id, second.book.id].sort())
    expect(want[0].addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await adaSocial.setSections({ want: false })
    expect((await benSocial.want(ada.id)).data).toBeNull()

    const stranger = createSocial((await signUpMember()).client, { online: () => true })
    await adaSocial.setPrivate(true)
    expect((await stranger.profile(ada.id)).data).toBeNull()
    expect((await stranger.want(ada.id)).data).toBeNull()
  })
})

describe('blocking', () => {
  it('lists the blocked member, and her link answers null for him', async () => {
    const { ada, ben, adaSocial, benSocial } = await twoMembers()
    const link = (await adaSocial.mine()).data!.link
    expect((await benSocial.target(link)).data).not.toBeNull()
    expect((await benSocial.follow(ada.id)).data).toBe('requested')

    expect((await adaSocial.block(ben.id)).error).toBeNull()
    expect((await adaSocial.blocked()).data!.map((c) => c.id)).toEqual([ben.id])
    expect((await benSocial.target(link)).data).toBeNull()
    expect((await benSocial.follow(ada.id)).error).toBe('not_found')
    expect((await adaSocial.people()).data!.requests).toEqual([])
    expect((await benSocial.people()).data!.requested).toEqual([])

    expect((await adaSocial.unblock(ben.id)).error).toBeNull()
    expect((await adaSocial.blocked()).data).toEqual([])
    expect((await benSocial.target(link)).data).not.toBeNull()
  })
})

describe('refusals', () => {
  it('map to their codes: follow_self, and not_found for an unknown id or an id that is no id', async () => {
    const { ada, adaSocial } = await twoMembers()
    expect((await adaSocial.follow(ada.id)).error).toBe('follow_self')
    expect((await adaSocial.block(ada.id)).error).toBe('follow_self')
    expect((await adaSocial.follow(randomUUID())).error).toBe('not_found')
    expect((await adaSocial.answer(randomUUID(), true)).error).toBe('not_found')
    expect((await adaSocial.follow('not-a-uuid')).error).toBe('not_found')
    expect((await adaSocial.target('short')).data).toBeNull()
  })
})

describe('offline', () => {
  it('refuses a write and a read with offline, and nothing reaches the database', async () => {
    const { ada } = await twoMembers()
    const rpc = vi.spyOn(ada.client, 'rpc')
    const from = vi.spyOn(ada.client, 'from')
    const social = createSocial(ada.client, { online: () => false })

    expect(await social.follow(randomUUID())).toEqual({ data: null, error: 'offline' })
    expect(await social.setPrivate(false)).toEqual({ data: null, error: 'offline' })
    expect(await social.people()).toEqual({ data: null, error: 'offline' })
    expect(await social.profile(randomUUID())).toEqual({ data: null, error: 'offline' })
    expect(await social.target('x'.repeat(22))).toEqual({ data: null, error: 'offline' })
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()

    expect((await createSocial(ada.client, { online: () => true }).mine()).error).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('reads a call that got no answer (status 0) as offline, not unknown; a refusal stays its code', async () => {
    const noAnswer = { rpc: async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }) }
    const social = createSocial(noAnswer as never, { online: () => true })
    expect(await social.follow(randomUUID())).toEqual({ data: null, error: 'offline' })
    expect(await social.setPrivate(false)).toEqual({ data: null, error: 'offline' })
    expect(await social.people()).toEqual({ data: null, error: 'offline' })

    const refused = { rpc: async () => ({ data: null, error: { message: 'follow_self', code: 'P0001' }, status: 400 }) }
    expect(await createSocial(refused as never, { online: () => true }).follow(randomUUID())).toEqual({ data: null, error: 'follow_self' })
  })
})

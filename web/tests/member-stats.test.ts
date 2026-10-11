import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createMemberStats } from '@/data/memberStats'
import { createStats, figuresOf } from '@/data/stats'
import { isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * A member's figures (social v1, W3) through the repository against the social stack: a follower
 * gets the very rows her own Profile reads, so `figuresOf` gives the same numbers; a stranger, or
 * a follower once she switched `year` off, gets null; offline is refused before anything is sent.
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
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

const today = isoDay()
const year = Number(today.slice(0, 4))

/** Ada, with two finished Books (one rated, one last year), one put down and one still to read. */
async function ada(): Promise<TestMember> {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const added = async (title: string, options: Parameters<typeof library.addToLibrary>[1]) => {
    const result = await library.addToLibrary(book(title), options)
    expect(result.error).toBeNull()
    return result.data!
  }
  await added('Rated And Read', { status: 'finished', startedOn: today, endedOn: today, rating: 18, review: 'Good.' })
  await added('Read Long Ago', { status: 'finished', endedOn: `${year - 1}-06-01` })
  const dropped = await added('Put Down', { status: 'reading', startedOn: today })
  expect((await library.abandon(dropped.id, { endedOn: today, reason: 'Not for me' })).error).toBeNull()
  await added('Still To Read', { status: 'want_to_read' })
  return member
}

/** Ben opens Ada's link, asks to follow, and she accepts (her account is private by default). */
async function follows(owner: TestMember): Promise<TestMember> {
  const ben = await signUpMember()
  const mine = await owner.client.rpc('my_social')
  expect(mine.error).toBeNull()
  const opened = await ben.client.rpc('follow_target', { p_token: mine.data.link })
  expect(opened.error).toBeNull()
  const asked = await ben.client.rpc('follow', { p_member: owner.id })
  expect(asked.error).toBeNull()
  expect(asked.data).toEqual({ state: 'requested' })
  const answered = await owner.client.rpc('answer_request', { p_member: ben.id, p_accept: true })
  expect(answered.error).toBeNull()
  return ben
}

describe("a member's figures", () => {
  it('give a follower the same figures as her own Profile', async () => {
    const owner = await ada()
    const ben = await follows(owner)

    const seen = await createMemberStats(ben.client, { online: () => true }).record(owner.id)
    expect(seen.error).toBeNull()
    const record = seen.data!
    const own = (await createStats(owner.client).record(today)).data!

    expect(figuresOf(record.reads, year)).toEqual(figuresOf(own.reads, year))
    expect(figuresOf(record.reads, 'all')).toEqual(figuresOf(own.reads, 'all'))
    // Not empty figures: one finished read this year (the abandoned one is no Book), two in all, one rated.
    expect(figuresOf(record.reads, year).books).toBe(1)
    expect(figuresOf(record.reads, 'all').books).toBe(2)
    expect(figuresOf(record.reads, year).rated).toBe(1)
    expect(record.reads.map((read) => read.sessionId)).toEqual(own.reads.map((read) => read.sessionId))
    expect(record.wantToRead).toBe(own.wantToRead)
    expect(record.reading).toBe(own.reading)
    expect(record.wantToRead).toBe(1)
    expect(record.reading).toBe(0)
  })

  it('are null for a stranger, and for a follower once she switches the year off', async () => {
    const owner = await ada()
    const ben = await follows(owner)
    const stranger = await signUpMember()

    expect(await createMemberStats(stranger.client).record(owner.id)).toEqual({ data: null, error: null })

    const off = await owner.client.rpc('set_social_sections', { p_sections: { year: false } })
    expect(off.error).toBeNull()
    expect(await createMemberStats(ben.client).record(owner.id)).toEqual({ data: null, error: null })
  })

  it('are refused offline, before anything is sent', async () => {
    const owner = await ada()
    const ben = await follows(owner)
    expect(await createMemberStats(ben.client, { online: () => false }).record(owner.id)).toEqual({ data: null, error: 'offline' })
  })

  it('answer not_found for an id that is no id', async () => {
    const ben = await signUpMember()
    expect(await createMemberStats(ben.client).record('nobody')).toEqual({ data: null, error: 'not_found' })
  })
})

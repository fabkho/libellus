import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createFeed } from '@/data/feed'
import {
  addWithArguments,
  addWithFromDraft,
  createLibrary,
  newAddDraft,
  sessionEditArguments,
  sessionEditOf,
  sessionFromRow,
  spoilerArguments,
  type LibraryEntry,
  type ReadingSession,
  type SessionRow,
} from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage } from '@/data/outbox'
import { applyWrite, editedSession, type QueuedWrite, type WriteQueue } from '@/data/queuedWrites'
import { CIRCLE_BOOKS_MAX, createSocial } from '@/data/social'
import {
  bothReadFromJson,
  circleBookFromJson,
  likeFieldsFromJson,
  recentLikeFromJson,
  reviewFlagsFromJson,
} from '@/data/socialShapes'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Social version 2a, data layer (docs/proposals/social-v2a-contract.md §2): the review's spoiler flag
 * (arguments, the device's copy of a queued write, the outbox), the new fields on feed entries and a
 * member's finished rows, likes, "You both read" and the circle's same Book, through the repository: the
 * mapping with a stand-in client, the real answers against the social stack with real members, and
 * offline. Who may see what is the database's (supabase/tests/social_v2a_test.sql).
 */

const today = isoDay()

function book(title: string, workKey: string | null = null): BookSnapshot {
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
    openLibraryWorkKey: workKey ? `${workKey}${runTitle('')}`.replace(/\W/g, '') : null,
  }
}

const social = (member: TestMember) => createSocial(member.client, { online: () => true })
const library = (member: TestMember) => createLibrary(member.client)
const follow = (follower: TestMember, followee: TestMember) =>
  sql(`insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())`, [follower.id, followee.id])

/** A finished read; the entry. */
async function finished(member: TestMember, snapshot: BookSnapshot, extra: { rating?: number; review?: string; reviewSpoilers?: boolean; endedOn?: string } = {}) {
  const added = await library(member).addToLibrary(snapshot, { status: 'finished', startedOn: today, endedOn: today, ...extra })
  expect(added.error).toBeNull()
  return added.data!
}


describe('the spoiler flag in the arguments', () => {
  it('goes only with a review that has words, and only when set, so an old call is unchanged', () => {
    expect(spoilerArguments('The twist', true)).toEqual({ p_review_spoilers: true })
    expect(spoilerArguments('The twist', false)).toEqual({})
    expect(spoilerArguments('The twist', undefined)).toEqual({})
    expect(spoilerArguments('   ', true)).toEqual({})
    expect(spoilerArguments(null, true)).toEqual({})
    expect(spoilerArguments('', true)).toEqual({})
  })

  it('rides with the review of an add, from a draft too', () => {
    expect(addWithArguments({ status: 'finished', endedOn: today, review: 'Wow', reviewSpoilers: true })).toMatchObject({
      p_review: 'Wow',
      p_review_spoilers: true,
    })
    expect(addWithArguments({ status: 'finished', endedOn: today, review: 'Wow' })).not.toHaveProperty('p_review_spoilers')
    expect(addWithArguments({ status: 'want_to_read' })).toEqual({
      p_status: 'want_to_read',
      p_started_on: null,
      p_ended_on: null,
      p_rating: null,
      p_review: null,
    })
    const draft = newAddDraft()
    expect(draft.reviewSpoilers).toBe(false)
    Object.assign(draft, { status: 'finished', endedOn: today, review: 'Wow', reviewSpoilers: true })
    expect(addWithFromDraft(draft)).toMatchObject({ review: 'Wow', reviewSpoilers: true })
    expect(addWithFromDraft({ ...draft, status: 'reading', startedOn: today })).toEqual({ status: 'reading', startedOn: today })
  })

  it("rides with an edit of a finished read, and never with another outcome's", () => {
    const row: SessionRow = {
      id: 's1',
      entry_id: 'e1',
      started_on: addDays(today, -3),
      ended_on: today,
      outcome: 'finished',
      rating: 12,
      review: 'Twist',
      review_spoilers: true,
      abandon_reason: null,
      progress_page: null,
      progress_percent: null,
      progress_updated_at: null,
      created_at: today,
    }
    const read = sessionFromRow(row)
    expect(read.reviewSpoilers).toBe(true)
    const edit = sessionEditOf(read)
    expect(edit).toMatchObject({ review: 'Twist', reviewSpoilers: true })
    expect(sessionEditArguments(read, edit)).toMatchObject({ p_review: 'Twist', p_review_spoilers: true })
    expect(sessionEditArguments(read, { ...edit, reviewSpoilers: false })).not.toHaveProperty('p_review_spoilers')
    expect(sessionEditArguments(read, { ...edit, review: '' })).not.toHaveProperty('p_review_spoilers')
    const abandoned: ReadingSession = { ...read, outcome: 'abandoned', review: null, abandonReason: 'dull' }
    expect(sessionEditArguments(abandoned, { ...sessionEditOf(abandoned), reviewSpoilers: true })).not.toHaveProperty('p_review_spoilers')
  })

  it('reads as false from a row that has none (a Library cached before 2a)', () => {
    const { review_spoilers: _gone, ...old } = {
      id: 's1',
      entry_id: 'e1',
      started_on: null,
      ended_on: null,
      outcome: null,
      rating: null,
      review: null,
      review_spoilers: true,
      abandon_reason: null,
      progress_page: null,
      progress_percent: null,
      progress_updated_at: null,
      created_at: today,
    } satisfies SessionRow
    expect(sessionFromRow(old).reviewSpoilers).toBe(false)
  })
})

describe("the device's copy of a queued write", () => {
  const entry = (latestSession: ReadingSession | null, status: LibraryEntry['status']): LibraryEntry => ({
    id: 'e1',
    status,
    addedAt: today,
    book: { id: 'b1' } as LibraryEntry['book'],
    pageCountOverride: null,
    readAs: null,
    hidden: false,
    latestSession,
  })
  const open = (): ReadingSession => ({
    id: 's1',
    startedOn: addDays(today, -2),
    endedOn: null,
    outcome: null,
    rating: null,
    review: null,
    reviewSpoilers: false,
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: today,
  })
  const write = (action: QueuedWrite['action'], args: Record<string, unknown>): QueuedWrite =>
    ({ id: 'w1', action, args, entryId: 'e1', queuedAt: new Date().toISOString() }) as QueuedWrite

  it('shows a finished read with its flag, and without one for a blank review', () => {
    const flagged = applyWrite(entry(open(), 'reading'), write('finish_reading', { p_ended_on: today, p_review: ' Twist ', p_review_spoilers: true })) as LibraryEntry
    expect(flagged.latestSession).toMatchObject({ outcome: 'finished', review: 'Twist', reviewSpoilers: true })
    const plain = applyWrite(entry(open(), 'reading'), write('finish_reading', { p_ended_on: today, p_review: 'Twist' })) as LibraryEntry
    expect(plain.latestSession?.reviewSpoilers).toBe(false)
    const blank = applyWrite(entry(open(), 'reading'), write('finish_reading', { p_ended_on: today, p_review: '  ', p_review_spoilers: true })) as LibraryEntry
    expect(blank.latestSession).toMatchObject({ review: null, reviewSpoilers: false })
  })

  it('shows an add and an edit with their flags', () => {
    const added = applyWrite(
      null,
      {
        ...write('add_to_library', { p_status: 'finished', p_ended_on: today, p_review: 'Twist', p_review_spoilers: true }),
        book: { id: 'b1' } as never,
        creates: { entry_id: 'e1' },
      } as QueuedWrite,
    ) as LibraryEntry
    expect(added.latestSession).toMatchObject({ review: 'Twist', reviewSpoilers: true })

    const closed: ReadingSession = { ...open(), outcome: 'finished', endedOn: today, review: 'Twist', reviewSpoilers: true }
    expect(editedSession(closed, { p_started_on: closed.startedOn, p_ended_on: today, p_review: 'Twist' }).reviewSpoilers).toBe(false)
    expect(editedSession(closed, { p_started_on: closed.startedOn, p_ended_on: today, p_review: 'Twist', p_review_spoilers: true }).reviewSpoilers).toBe(true)
    const abandoned: ReadingSession = { ...closed, outcome: 'abandoned', review: null, reviewSpoilers: false }
    expect(editedSession(abandoned, { p_started_on: closed.startedOn, p_ended_on: today, p_review_spoilers: true }).reviewSpoilers).toBe(false)
  })
})

describe('the answers read into shapes', () => {
  it('fills what an older answer leaves out', () => {
    expect(reviewFlagsFromJson({})).toEqual({ spoilers: false, folded: false })
    expect(reviewFlagsFromJson({ spoilers: true, folded: null })).toEqual({ spoilers: true, folded: false })
    expect(likeFieldsFromJson({})).toEqual({ sessionId: null, likes: 0, liked: false })
    expect(likeFieldsFromJson({ sessionId: 's', likes: 3, liked: true })).toEqual({ sessionId: 's', likes: 3, liked: true })
  })

  const BOOK = { id: 'b', title: 'T', authors: null, published_year: null, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, manual: false }
  const CARD = { id: 'm', name: null, photo: null }

  it('reads a recent like, a shared Book and a circle row', () => {
    expect(recentLikeFromJson({ session: 's', book: BOOK, likers: [CARD], count: 4, at: '2026-10-20T10:00:00Z' })).toEqual({
      session: 's',
      book: { id: 'b', title: 'T', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false },
      likers: [{ id: 'm', name: null, photo: null }],
      count: 4,
      at: '2026-10-20T10:00:00Z',
    })
    expect(bothReadFromJson({ book: BOOK, mine: { rating: 12, endedOn: '2026-01-02' }, hers: { rating: null, endedOn: null } })).toMatchObject({
      mine: { rating: 12, endedOn: '2026-01-02' },
      hers: { rating: null, endedOn: null },
    })
    expect(circleBookFromJson({ book: 'b', members: [CARD, CARD], more: 2 })).toEqual({ book: 'b', members: [CARD, CARD], more: 2 })
  })
})

describe('the calls, with a stand-in client', () => {
  const CARD = { id: 'm', name: 'Mo', photo: null }
  function stub(answer: { data?: unknown; error?: { message?: string; code?: string } | null; status?: number }) {
    const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 }))
    return { rpc, social: createSocial({ rpc } as never, { online: () => true }) }
  }

  it('likes, unlikes and lists the likers through their functions', async () => {
    const liked = stub({ data: { likes: 2, liked: true } })
    expect(await liked.social.like('s1')).toEqual({ data: { likes: 2, liked: true }, error: null })
    expect(liked.rpc).toHaveBeenCalledWith('like', { p_session: 's1' })
    const unliked = stub({ data: { likes: 1, liked: false } })
    expect(await unliked.social.unlike('s1')).toEqual({ data: { likes: 1, liked: false }, error: null })
    expect(unliked.rpc).toHaveBeenCalledWith('unlike', { p_session: 's1' })
    const likers = stub({ data: [CARD] })
    expect((await likers.social.sessionLikers('s1')).data).toEqual([CARD])
    expect(likers.rpc).toHaveBeenCalledWith('session_likers', { p_session: 's1' })
    const recent = stub({ data: [] })
    expect(await recent.social.myRecentLikes()).toEqual({ data: [], error: null })
    expect(recent.rpc).toHaveBeenCalledWith('my_recent_likes', {})
  })

  it('maps the refusals to codes', async () => {
    expect((await stub({ error: { message: 'not_found', code: 'PT404' } }).social.like('s')).error).toBe('not_found')
    expect((await stub({ error: { message: 'rate_limited', code: 'PT429' } }).social.like('s')).error).toBe('rate_limited')
    expect((await stub({ error: { message: 'not_signed_in', code: '42501' } }).social.sessionLikers('s')).error).toBe('not_signed_in')
    expect((await stub({ error: { message: 'invalid input syntax for type uuid', code: '22P02' } }).social.like('nope')).error).toBe('not_found')
    expect((await stub({ error: { message: 'boom', code: 'XX000' } }).social.bothRead('m')).error).toBe('unknown')
  })

  it('asks for both_read with her year or none', async () => {
    const call = stub({ data: [] })
    await call.social.bothRead('m')
    expect(call.rpc).toHaveBeenLastCalledWith('both_read', { p_member: 'm', p_year: null })
    await call.social.bothRead('m', 2026)
    expect(call.rpc).toHaveBeenLastCalledWith('both_read', { p_member: 'm', p_year: 2026 })
  })

  it('asks the circle about each Book once, at most 50, and asks nothing for none', async () => {
    const call = stub({ data: [{ book: 'b1', members: [CARD], more: 0 }] })
    expect((await call.social.circleReading(['b1', 'b1'])).data).toEqual([{ book: 'b1', members: [CARD], more: 0 }])
    expect(call.rpc).toHaveBeenLastCalledWith('circle_reading', { p_books: ['b1'] })
    const many = Array.from({ length: 60 }, (_, i) => `b${i}`)
    await call.social.circleWant(many)
    expect(call.rpc).toHaveBeenLastCalledWith('circle_want', { p_books: many.slice(0, CIRCLE_BOOKS_MAX) })
    expect(CIRCLE_BOOKS_MAX).toBe(50)
    call.rpc.mockClear()
    expect(await call.social.circleReading([])).toEqual({ data: [], error: null })
    expect(await call.social.circleWant([])).toEqual({ data: [], error: null })
    expect(call.rpc).not.toHaveBeenCalled()
  })

  it('refuses every call offline before sending anything, and reads a silent connection as offline', async () => {
    const rpc = vi.fn()
    const offline = createSocial({ rpc } as never, { online: () => false })
    for (const result of [
      await offline.like('s'),
      await offline.unlike('s'),
      await offline.sessionLikers('s'),
      await offline.myRecentLikes(),
      await offline.bothRead('m'),
      await offline.circleReading(['b']),
      await offline.circleWant(['b']),
    ]) {
      expect(result).toEqual({ data: null, error: 'offline' })
    }
    expect(rpc).not.toHaveBeenCalled()
    expect((await stub({ error: { message: 'Failed to fetch' }, status: 0 }).social.like('s')).error).toBe('offline')
  })
})

describe('against the social stack', () => {
  beforeAll(async () => {
    await sql(`update private.social_config set settle_window = '0'`)
  })
  afterAll(async () => {
    await sql(`update private.social_config set settle_window = '10 minutes'`)
  })

  async function sessionId(member: TestMember, entry: LibraryEntry): Promise<string> {
    const read = (await library(member).sessions(entry.id)).data!.find((s) => s.outcome === 'finished')
    return read!.id
  }

  it("carries a flagged review to a follower folded, with the read's id and likes, and unfolded once she has finished it", async () => {
    const ida = await signUpMember()
    const ben = await signUpMember()
    const cy = await signUpMember()
    await follow(ben, ida)
    await follow(cy, ida)
    const piranesi = await finished(ida, book('Piranesi', 'OLV2APIR'), { rating: 18, review: 'The twist is the house.', reviewSpoilers: true })
    const circe = await finished(ida, book('Circe', 'OLV2ACIR'), { rating: 16, review: 'Lovely.' })
    await finished(cy, book('Piranesi (Cy)', 'OLV2APIR'))

    const read = (await library(ida).sessions(piranesi.id)).data![0]!
    expect(read.reviewSpoilers).toBe(true)
    expect((await library(ida).sessions(circe.id)).data![0]!.reviewSpoilers).toBe(false)

    const entryOf = async (member: TestMember, id: string) => (await createFeed(member.client, { online: () => true }).page()).data!.find((e) => e.book.id === id)!
    const forBen = await entryOf(ben, piranesi.book.id)
    expect(forBen).toMatchObject({ spoilers: true, folded: true, review: 'The twist is the house.', sessionId: read.id, likes: 0, liked: false })
    expect(await entryOf(ben, circe.book.id)).toMatchObject({ spoilers: false, folded: false, review: 'Lovely.' })
    expect(await entryOf(cy, piranesi.book.id)).toMatchObject({ spoilers: true, folded: false })

    // A member's finished rows say the same.
    const profile = (await social(ben).profile(ida.id)).data!
    if (!profile.visible) throw new Error('Ida should be visible to her follower')
    expect(profile.finished.find((f) => f.book.id === piranesi.book.id)).toMatchObject({
      spoilers: true,
      folded: true,
      sessionId: read.id,
      likes: 0,
      liked: false,
    })
    const cyProfile = (await social(cy).profile(ida.id)).data!
    if (!cyProfile.visible) throw new Error('visible')
    expect(cyProfile.finished.find((f) => f.book.id === piranesi.book.id)).toMatchObject({ spoilers: true, folded: false })
  })

  it('likes, counts, lists the likers to the author only, and takes it back', async () => {
    const ida = await signUpMember()
    const ben = await signUpMember()
    const cy = await signUpMember()
    const sam = await signUpMember()
    await follow(ben, ida)
    await follow(cy, ida)
    const entry = await finished(ida, book('Likeable'), { rating: 14, review: 'Good.' })
    const session = await sessionId(ida, entry)

    expect(await social(ben).like(session)).toEqual({ data: { likes: 1, liked: true }, error: null })
    expect(await social(ben).like(session)).toEqual({ data: { likes: 1, liked: true }, error: null })
    await sql(`update public.likes set created_at = now() - interval '1 hour' where member_id = $1`, [ben.id])
    expect(await social(cy).like(session)).toEqual({ data: { likes: 2, liked: true }, error: null })

    const feedEntry = (await createFeed(ben.client, { online: () => true }).page()).data!.find((e) => e.book.id === entry.book.id)!
    expect(feedEntry).toMatchObject({ sessionId: session, likes: 2, liked: true })

    expect((await social(sam).like(session)).error).toBe('not_found')
    expect((await social(ida).like(session)).error).toBe('not_found')
    expect((await social(ben).like('00000000-0000-4000-8000-000000000000')).error).toBe('not_found')
    expect((await social(ben).like('not-a-uuid')).error).toBe('not_found')

    const likers = (await social(ida).sessionLikers(session)).data!
    expect(likers.map((l) => l.id)).toEqual([cy.id, ben.id])
    expect(likers[0]).toEqual({ id: cy.id, name: null, photo: null })
    expect((await social(ben).sessionLikers(session)).error).toBe('not_found')

    const recent = (await social(ida).myRecentLikes()).data!
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({ session, count: 2, book: { id: entry.book.id } })
    expect(recent[0]!.likers.map((l) => l.id)).toEqual([cy.id, ben.id])
    expect(recent[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(await social(ben).unlike(session)).toEqual({ data: { likes: 1, liked: false }, error: null })
    expect(await social(ben).unlike(session)).toEqual({ data: { likes: 1, liked: false }, error: null })

    // Unfollowing takes the like of the one who left.
    await social(cy).unfollow(ida.id)
    expect((await social(ida).sessionLikers(session)).data).toEqual([])
    expect((await social(cy).like(session)).error).toBe('not_found')
  })

  it("lists the Books she and a member both finished, by work, and a year's", async () => {
    const ida = await signUpMember()
    const ben = await signUpMember()
    const sam = await signUpMember()
    await follow(ben, ida)
    await finished(ida, book('Shared', 'OLV2ASHARED'), { rating: 16 })
    const alone = await finished(ida, book('Hers Alone'), { rating: 8 })
    const bensEdition = book('Shared (Ben)', 'OLV2ASHARED')
    await finished(ben, bensEdition, { rating: 12 })

    const both = (await social(ben).bothRead(ida.id)).data!
    expect(both).toHaveLength(1)
    expect(both[0]).toMatchObject({
      book: { title: runTitle('Shared') },
      mine: { rating: 12, endedOn: today },
      hers: { rating: 16, endedOn: today },
    })
    expect(both[0]!.book.id).not.toBe(alone.book.id)
    expect((await social(ben).bothRead(ida.id, Number(today.slice(0, 4)))).data).toHaveLength(1)
    expect((await social(ben).bothRead(ida.id, 1999)).data).toEqual([])
    expect((await social(sam).bothRead(ida.id)).data).toEqual([])
    expect((await social(ben).bothRead(ben.id)).data).toEqual([])
  })

  it('names who she follows reading or wanting the same Book, found by work key', async () => {
    const ben = await signUpMember()
    const readers = [await signUpMember(), await signUpMember(), await signUpMember(), await signUpMember()]
    const outsider = await signUpMember()
    for (const reader of readers) await follow(ben, reader)

    const mine = await library(ben).addToLibrary(book('Dune (Ben)', 'OLV2ADUNE'), { status: 'reading', startedOn: today })
    const wanted = await library(ben).addToLibrary(book('Emma (Ben)', 'OLV2AEMMA'), { status: 'want_to_read' })
    for (const reader of readers) await library(reader).addToLibrary(book('Dune', 'OLV2ADUNE'), { status: 'reading', startedOn: today })
    for (const reader of readers.slice(0, 2)) await library(reader).addToLibrary(book('Emma', 'OLV2AEMMA'), { status: 'want_to_read' })
    await library(outsider).addToLibrary(book('Dune (outsider)', 'OLV2ADUNE'), { status: 'reading', startedOn: today })

    const reading = (await social(ben).circleReading([mine.data!.book.id, wanted.data!.book.id])).data!
    expect(reading).toHaveLength(1)
    expect(reading[0]!.book).toBe(mine.data!.book.id)
    expect(reading[0]!.members).toHaveLength(3)
    expect(reading[0]!.more).toBe(1)
    expect(reading[0]!.members.every((m) => readers.some((r) => r.id === m.id))).toBe(true)

    const want = (await social(ben).circleWant([mine.data!.book.id, wanted.data!.book.id])).data!
    expect(want).toHaveLength(1)
    expect(want[0]!.book).toBe(wanted.data!.book.id)
    expect(want[0]!.members.map((m) => m.id).sort()).toEqual(readers.slice(0, 2).map((r) => r.id).sort())
    expect(want[0]!.more).toBe(0)

    expect((await social(outsider).circleReading([mine.data!.book.id])).data).toEqual([])
  })

  it('refuses a like without a connection', async () => {
    const ben = await signUpMember()
    expect(await createSocial(ben.client, { online: () => false }).like('s')).toEqual({ data: null, error: 'offline' })
  })
})

describe('the review flag in the outbox', () => {
  function device(member: TestMember) {
    const copy = new Map<string, LibraryEntry>()
    const state = { offline: false }
    const outbox = createOutbox({ memberId: member.id, storage: memoryOutboxStorage(), send: createSender(member.client) })
    const queue: WriteQueue = {
      open: () => true,
      holds: () => state.offline || outbox.items().length > 0,
      entry: (id) => copy.get(id) ?? null,
      entryForBook: (bookId) => [...copy.values()].find((entry) => entry.book.id === bookId) ?? null,
      collection: () => null,
      add: (write) => outbox.add(write),
    }
    const repo = createLibrary(member.client, { online: () => !state.offline, queue })
    const keep = <T extends { data: LibraryEntry | null }>(result: T): T => {
      if (result.data) copy.set(result.data.id, result.data)
      return result
    }
    return { state, outbox, repo, keep }
  }

  it('waits with the review, shows on the device, and reaches the database when it syncs', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const added = phone.keep(await phone.repo.addToLibrary(book('Queued Finish'), { status: 'reading', startedOn: addDays(today, -2) }))
    const entryId = added.data!.id

    phone.state.offline = true
    const finished = phone.keep(await phone.repo.finish(entryId, { endedOn: today, rating: 16, review: 'The twist.', reviewSpoilers: true }))
    expect(finished.data?.latestSession).toMatchObject({ review: 'The twist.', reviewSpoilers: true })
    expect(phone.outbox.items().map((item) => item.args)).toEqual([
      expect.objectContaining({ p_review: 'The twist.', p_review_spoilers: true }),
    ])

    phone.state.offline = false
    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    const synced = (await createLibrary(member.client).sessions(entryId)).data!
    expect(synced[0]).toMatchObject({ outcome: 'finished', review: 'The twist.', reviewSpoilers: true })

    // An edit queued offline carries it too, and one without the flag clears it (the whole state).
    phone.state.offline = true
    const edit = sessionEditOf(synced[0]!)
    phone.keep(await phone.repo.updateSession(entryId, synced[0]!, { ...edit, reviewSpoilers: false }))
    expect(phone.outbox.items().map((item) => item.action)).toEqual(['update_session'])
    expect(phone.outbox.items()[0]!.args).not.toHaveProperty('p_review_spoilers')
    phone.state.offline = false
    await phone.outbox.flush()
    expect((await createLibrary(member.client).sessions(entryId)).data![0]!.reviewSpoilers).toBe(false)
  })

  it('goes with an online finish and an online edit too, and an old call writes none', async () => {
    const member = await signUpMember()
    const repo = createLibrary(member.client)
    const added = (await repo.addToLibrary(book('Online Finish'), { status: 'reading', startedOn: addDays(today, -2) })).data!
    await repo.finish(added.id, { endedOn: today, review: 'Plot.', reviewSpoilers: true })
    const [read] = (await repo.sessions(added.id)).data!
    expect(read!.reviewSpoilers).toBe(true)
    await repo.updateSession(added.id, read!, { ...sessionEditOf(read!), review: 'Plot, revised.' })
    expect((await repo.sessions(added.id)).data![0]).toMatchObject({ review: 'Plot, revised.', reviewSpoilers: true })
    await repo.updateSession(added.id, read!, { ...sessionEditOf(read!), review: 'Plot, revised.', reviewSpoilers: false })
    expect((await repo.sessions(added.id)).data![0]).toMatchObject({ review: 'Plot, revised.', reviewSpoilers: false })
    const manual = (await repo.addToLibrary(book('Old Call'), { status: 'finished', endedOn: today, review: 'Fine.' })).data!
    expect((await repo.sessions(manual.id)).data![0]!.reviewSpoilers).toBe(false)
  })
})

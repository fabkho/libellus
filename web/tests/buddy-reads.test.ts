import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createLibrary } from '@/data/library'
import { createBuddyReads, mapBuddyError, BUDDY_ERROR_CODES, MESSAGES_PAGE } from '@/data/buddyReads'
import { buddyOf, catalogueEdition, follows, joinRead, sectionsOf, shelve, startRead } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'

/**
 * The buddy read repository through real RPCs on the local stack (data/buddyReads.ts; the functions are supabase/migrations/20261113*, their
 * rules are pgTAP's, supabase/tests/buddy_*_test.sql). What this keeps: every call answers the shape the screens read, each refusal
 * becomes its code, the layer's types are what comes out (a Section is a chapter, a message a ChatRecord), and a member who is not in a
 * read learns nothing of it. Fixtures carry the run's tag (tests/support/buddy.ts).
 */

let ben: TestMember
let cy: TestMember
let outsider: TestMember

beforeAll(async () => {
  ;[ben, cy, outsider] = await Promise.all([signUpMember(), signUpMember(), signUpMember()])
})

/** A host of her own per test (a member is in at most 10 active reads), who follows Ben and Cy and not the outsider. */
async function host(): Promise<TestMember> {
  const member = await signUpMember()
  await follows(member, ben)
  await follows(member, cy)
  return member
}

describe('a refusal is a code', () => {
  it('maps the database’s messages, an id that is no id and a retry the database asks for', () => {
    expect(mapBuddyError({ message: 'not_host', code: 'PT403' })).toBe('not_host')
    expect(mapBuddyError({ message: 'message_rate_limited', code: 'PT429' })).toBe('message_rate_limited')
    expect(mapBuddyError({ message: 'invalid input syntax for type uuid', code: '22P02' })).toBe('not_found')
    expect(mapBuddyError({ message: 'deadlock detected', code: '40P01' })).toBe('busy')
    expect(mapBuddyError({ message: 'something nobody explained' })).toBe('unknown')
    expect(BUDDY_ERROR_CODES.every((code) => mapBuddyError({ message: code }) === code)).toBe(true)
  })

  it('is offline before anything is sent, and when the request got no answer', async () => {
    const rpc = vi.fn()
    expect(await createBuddyReads({ rpc } as never, { online: () => false }).mine()).toEqual({ data: null, error: 'offline' })
    expect(rpc).not.toHaveBeenCalled()
    const silent = { rpc: async () => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) }
    expect(await createBuddyReads(silent as never).read('r')).toEqual({ data: null, error: 'offline' })
    const thrown = { rpc: async () => Promise.reject(new Error('cancelled')) }
    expect(await createBuddyReads(thrown as never).read('r')).toEqual({ data: null, error: 'offline' })
  })
})

describe('starting a read', () => {
  it('creates it, answers the same read to the same call, and refuses a second for the same Book with the first one’s id', async () => {
    const ada = await host()
    const entry = await shelve(ada, 'Created')
    const repo = buddyOf(ada)
    const clientId = crypto.randomUUID()
    const made = await repo.create({ bookId: entry.book.id, clientId, sections: sectionsOf(4), link: true, invite: [ben.id, outsider.id] })
    expect(made.error).toBeNull()
    expect(made.data!.linkToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    // Ben is followed, the outsider is not: skipped, not refused.
    expect(made.data!.invited).toEqual([ben.id])
    expect(made.data!.skipped).toEqual([outsider.id])

    const again = await repo.create({ bookId: entry.book.id, clientId, sections: sectionsOf(4) })
    expect(again.data!.id).toBe(made.data!.id)

    const second = await repo.create({ bookId: entry.book.id, clientId: crypto.randomUUID(), sections: sectionsOf(2) })
    expect(second).toEqual({ data: null, error: 'buddy_read_exists', existing: made.data!.id })
  })

  it('refuses a Book that is not hers, Sections that do not add up and a start day out of range', async () => {
    const ada = await host()
    const repo = buddyOf(ada)
    const notHers = await repo.create({ bookId: (await shelve(ben, 'Bens')).book.id, clientId: crypto.randomUUID(), sections: sectionsOf(2) })
    expect(notHers.error).toBe('buddy_book_invalid')
    const entry = await shelve(ada, 'Odd sections')
    expect((await repo.create({ bookId: entry.book.id, clientId: crypto.randomUUID(), sections: [{ kind: 'end', label: 'Only the end', toFraction: 1 }] })).error).toBe('buddy_sections_invalid')
    expect((await repo.create({ bookId: entry.book.id, clientId: crypto.randomUUID(), sections: sectionsOf(2), startsOn: '2001-01-01' })).error).toBe('buddy_starts_invalid')
  })
})

describe('one read, as its screen draws it', () => {
  it('is the layer’s BuddyReadData: Sections are chapters, the end is last, the host has the link and the invited', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Screen', parts: 3, invite: [ben.id] })
    const read = (await buddyOf(ada).read(made.id)).data!
    expect(read).toMatchObject({ id: made.id, conversationId: made.id, status: 'active', canManage: true, role: 'host', linkToken: made.linkToken, chaptersFrom: 'count', sourceId: null })
    expect(read.book.title).toContain('Screen')
    expect(read.book.author).toBe('A. Reader')
    expect(read.chapters.map((c) => [c.position, c.kind, c.title])).toEqual([
      [1, 'chapter', 'Part 1'],
      [2, 'chapter', 'Part 2'],
      [3, 'chapter', 'Part 3'],
      [4, 'end', 'The whole book'],
    ])
    expect(read.chapters.every((c) => c.count === 0 && c.unread === 0 && c.pages === null)).toBe(true)
    expect(read.room).toEqual({ count: 0, unread: 0 })
    expect(read.members.map((m) => [m.id, m.role])).toEqual([[ada.id, 'host']])
    expect(read.invited.map((m) => m.id)).toEqual([ben.id])
    // She has no copy linked, nothing set: not started, and the others see "not set".
    expect(read.me).toMatchObject({ entryId: made.entry.id, readThrough: 0 })
    expect(read.readThrough).toBe(0)
  })

  it('is not the host’s link or invited list for a member, and nothing at all for a stranger or an invitee', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Members only', invite: [ben.id] })
    // Ben is invited, not joined: one answer with a stranger.
    expect((await buddyOf(ben).read(made.id)).error).toBe('not_found')
    expect((await buddyOf(outsider).read(made.id)).error).toBe('not_found')
    expect((await buddyOf(outsider).read(crypto.randomUUID())).error).toBe('not_found')
    expect((await buddyOf(outsider).read('not-a-uuid')).error).toBe('not_found')
    await joinRead(cy, made.linkToken!)
    const seen = (await buddyOf(cy).read(made.id)).data!
    expect(seen).toMatchObject({ role: 'member', canManage: false, linkToken: null })
    expect(seen.invited).toEqual([])
    expect(seen.members.map((m) => m.id).sort()).toEqual([ada.id, cy.id].sort())
  })
})

describe('invitations, the link and joining', () => {
  it('lists an invitation for the invitee, who accepts and is in; declining removes it', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Invited', invite: [ben.id, cy.id] })
    const bens = (await buddyOf(ben).mine()).data!
    expect(bens.invitations.find((i) => i.id === made.id)).toMatchObject({ memberCount: 1, sections: 3, host: { id: ada.id }, invitedBy: { id: ada.id } })
    expect(bens.reads.find((r) => r.id === made.id)).toBeUndefined()

    expect((await buddyOf(ben).answer(made.id, true)).error).toBeNull()
    const after = (await buddyOf(ben).mine()).data!
    expect(after.invitations.find((i) => i.id === made.id)).toBeUndefined()
    expect(after.reads.find((r) => r.id === made.id)).toMatchObject({ role: 'member', memberCount: 2, where: { kind: 'not_set' }, unread: 0, status: 'active' })

    expect((await buddyOf(cy).answer(made.id, false)).error).toBeNull()
    expect((await buddyOf(cy).mine()).data!.invitations.find((i) => i.id === made.id)).toBeUndefined()
    // Answering what is not there: a stranger's answer.
    expect((await buddyOf(cy).answer(made.id, true)).error).toBe('not_found')
  })

  it('turns the link off and on, renews it, and a card answers null for a link that does not work', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Link' })
    const card = (await buddyOf(outsider).target(made.linkToken!)).data!
    expect(card).toMatchObject({ id: made.id, memberCount: 1, sections: 3, state: 'none', host: { id: ada.id } })
    expect(card.members.map((m) => m.id)).toEqual([ada.id])

    const renewed = (await buddyOf(ada).link(made.id, true, true)).data!
    expect(renewed).not.toBe(made.linkToken)
    expect((await buddyOf(outsider).target(made.linkToken!)).data).toBeNull()
    expect((await buddyOf(outsider).join(made.linkToken!)).error).toBe('not_found')

    expect((await buddyOf(ada).link(made.id, false)).data).toBeNull()
    expect((await buddyOf(outsider).target(renewed)).data).toBeNull()
    expect((await buddyOf(ben).link(made.id, true)).error).toBe('not_found')
    expect((await buddyOf(ada).link(made.id, true)).data).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('joins by the link, again without harm; only the host invites, and a member who is not the host is refused', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Join' })
    expect((await buddyOf(ben).join(made.linkToken!)).data).toBe(made.id)
    expect((await buddyOf(ben).join(made.linkToken!)).data).toBe(made.id)
    expect((await buddyOf(ben).target(made.linkToken!)).data!.state).toBe('member')
    expect((await buddyOf(ben).invite(made.id, [cy.id])).error).toBe('not_host')
    expect((await buddyOf(ada).invite(made.id, [cy.id])).data).toEqual({ invited: [cy.id], skipped: [] })
  })
})

describe('talking', () => {
  it('posts to the room and a Section, answers the same row to the same client id, and pages oldest first', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Talk', parts: 2 })
    await joinRead(ben, made.linkToken!)
    const read = (await buddyOf(ada).read(made.id)).data!
    const section = read.chapters[0]!.id
    const repo = buddyOf(ada)

    const clientId = crypto.randomUUID()
    const first = await repo.post({ readId: made.id, sectionId: null, clientId, body: 'Before we start' })
    expect(first.data).toMatchObject({ conversationId: made.id, threadId: null, senderId: ada.id, clientId, kind: 'text', body: 'Before we start', spoiler: false, media: null, replyTo: null, deletedAt: null, reactions: [] })
    expect((await repo.post({ readId: made.id, sectionId: null, clientId, body: 'Before we start' })).data!.id).toBe(first.data!.id)
    // The same client id for another thread is a mix-up, not a retry.
    expect((await repo.post({ readId: made.id, sectionId: section, clientId, body: 'Elsewhere' })).error).toBe('message_client_id_reused')

    const reply = await repo.post({ readId: made.id, sectionId: section, clientId: crypto.randomUUID(), body: 'Chapter one!' })
    expect(reply.data).toMatchObject({ threadId: section, spoiler: false })
    const answer = await buddyOf(ben).post({ readId: made.id, sectionId: section, clientId: crypto.randomUUID(), body: 'I agree', replyTo: reply.data!.id })
    expect(answer.data!.replyTo).toBe(reply.data!.id)

    const roomPage = (await buddyOf(ben).messages(made.id, null)).data!
    expect(roomPage.items.map((m) => m.body)).toEqual(['Before we start'])
    expect(roomPage.more).toBe(false)
    const sectionPage = (await buddyOf(ben).messages(made.id, section)).data!
    expect(sectionPage.items.map((m) => m.body)).toEqual(['Chapter one!', 'I agree'])

    // Older and newer, by the server's own times.
    expect((await buddyOf(ben).messages(made.id, section, { before: sectionPage.items[1]!.createdAt })).data!.items.map((m) => m.body)).toEqual(['Chapter one!'])
    expect((await buddyOf(ben).messages(made.id, section, { after: sectionPage.items[0]!.createdAt })).data!.items.map((m) => m.body)).toEqual(['I agree'])
    const small = (await buddyOf(ben).messages(made.id, section, { limit: 1 })).data!
    expect(small.items.map((m) => m.body)).toEqual(['I agree'])
    expect(small.more).toBe(true)
    expect(MESSAGES_PAGE).toBe(50)
  })

  it('refuses what the database refuses: nothing to read, a reply elsewhere, a stranger', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Refused', parts: 2 })
    const section = (await buddyOf(ada).read(made.id)).data!.chapters[0]!.id
    const repo = buddyOf(ada)
    const post = (over: Record<string, unknown>) => repo.post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Hello', ...over } as never)
    expect((await post({ body: '   ' })).error).toBe('message_body_invalid')
    const roomMessage = (await post({})).data!
    expect((await post({ sectionId: section, replyTo: roomMessage.id })).error).toBe('message_reply_unavailable')
    expect((await buddyOf(outsider).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Hi' })).error).toBe('not_found')
    expect((await buddyOf(outsider).messages(made.id, null)).error).toBe('not_found')
    expect((await repo.messages(made.id, crypto.randomUUID())).error).toBe('buddy_section_invalid')
  })

  it('reacts with one of six and takes it back, tombstones a message (hers, or any as host), and reports', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'React' })
    await joinRead(ben, made.linkToken!)
    const sent = (await buddyOf(ben).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'A thought' })).data!

    expect((await buddyOf(ada).react(sent.id, '🔥')).error).toBeNull()
    expect((await buddyOf(ben).react(sent.id, '🔥')).error).toBeNull()
    const seenByAda = (await buddyOf(ada).messages(made.id, null)).data!.items[0]!
    expect(seenByAda.reactions).toEqual([{ emoji: '🔥', count: 2, mine: true }])
    expect((await buddyOf(ada).react(sent.id, null)).error).toBeNull()
    expect((await buddyOf(ada).messages(made.id, null)).data!.items[0]!.reactions).toEqual([{ emoji: '🔥', count: 1, mine: false }])
    expect((await buddyOf(ada).react(sent.id, '🙂')).error).toBe('message_emoji_invalid')

    // Not her own, so a report goes; her own is refused.
    expect((await buddyOf(ada).report(sent.id, 'spam', 'Looks like it')).error).toBeNull()
    expect((await buddyOf(ben).report(sent.id, 'spam')).error).toBe('report_self')
    expect((await buddyOf(ada).report(sent.id, 'nonsense' as never)).error).toBe('report_reason_invalid')

    // Cy is in, not the host, and not the author.
    await joinRead(cy, made.linkToken!)
    expect((await buddyOf(cy).deleteMessage(sent.id)).error).toBe('message_not_yours')
    expect((await buddyOf(ada).deleteMessage(sent.id)).error).toBeNull()
    const gone = (await buddyOf(cy).messages(made.id, null)).data!.items[0]!
    expect(gone).toMatchObject({ id: sent.id, kind: 'text', body: '', media: null, reactions: [] })
    expect(gone.deletedAt).toBeTruthy()
    expect((await buddyOf(cy).react(sent.id, '❤️')).error).toBe('message_unavailable')
  })

  it('counts what is new to her per thread, until her cursor moves', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Unread', parts: 2 })
    await joinRead(ben, made.linkToken!)
    const section = (await buddyOf(ada).read(made.id)).data!.chapters[1]!.id
    const post = (sectionId: string | null, body: string) => buddyOf(ben).post({ readId: made.id, sectionId, clientId: crypto.randomUUID(), body })
    await post(null, 'one')
    const last = (await post(section, 'two')).data!
    await post(section, 'three')

    let read = (await buddyOf(ada).read(made.id)).data!
    expect(read.room).toEqual({ count: 1, unread: 1 })
    expect(read.chapters[1]).toMatchObject({ count: 2, unread: 2 })
    expect((await buddyOf(ada).mine()).data!.reads.find((r) => r.id === made.id)!.unread).toBeGreaterThan(0)
    // Her own messages are never new to her.
    expect((await buddyOf(ben).read(made.id)).data!.chapters[1]).toMatchObject({ count: 2, unread: 0 })

    expect((await buddyOf(ada).mark(made.id, section, last.createdAt)).error).toBeNull()
    expect((await buddyOf(ada).mark(made.id, null, null)).error).toBeNull()
    read = (await buddyOf(ada).read(made.id)).data!
    expect(read.room.unread).toBe(0)
    expect(read.chapters[1]).toMatchObject({ count: 2, unread: 1 })
    expect((await buddyOf(ada).mark(made.id, crypto.randomUUID(), null)).error).toBe('buddy_section_invalid')
  })
})

describe('her Section and the others’ markers', () => {
  it('moves with her hand, shows to the others as a Section only, and goes back to automatic', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Where', parts: 4 })
    await joinRead(ben, made.linkToken!)

    // Nothing linked, nothing set.
    expect((await buddyOf(ada).read(made.id)).data!.members.find((m) => m.id === ben.id)!.where).toEqual({ kind: 'not_set' })

    const hand = await buddyOf(ben).setHand(made.id, 2)
    expect(hand.data).toMatchObject({ hand: 2, readThrough: 2, where: { kind: 'section', section: 3 } })
    const bySelf = (await buddyOf(ben).read(made.id)).data!
    expect(bySelf.readThrough).toBe(2)
    const byHost = (await buddyOf(ada).read(made.id)).data!
    expect(byHost.members.find((m) => m.id === ben.id)!.where).toEqual({ kind: 'section', section: 3 })
    // Reading Section 3 is "read through 2": the layer's marker.
    expect(byHost.marks.find((m) => m.memberId === ben.id)).toEqual({ memberId: ben.id, readThrough: 2 })
    // Nothing the other sees says how: no hand, no auto, no page.
    expect(JSON.stringify(byHost.members)).not.toMatch(/hand|auto|entry/)

    expect((await buddyOf(ben).setHand(made.id, 4)).data!.where).toEqual({ kind: 'end' })
    expect((await buddyOf(ada).read(made.id)).data!.marks.find((m) => m.memberId === ben.id)!.readThrough).toBe(4)
    expect((await buddyOf(ben).setHand(made.id, 9)).error).toBe('buddy_position_invalid')
    expect((await buddyOf(ben).setHand(made.id, null)).data).toMatchObject({ hand: null, where: { kind: 'not_set' } })
  })

  it('links one of her entries of the same Book (null unlinks) and refuses another Book’s', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Entry' })
    await joinRead(ben, made.linkToken!)
    const own = await createLibrary(ben.client).addToLibrary({ ...catalogueEdition('Other book') }, { status: 'want_to_read' })
    expect((await buddyOf(ben).linkEntry(made.id, own.data!.id)).error).toBe('buddy_entry_invalid')
    expect((await buddyOf(ben).linkEntry(made.id, null)).data!.entryId).toBeNull()
  })
})

describe('the host’s and the member’s ways out', () => {
  it('replaces the division while no Section has a message, and renaming stays free after', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Division', parts: 2 })
    const replaced = await buddyOf(ada).setSections(made.id, sectionsOf(5), 'count', null)
    expect(replaced.data!.chapters).toHaveLength(6)
    expect((await buddyOf(ada).setSections(made.id, [{ kind: 'part', label: 'Nope', toFraction: 0.5 }], 'count')).error).toBe('buddy_sections_invalid')

    const first = replaced.data!.chapters[0]!.id
    await buddyOf(ada).post({ readId: made.id, sectionId: first, clientId: crypto.randomUUID(), body: 'Now it is locked' })
    expect((await buddyOf(ada).setSections(made.id, sectionsOf(3))).error).toBe('buddy_sections_locked')
    const renamed = await buddyOf(ada).setSections(made.id, sectionsOf(5, 11))
    expect(renamed.error).toBeNull()
    expect(renamed.data!.chapters.map((c) => c.title).slice(0, 2)).toEqual(['Part 11', 'Part 12'])
    expect(renamed.data!.chapters[0]).toMatchObject({ id: first, count: 1 })
  })

  it('removes a member (not herself), a member leaves, the read ends and is archived', async () => {
    const ada = await host()
    const made = await startRead(ada, { title: 'Ways out' })
    await joinRead(ben, made.linkToken!)
    await joinRead(cy, made.linkToken!)
    expect((await buddyOf(ada).remove(made.id, ada.id)).error).toBe('buddy_remove_self')
    expect((await buddyOf(ben).remove(made.id, cy.id)).error).toBe('not_host')
    expect((await buddyOf(ada).remove(made.id, cy.id)).error).toBeNull()
    expect((await buddyOf(cy).read(made.id)).error).toBe('not_found')
    // Removed: her link answers as any bad link does.
    expect((await buddyOf(cy).join(made.linkToken!)).error).toBe('not_found')

    expect((await buddyOf(ben).leave(made.id, true)).error).toBeNull()
    expect((await buddyOf(ben).read(made.id)).error).toBe('not_found')

    expect((await buddyOf(ada).finish(made.id)).error).toBeNull()
    expect((await buddyOf(ada).read(made.id)).data!.status).toBe('finished')
    expect((await buddyOf(ada).link(made.id, true)).error).toBe('buddy_read_ended')
    // Finished threads stay writable; archived are read-only.
    expect((await buddyOf(ada).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Still here' })).error).toBeNull()
    expect((await buddyOf(ada).archive(made.id)).error).toBeNull()
    expect((await buddyOf(ada).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Too late' })).error).toBe('buddy_read_archived')
    expect((await buddyOf(ada).read(made.id)).data!.archivedAt).toBeTruthy()
  })
})

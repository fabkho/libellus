import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBuddyLive, parseBuddyEvent, type BuddyLive, type BuddyLiveEvent, type LiveRealtimeModule } from '@/data/buddyLive'
import { buddyOf, follows, joinRead, startRead } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'
import { stack } from './support/stack'

/**
 * The live channel of a buddy read (data/buddyLive.ts, the database's side: supabase/migrations/20261113040000_buddy_read_realtime.sql) over the REAL
 * Realtime client (`#realtime-client`, the one door the app has to it; the stub is not used here) against the local stack: a member's private
 * topic `member:<id>` delivers `message.new`, `message.reaction`, `message.deleted`, `buddy_read.changed` and `buddy.invitation`, parsed into
 * the events the store takes; the channel opens only when a screen retains it and closes, socket and all, when the last one lets go.
 */

const waitFor = async <T>(read: () => T | undefined | null | false, what: string, ms = 15_000): Promise<T> => {
  const until = Date.now() + ms
  for (;;) {
    const found = read()
    if (found) return found
    if (Date.now() > until) throw new Error(`Never heard: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const quietPage = { isOnline: () => true, listen: () => {} }

/** A member's live connection on the stack, and everything it heard. */
function liveOf(member: TestMember, load: () => Promise<LiveRealtimeModule> = () => import('#realtime-client') as unknown as Promise<LiveRealtimeModule>) {
  const heard: BuddyLiveEvent[] = []
  const live = createBuddyLive({
    url: stack.url,
    anonKey: stack.anonKey,
    token: async () => (await member.client.auth.getSession()).data.session?.access_token ?? null,
    load,
    env: quietPage,
    graceMs: 100,
  })
  for (const type of ['message', 'deleted', 'reaction', 'changed', 'invitation'] as const) live.on(type, (event) => void heard.push(event))
  return { live, heard }
}
const heardOf = <T extends BuddyLiveEvent['type']>(heard: BuddyLiveEvent[], type: T) => heard.filter((e): e is Extract<BuddyLiveEvent, { type: T }> => e.type === type)

const open: BuddyLive[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((live) => live.stop()))
})

let ada: TestMember
let ben: TestMember
let cy: TestMember
beforeAll(async () => {
  ;[ada, ben, cy] = await Promise.all([signUpMember(), signUpMember(), signUpMember()])
  await follows(ada, ben)
  await follows(ada, cy)
})

describe('the events, as the store takes them', () => {
  it('parses the five the database sends and drops what it does not know', () => {
    const read = '11111111-1111-4111-8111-111111111111'
    const message = parseBuddyEvent('message.new', {
      id: 'm1', buddy_read_id: read, section_id: null, author_id: 'a', client_id: 'c', kind: 'text', body: 'Hello', media_url: null, media_width: null, media_height: null, reply_to: null, spoiler: false, created_at: '2026-11-13T10:00:00.123456+00:00',
    })
    expect(message).toMatchObject({ type: 'message', message: { id: 'm1', conversationId: read, threadId: null, senderId: 'a', clientId: 'c', body: 'Hello', authorName: null, deletedAt: null, reactions: [] } })
    // A tombstone's id, and the broadcast's own `id` on the others, which says nothing about the read.
    expect(parseBuddyEvent('message.deleted', { id: 'm1', buddy_read_id: read, section_id: 's1' })).toEqual({ type: 'deleted', messageId: 'm1', readId: read, sectionId: 's1' })
    expect(parseBuddyEvent('message.reaction', { id: 'x', message_id: 'm1', buddy_read_id: read, member_id: 'b', emoji: '🔥' })).toEqual({ type: 'reaction', messageId: 'm1', readId: read, memberId: 'b', emoji: '🔥' })
    expect(parseBuddyEvent('message.reaction', { id: 'x', message_id: 'm1', buddy_read_id: read, member_id: 'b', emoji: null })).toMatchObject({ emoji: null })
    expect(parseBuddyEvent('buddy_read.changed', { id: 'broadcast-id', buddy_read_id: read })).toEqual({ type: 'changed', readId: read })
    expect(parseBuddyEvent('buddy.invitation', { id: 'broadcast-id', buddy_read_id: read })).toEqual({ type: 'invitation', readId: read })

    expect(parseBuddyEvent('something.else', { buddy_read_id: read })).toBeNull()
    expect(parseBuddyEvent('message.new', { id: 'm1' })).toBeNull()
    expect(parseBuddyEvent('buddy_read.changed', null)).toBeNull()
    expect(parseBuddyEvent('buddy_read.changed', 'nope')).toBeNull()
  })
})

describe('the real client, on the stack', () => {
  it('loads nothing until a screen retains the channel, and everything is closed when the last one lets go', async () => {
    const load = vi.fn(() => import('#realtime-client') as unknown as Promise<LiveRealtimeModule>)
    const { live } = liveOf(ada, load)
    open.push(live)
    expect(load).not.toHaveBeenCalled()
    expect(live.loaded).toBe(false)
    expect(live.status).toBe('idle')

    const first = live.retain(ada.id)
    const second = live.retain(ada.id)
    await waitFor(() => live.status === 'live', 'the channel live')
    expect(load).toHaveBeenCalledTimes(1)
    expect(live.loaded).toBe(true)
    expect(live.retained).toBe(2)

    first()
    await new Promise((resolve) => setTimeout(resolve, 300))
    // One screen still has it.
    expect(live.status).toBe('live')
    second()
    second()
    await waitFor(() => live.status === 'idle' && !live.loaded, 'the channel closed')
    expect(live.retained).toBe(0)
  })

  it('delivers message.new, message.reaction, message.deleted and buddy_read.changed to a member of the read', async () => {
    const made = await startRead(ada, { title: 'Live', parts: 2 })
    const { live, heard } = liveOf(ada)
    open.push(live)
    live.retain(ada.id)
    await waitFor(() => live.status === 'live', 'the channel live')

    // Ben joins: the read changed.
    await joinRead(ben, made.linkToken!)
    await waitFor(() => heardOf(heard, 'changed').find((e) => e.readId === made.id), 'buddy_read.changed after a join')

    const section = (await buddyOf(ada).read(made.id)).data!.chapters[0]!.id
    const clientId = crypto.randomUUID()
    const sent = (await buddyOf(ben).post({ readId: made.id, sectionId: section, clientId, body: 'Heard live', spoiler: true })).data!
    const arrived = await waitFor(() => heardOf(heard, 'message').find((e) => e.message.id === sent.id), 'message.new')
    expect(arrived.message).toMatchObject({ conversationId: made.id, threadId: section, senderId: ben.id, clientId, kind: 'text', body: 'Heard live', spoiler: true, replyTo: null, media: null })
    expect(arrived.message.createdAt).toBe(sent.createdAt)

    // His reaction, then hers taken back (null).
    expect((await buddyOf(ben).react(sent.id, '📚')).error).toBeNull()
    const reacted = await waitFor(() => heardOf(heard, 'reaction').find((e) => e.messageId === sent.id), 'message.reaction')
    expect(reacted).toMatchObject({ readId: made.id, memberId: ben.id, emoji: '📚' })
    expect((await buddyOf(ben).react(sent.id, null)).error).toBeNull()
    await waitFor(() => heardOf(heard, 'reaction').find((e) => e.messageId === sent.id && e.emoji === null), 'the reaction taken back')

    // Her Section moves: the others hear that the read changed (never where).
    const before = heardOf(heard, 'changed').length
    expect((await buddyOf(ben).setHand(made.id, 1)).error).toBeNull()
    await waitFor(() => heardOf(heard, 'changed').length > before, 'buddy_read.changed after a Section')
    expect(JSON.stringify(heard)).not.toMatch(/read_through|hand|auto/)

    // The host removes the message: a tombstone for everybody.
    expect((await buddyOf(ada).deleteMessage(sent.id)).error).toBeNull()
    const deleted = await waitFor(() => heardOf(heard, 'deleted').find((e) => e.messageId === sent.id), 'message.deleted')
    expect(deleted).toMatchObject({ readId: made.id, sectionId: section })
  })

  it('tells the invitee of an invitation on her own topic, and nobody else’s', async () => {
    const mine = liveOf(cy)
    const strangers = liveOf(ben)
    open.push(mine.live, strangers.live)
    mine.live.retain(cy.id)
    strangers.live.retain(ben.id)
    await waitFor(() => mine.live.status === 'live' && strangers.live.status === 'live', 'both live')

    const made = await startRead(ada, { title: 'Invitation', invite: [cy.id] })
    const heard = await waitFor(() => heardOf(mine.heard, 'invitation').find((e) => e.readId === made.id), 'buddy.invitation')
    expect(heard.type).toBe('invitation')
    expect(heardOf(strangers.heard, 'invitation').find((e) => e.readId === made.id)).toBeUndefined()
    expect(heardOf(strangers.heard, 'message')).toEqual([])
  })

  it('is refused for a member who joins another’s topic: nothing arrives and the status says so', async () => {
    const made = await startRead(ada, { title: 'Private topic' })
    await joinRead(ben, made.linkToken!)
    const { live, heard } = liveOf(ben)
    open.push(live)
    // Ben's connection, but the channel of Ada's topic: what the policy refuses.
    live.retain(ada.id)
    await waitFor(() => live.status === 'refused', 'the join refused')
    await buddyOf(ada).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Not for him' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(heard).toEqual([])
  })
})

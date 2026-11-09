import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { browserLiveEnv, createBuddyLive, createLazyRealtime, parseBuddyEvent, type BuddyLive, type BuddyLiveEvent, type LivePage, type LiveRealtimeModule } from '@/data/buddyLive'
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
      id: 'm1', buddy_read_id: read, section_id: null, author_id: 'a', client_id: 'c', kind: 'text', body: 'Hello', media_url: null, media_width: null, media_height: null, reply_to: null, created_at: '2026-11-13T10:00:00.123456+00:00',
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
    const sent = (await buddyOf(ben).post({ readId: made.id, sectionId: section, clientId, body: 'Heard live' })).data!
    const arrived = await waitFor(() => heardOf(heard, 'message').find((e) => e.message.id === sent.id), 'message.new')
    expect(arrived.message).toMatchObject({ conversationId: made.id, threadId: section, senderId: ben.id, clientId, kind: 'text', body: 'Heard live', spoiler: false, replyTo: null, media: null })
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

// ------------------------------------------------------------------ review: the door, the watchdog, the page

/** A Realtime client that joins whatever it is told to and says nothing else: `join()` lets the pending channels say SUBSCRIBED. */
function fakeRealtime() {
  const log = { clients: 0, channels: 0, removed: 0, disconnected: 0 }
  const joins: Array<(state: string) => void> = []
  class FakeClient {
    constructor() {
      log.clients++
    }
    async setAuth() {}
    channel() {
      log.channels++
      const channel = {
        on: () => channel,
        subscribe: (callback: (state: string) => void) => {
          joins.push(callback)
          return channel
        },
      }
      return channel
    }
    async removeChannel() {
      log.removed++
    }
    async disconnect() {
      log.disconnected++
    }
  }
  return { log, module: { RealtimeClient: FakeClient } as unknown as LiveRealtimeModule, join: () => joins.splice(0).forEach((callback) => callback('SUBSCRIBED')) }
}

describe('the lazy door', () => {
  const deps = (load: () => Promise<LiveRealtimeModule>) => ({ url: 'http://localhost:1', anonKey: 'anon', token: async () => 'token', load })

  it('recovers from a chunk that could not be fetched: the failure is not kept, the next start imports again', async () => {
    const real = fakeRealtime()
    const load = vi.fn<() => Promise<LiveRealtimeModule>>().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module')).mockResolvedValue(real.module)
    const lazy = createLazyRealtime(deps(load))
    // An offline start: it rejects (and says why) …
    await expect(lazy.realtime.setAuth()).rejects.toThrow('Failed to fetch')
    expect(lazy.loaded).toBe(false)
    // … and the next start, back online, works: the client is built and a channel can be had.
    await expect(lazy.realtime.setAuth()).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    expect(lazy.loaded).toBe(true)
    expect(real.log.clients).toBe(1)
    expect(() => lazy.realtime.channel('member:x', { config: { private: true } })).not.toThrow()
    await lazy.close()
    expect(real.log.disconnected).toBe(1)
    expect(lazy.loaded).toBe(false)
  })

  it('builds one client for the starts that come together, and a new one after it was closed', async () => {
    const real = fakeRealtime()
    const load = vi.fn(async () => real.module)
    const lazy = createLazyRealtime(deps(load))
    await Promise.all([lazy.realtime.setAuth(), lazy.realtime.setAuth()])
    expect(load).toHaveBeenCalledTimes(1)
    await lazy.close()
    await lazy.realtime.setAuth()
    expect(real.log.clients).toBe(2)
  })
})

describe('a channel that never comes live (the Free plan’s 200 connections say nothing)', () => {
  /** Timers that only run when the test says so. */
  function manualTimers() {
    const pending: Array<{ at: number; fn: () => void; id: number }> = []
    let now = 0
    let next = 0
    return {
      timers: {
        setTimeout: (fn: () => void, ms: number) => {
          pending.push({ at: now + ms, fn, id: ++next })
          return next
        },
        clearTimeout: (id: unknown) => {
          const at = pending.findIndex((p) => p.id === id)
          if (at >= 0) pending.splice(at, 1)
        },
      },
      advance: async (ms: number) => {
        now += ms
        for (const due of pending.filter((p) => p.at <= now).sort((a, b) => a.at - b.at)) {
          pending.splice(pending.indexOf(due), 1)
          due.fn()
        }
        for (let i = 0; i < 20; i++) await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      },
      count: () => pending.length,
    }
  }

  const made = (real: ReturnType<typeof fakeRealtime>, clock: ReturnType<typeof manualTimers>, stuck: boolean[]) =>
    createBuddyLive({ url: 'http://localhost:1', anonKey: 'anon', token: async () => 'token', load: async () => real.module, env: quietPage, graceMs: 100, stuckMs: 30_000, timers: clock.timers, onStuck: (s) => void stuck.push(s) })

  it('is called stuck after 30 s, joined again from the start, and quiet again the moment it is live', async () => {
    const real = fakeRealtime()
    const clock = manualTimers()
    const stuck: boolean[] = []
    const live = made(real, clock, stuck)
    live.retain('ada')
    await clock.advance(0)
    expect(live.status).toBe('connecting')
    expect(real.log.channels).toBe(1)
    await clock.advance(29_000)
    expect(stuck).toEqual([])
    await clock.advance(1_500)
    expect(stuck).toEqual([true])
    // The join was taken down and made again, the socket with it (a stuck revival would wait for ever).
    expect(real.log.channels).toBe(2)
    expect(real.log.disconnected).toBeGreaterThanOrEqual(1)
    await clock.advance(30_500)
    expect(real.log.channels).toBe(3)
    real.join()
    await clock.advance(0)
    expect(live.status).toBe('live')
    expect(stuck).toEqual([true, false])
    // Live: no more timers about it.
    await clock.advance(120_000)
    expect(real.log.channels).toBe(3)
    await live.dispose()
  })

  it('stops asking when the last screen has let go, and a failing load never throws out of retain or the chain', async () => {
    const real = fakeRealtime()
    const clock = manualTimers()
    const stuck: boolean[] = []
    const live = made(real, clock, stuck)
    const release = live.retain('ada')
    await clock.advance(0)
    release()
    await clock.advance(100)
    expect(live.status).toBe('idle')
    await clock.advance(120_000)
    expect(stuck).toEqual([])
    expect(real.log.channels).toBe(1)

    const broken = createBuddyLive({ url: 'http://localhost:1', anonKey: 'anon', token: async () => 'token', load: async () => Promise.reject(new Error('offline')), env: quietPage, graceMs: 10, stuckMs: 1_000, timers: clock.timers, onStuck: (s) => void stuck.push(s) })
    broken.retain('ada')
    await clock.advance(0)
    await clock.advance(1_500)
    await clock.advance(1_500)
    // Never live, said so once; nothing was thrown at anyone.
    expect(stuck).toEqual([true])
    await broken.dispose()
  })
})

describe('the page’s listeners', () => {
  it('are taken off again when the connection is disposed, and no event reaches a handler after', async () => {
    const listeners = new Map<string, Set<() => void>>()
    const target = (name: string) => ({
      addEventListener: (type: string, fn: () => void) => void (listeners.get(`${name}:${type}`) ?? listeners.set(`${name}:${type}`, new Set()).get(`${name}:${type}`)!).add(fn),
      removeEventListener: (type: string, fn: () => void) => void listeners.get(`${name}:${type}`)?.delete(fn),
    })
    const page: LivePage = { navigator: { onLine: true }, document: { visibilityState: 'visible', ...target('document') }, ...target('window') }
    const env = browserLiveEnv(page)
    const heard: string[] = []
    env.listen({ online: () => heard.push('online'), offline: () => heard.push('offline'), hidden: () => heard.push('hidden'), visible: () => heard.push('visible') })
    expect([...listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(3)
    env.dispose?.()
    expect([...listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(0)

    // Through a connection: dispose closes the channel and then the listeners.
    const real = fakeRealtime()
    const live = createBuddyLive({ url: 'http://localhost:1', anonKey: 'anon', token: async () => 'token', load: async () => real.module, env: browserLiveEnv(page), graceMs: 10 })
    live.retain('ada')
    await waitFor(() => real.log.channels === 1, 'a channel')
    expect([...listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(3)
    await live.dispose()
    expect([...listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(0)
    expect(live.status).toBe('idle')
  })
})

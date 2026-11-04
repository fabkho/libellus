import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive, readonly, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuddyLiveEvent } from '@/data/buddyLive'

/**
 * The buddy read store (stores/buddyRead.ts): sending, receiving, the merge of a bubble and its stored row by client id, the veil, unread,
 * the offline queue and its retry, refusals handed back, the live channel's lazy door. The store runs here as it does in Nuxt, with the
 * auto-imports it uses stood in for: a fake backend that is a small buddy read server (it answers like the database does, or fails
 * with no answer), the session, the device's storage and a stand-in for the live module. The database through the repository is
 * tests/buddy-reads.test.ts; the real Realtime client is tests/buddy-live.test.ts.
 */

const ME = 'ada'
const BEN = 'ben'
const READ = 'read-1'
const S1 = 'section-1'
const S2 = 'section-2'
const S3 = 'section-3'

const online = ref(true)
const session = reactive<{ member: { id: string } | null }>({ member: { id: ME } })

type Message = Record<string, unknown>
const server = {
  mode: 'answer' as 'answer' | 'silent',
  refuse: null as string | null,
  messages: [] as Message[],
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  clock: 0,
  readThrough: 1,
  /** Called while a post is being answered, for a test that wants an event to come in between. */
  during: null as null | (() => void),
  /** While set, a post waits for it: the database has not answered yet. */
  gate: null as null | Promise<void>,
  /** While set, a read of a read, of the list or of a thread waits for it. */
  readGate: null as null | Promise<void>,
}

const at = (n: number) => new Date(Date.UTC(2026, 10, 13, 10, 0, 0, n)).toISOString().replace('Z', '000+00:00')
const card = (id: string) => ({ id, name: id.toUpperCase(), photo: null })
const row = (over: Message): Message => ({
  id: `m${++server.clock}`, section_id: null, author: { id: BEN, name: 'BEN' }, client_id: crypto.randomUUID(), kind: 'text', body: 'Hello', media_url: null, media_width: null, media_height: null,
  reply_to: null, spoiler: false, created_at: at(server.clock), deleted_at: null, reactions: [], ...over,
})
const readJson = () => ({
  id: READ,
  book: { id: 'b1', title: 'The Book', authors: ['A. Writer'], published_year: 2001, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, manual: false },
  status: 'active', starts_on: '2026-11-13', finished_at: null, archived_at: null, sections_from: 'count', page_count: null, role: 'member', can_manage: false,
  room: { count: 1, unread: 2 },
  sections: [
    { id: S1, position: 1, kind: 'part', label: 'Part 1', start_page: null, end_page: null, count: 3, unread: 1 },
    { id: S2, position: 2, kind: 'part', label: 'Part 2', start_page: null, end_page: null, count: 2, unread: 4 },
    { id: S3, position: 3, kind: 'end', label: 'The whole book', start_page: null, end_page: null, count: 0, unread: 0 },
  ],
  members: [{ ...card(ME), role: 'member', where: { kind: 'section', section: server.readThrough + 1 } }, { ...card(BEN), role: 'host', where: { kind: 'section', section: 2 } }],
  me: { entry_id: null, auto: null, hand: server.readThrough, read_through: server.readThrough, where: { kind: 'section', section: server.readThrough + 1 } },
  link_token: null, invited: null,
})

const backend = {
  rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    server.calls.push({ fn, args })
    if (server.mode === 'silent') return { data: null, error: { message: 'Failed to fetch' }, status: 0 }
    const fail = (message: string) => ({ data: null, error: { message, code: '22023' }, status: 400 })
    switch (fn) {
      case 'post_buddy_message': {
        if (server.refuse) return fail(server.refuse)
        await server.gate
        const same = server.messages.find((m) => m.client_id === args.p_client_id)
        server.during?.()
        const made = same ?? row({ section_id: args.p_section, author: { id: ME, name: 'ADA' }, client_id: args.p_client_id, body: args.p_body, spoiler: args.p_spoiler, reply_to: args.p_reply_to })
        if (!same) server.messages.push(made)
        return { data: made, error: null, status: 200 }
      }
      case 'buddy_read_messages': {
        await server.readGate
        const rows = server.messages
          .filter((m) => m.section_id === (args.p_section ?? null))
          .filter((m) => !args.p_before || String(m.created_at) < String(args.p_before))
          .filter((m) => !args.p_after || String(m.created_at) > String(args.p_after))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, Number(args.p_limit))
        return { data: rows, error: null, status: 200 }
      }
      case 'buddy_read':
        await server.readGate
        return { data: readJson(), error: null, status: 200 }
      case 'my_buddy_reads':
        await server.readGate
        return { data: { reads: [], invitations: [] }, error: null, status: 200 }
      case 'set_buddy_hand':
      case 'link_buddy_entry': {
        server.readThrough = Number(args.p_through ?? server.readThrough)
        return { data: readJson().me, error: null, status: 200 }
      }
      case 'react_to_buddy_message':
        return server.refuse ? fail(server.refuse) : { data: null, error: null, status: 200 }
      default:
        return { data: null, error: null, status: 200 }
    }
  },
  auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
}

// The live module, stood in for: it records how it was made and lets a test play the server's events.
const live = {
  made: 0,
  fail: 0,
  deps: {} as Record<string, (...args: never[]) => unknown>,
  retained: [] as string[],
  stopped: 0,
  handlers: {} as Record<string, (event: never) => void>,
}
vi.mock('~/data/buddyLive', () => ({
  browserLiveEnv: () => ({ isOnline: () => true, listen: () => {} }),
  createBuddyLive: (deps: Record<string, (...args: never[]) => unknown>) => {
    // A module that fails to come (offline: the chunk is not precached): the store must not keep the failure.
    if (live.fail > 0) {
      live.fail--
      throw new Error('The chunk is not there')
    }
    live.deps = deps
    live.made++
    return {
      on: (type: string, fn: (event: never) => void) => ((live.handlers[type] = fn), () => delete live.handlers[type]),
      retain: (member: string) => (live.retained.push(member), () => {}),
      stop: async () => void live.stopped++,
      dispose: async () => void live.stopped++,
    }
  },
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

const emit = (event: BuddyLiveEvent) => live.handlers[event.type === 'message' ? 'message' : event.type]!(event as never)
const liveMessage = (over: Message = {}): BuddyLiveEvent => {
  const m = row(over)
  return {
    type: 'message',
    message: {
      id: m.id as string, conversationId: READ, threadId: (m.section_id as string | null) ?? null, senderId: (m.author as { id: string }).id, clientId: m.client_id as string, kind: 'text', body: m.body as string,
      createdAt: m.created_at as string, replyTo: null, spoiler: Boolean(m.spoiler), media: null, authorName: null, deletedAt: null, reactions: [],
    },
  }
}

// The device's storage, shared by the queue and the peeks.
const device = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => device.get(k) ?? null,
  setItem: (k: string, v: string) => void device.set(k, v),
  removeItem: (k: string) => void device.delete(k),
  key: (i: number) => [...device.keys()][i] ?? null,
  get length() {
    return device.size
  },
}

async function store() {
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabaseUrl: 'http://localhost:1', supabaseAnonKey: 'anon' } }))
  vi.stubGlobal('localStorage', localStorageStub)
  vi.stubGlobal('window', {})
  setActivePinia(createPinia())
  const { useBuddyReadStore } = await import('~/stores/buddyRead')
  return useBuddyReadStore()
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  server.mode = 'answer'
  server.refuse = null
  server.messages = []
  server.calls = []
  server.clock = 0
  server.readThrough = 1
  server.during = null
  server.gate = null
  server.readGate = null
  online.value = true
  session.member = { id: ME }
  live.made = 0
  live.fail = 0
  live.retained = []
  live.stopped = 0
  live.handlers = {}
  device.clear()
})
afterEach(() => vi.unstubAllGlobals())

/** Holds the database's answer to a post until `open()` is called. */
function hold() {
  let open!: () => void
  server.gate = new Promise<void>((resolve) => (open = resolve))
  return () => {
    server.gate = null
    open()
  }
}

const posts = () => server.calls.filter((c) => c.fn === 'post_buddy_message')

describe('sending', () => {
  it('shows a bubble at once, and the stored row replaces it by its client id: one message, hers, sent', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    const open = hold()
    const sent = await buddy.send(READ, S1, 'First thought', { spoiler: true })
    expect(sent.ok).toBe(true)
    // At once: before the database has answered.
    const [bubble] = buddy.messagesOf(READ, S1)
    expect(bubble).toMatchObject({ body: 'First thought', senderId: ME, state: 'sending', spoiler: true })
    open()
    await settle()
    const list = buddy.messagesOf(READ, S1)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ state: 'sent', error: null, body: 'First thought', clientId: (sent as { clientId: string }).clientId, id: 'm1', authorName: 'ADA' })
    expect(posts()).toHaveLength(1)
    expect(posts()[0]!.args).toMatchObject({ p_read: READ, p_section: S1, p_kind: 'text', p_body: 'First thought', p_spoiler: true })
    expect(buddy.waiting).toBe(0)
    // It counts in the thread, and her own message is never new to her (she was looking at it, too).
    expect(buddy.countsOf(READ, S1)).toMatchObject({ count: 4, unread: 0 })
  })

  it('keeps what she sent in the order she sent it, after the stored rows, and sends the room’s without a spoiler', async () => {
    const buddy = await store()
    await buddy.load(READ)
    server.messages.push(row({ body: 'Already there' }))
    await buddy.openThread(READ, null)
    const open = hold()
    await buddy.send(READ, null, 'one', { spoiler: true })
    await buddy.send(READ, null, 'two')
    expect(buddy.messagesOf(READ, null).map((m) => [m.body, m.state])).toEqual([['Already there', 'sent'], ['one', 'sending'], ['two', 'sending']])
    open()
    await settle()
    expect(buddy.messagesOf(READ, null).map((m) => [m.body, m.state])).toEqual([['Already there', 'sent'], ['one', 'sent'], ['two', 'sent']])
    expect(posts().map((c) => c.args.p_body)).toEqual(['one', 'two'])
    expect(posts()[0]!.args.p_spoiler).toBe(false)
  })

  it('merges the live echo of her own message with its bubble: never two', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    await buddy.retain()
    // The echo (the same row, her topic) lands while the post is still being answered.
    const open = hold()
    const sent = (await buddy.send(READ, S1, 'Echo')) as { ok: true; clientId: string }
    emit(liveMessage({ section_id: S1, author: { id: ME, name: null }, client_id: sent.clientId, body: 'Echo' }))
    expect(buddy.messagesOf(READ, S1)).toHaveLength(1)
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'sent', body: 'Echo' })
    open()
    await settle()
    const list = buddy.messagesOf(READ, S1)
    expect(list.filter((m) => m.clientId === sent.clientId)).toHaveLength(1)
    expect(list.at(-1)).toMatchObject({ state: 'sent', body: 'Echo' })
  })

  it('does not send a text with nothing to read, and says why before the database would', async () => {
    const buddy = await store()
    expect(await buddy.send(READ, null, '  \u200b ')).toEqual({ ok: false, error: 'message_body_invalid' })
    expect(await buddy.send(READ, null, 'x'.repeat(2001))).toEqual({ ok: false, error: 'message_body_invalid' })
    session.member = null
    expect(await buddy.send(READ, null, 'Hi')).toEqual({ ok: false, error: 'not_signed_in' })
    expect(posts()).toHaveLength(0)
  })
})

describe('the offline line and its retry', () => {
  it('keeps a message that got no answer in line, shows it as sending, and sends it when the connection answers', async () => {
    const buddy = await store()
    await buddy.load(READ)
    server.mode = 'silent'
    const sent = (await buddy.send(READ, S1, 'Into the tunnel')) as { ok: true; clientId: string }
    await settle()
    expect(buddy.waiting).toBe(1)
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'sending', error: null })
    // It is kept on the device, to survive a reload.
    expect([...device.entries()].some(([k, v]) => k.startsWith('libellus.buddyRead.queue.ada') && v.includes('Into the tunnel'))).toBe(true)

    server.mode = 'answer'
    buddy.kick()
    await settle()
    expect(buddy.waiting).toBe(0)
    expect(buddy.messagesOf(READ, S1)).toHaveLength(1)
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'sent', clientId: sent.clientId })
    // The same client id both times: the database made one row.
    expect(new Set(posts().map((c) => c.args.p_client_id)).size).toBe(1)
    expect(server.messages).toHaveLength(1)
    // Nothing left on the device.
    expect([...device.keys()].filter((k) => k.startsWith('libellus.buddyRead.queue'))).toEqual([])
  })

  it('picks the line up again after a reload: the bubble is back and goes out', async () => {
    const buddy = await store()
    server.mode = 'silent'
    await buddy.send(READ, S1, 'Before the reload')
    await settle()
    const kept = [...device.entries()].filter(([k]) => k.startsWith('libellus.buddyRead.queue'))
    expect(kept).toHaveLength(1)

    // The page closes (its lock goes, the line stays on the device) and a new one opens: a new store, the same device.
    await buddy.reset()
    vi.resetModules()
    server.mode = 'answer'
    const again = await store()
    await again.openThread(READ, S1)
    await settle()
    expect(again.messagesOf(READ, S1).map((m) => [m.body, m.state])).toEqual([['Before the reload', 'sent']])
    expect(server.messages).toHaveLength(1)
  })
})

describe('a refusal is handed back', () => {
  it('leaves the line, marks the bubble failed with the code, and a retry or a discard are hers to choose', async () => {
    const buddy = await store()
    await buddy.load(READ)
    server.refuse = 'buddy_read_archived'
    const sent = (await buddy.send(READ, S1, 'Too late')) as { ok: true; clientId: string }
    await settle()
    expect(buddy.waiting).toBe(0)
    expect(posts()).toHaveLength(1)
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'failed', error: 'buddy_read_archived', body: 'Too late' })

    // Archived is for good: there is no "Try again" for it, only Delete.
    server.refuse = null
    await buddy.retry(READ, S1, sent.clientId)
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'failed', error: 'buddy_read_archived' })
    buddy.discard(READ, S1, sent.clientId)
    expect(buddy.messagesOf(READ, S1)).toEqual([])
    expect(device.size).toBe(0)

    server.refuse = 'message_reply_unavailable'
    const second = (await buddy.send(READ, S1, 'Answer', { replyTo: 'gone' })) as { ok: true; clientId: string }
    await settle()
    expect(buddy.messagesOf(READ, S1).at(-1)).toMatchObject({ state: 'failed', error: 'message_reply_unavailable' })
    buddy.discard(READ, S1, second.clientId)
    expect(buddy.messagesOf(READ, S1)).toEqual([])
    expect(device.size).toBe(0)
  })

  it('offers a retry for what a second try may cure (a failure nobody explained), and the retry goes out', async () => {
    const buddy = await store()
    server.refuse = 'something nobody explained'
    const sent = (await buddy.send(READ, null, 'Once more')) as { ok: true; clientId: string }
    for (let i = 0; i < 8; i++) {
      await settle()
      buddy.kick()
    }
    await settle()
    expect(buddy.messagesOf(READ, null)[0]).toMatchObject({ state: 'failed', error: 'unknown' })
    server.refuse = null
    const open = hold()
    await buddy.retry(READ, null, sent.clientId)
    expect(buddy.messagesOf(READ, null)[0]).toMatchObject({ state: 'sending', error: null })
    open()
    await settle()
    expect(buddy.messagesOf(READ, null)).toHaveLength(1)
    expect(buddy.messagesOf(READ, null)[0]).toMatchObject({ state: 'sent' })
  })

  it('does not bring a refusal back after a reload: it is gone from the device when it is discarded', async () => {
    const buddy = await store()
    server.refuse = 'message_body_invalid'
    const sent = (await buddy.send(READ, S1, 'Nope')) as { ok: true; clientId: string }
    await settle()
    expect([...device.values()].some((v) => v.includes('Nope'))).toBe(true)
    // A reload with the refusal still on the device shows it again, failed …
    await buddy.reset()
    vi.resetModules()
    const reloaded = await store()
    await reloaded.openThread(READ, S1)
    await settle()
    expect(reloaded.messagesOf(READ, S1)[0]).toMatchObject({ state: 'failed', error: 'message_body_invalid' })
    // … until she deletes it: then it is gone from the thread and from the device.
    reloaded.discard(READ, S1, sent.clientId)
    expect(reloaded.messagesOf(READ, S1)).toEqual([])
    await reloaded.reset()
    vi.resetModules()
    const again = await store()
    await again.openThread(READ, S1)
    await settle()
    expect(again.messagesOf(READ, S1)).toEqual([])
    expect([...device.values()].some((v) => v.includes('Nope'))).toBe(false)
  })

  it('drops the refusals and the waiting messages of a read she leaves', async () => {
    const buddy = await store()
    await buddy.load(READ)
    server.refuse = 'not_found'
    await buddy.send(READ, S1, 'Left behind')
    await settle()
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ state: 'failed' })
    server.refuse = null
    await buddy.leave(READ)
    expect(buddy.messagesOf(READ, S1)).toEqual([])
    expect([...device.values()].some((v) => v.includes('Left behind'))).toBe(false)
  })

  it('tries a failure nobody explained a few times, then hands it back instead of for ever', async () => {
    const buddy = await store()
    server.refuse = 'something nobody explained'
    await buddy.send(READ, null, 'Why')
    for (let i = 0; i < 8; i++) {
      await settle()
      buddy.kick()
    }
    await settle()
    expect(buddy.messagesOf(READ, null)[0]).toMatchObject({ state: 'failed', error: 'unknown' })
    expect(posts()).toHaveLength(5)
  })
})

describe('receiving', () => {
  it('adds a live message to its thread by the server’s time, names its author from the members, and counts it as new when nobody looks', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S2)
    await buddy.retain()
    buddy.closeThread(READ, S2)
    server.messages.push(row({ section_id: S2, body: 'old' }))
    emit(liveMessage({ section_id: S2, body: 'from Ben' }))
    emit(liveMessage({ section_id: S2, author: { id: ME, name: null }, body: 'my other device' }))
    const list = buddy.messagesOf(READ, S2)
    expect(list.map((m) => [m.body, m.authorName])).toEqual([['from Ben', 'BEN'], ['my other device', 'ADA']])
    // Opening the thread read it (no news); then Ben's is new, hers never is.
    expect(buddy.countsOf(READ, S2)).toMatchObject({ count: 4, unread: 1 })
  })

  it('reads a thread that is open at once: her cursor moves and nothing is new', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    await buddy.retain()
    server.calls = []
    emit(liveMessage({ section_id: S1, body: 'live and seen' }))
    await settle()
    expect(buddy.countsOf(READ, S1)).toMatchObject({ count: 4, unread: 0 })
    const marks = server.calls.filter((c) => c.fn === 'mark_buddy_read')
    expect(marks).toHaveLength(1)
    expect(marks[0]!.args).toMatchObject({ p_read: READ, p_section: S1 })
    expect(marks[0]!.args.p_through).toBe(buddy.messagesOf(READ, S1).at(-1)!.createdAt)
  })

  it('turns a deleted message into a tombstone and counts it out', async () => {
    const buddy = await store()
    await buddy.load(READ)
    server.messages.push(row({ section_id: S1, body: 'Regret', reactions: [{ emoji: '🔥', count: 1, mine: false }] }))
    await buddy.openThread(READ, S1)
    await buddy.retain()
    const [message] = buddy.messagesOf(READ, S1)
    emit({ type: 'deleted', messageId: message!.id, readId: READ, sectionId: S1 })
    expect(buddy.messagesOf(READ, S1)[0]).toMatchObject({ body: '', kind: 'text', reactions: [] })
    expect(buddy.messagesOf(READ, S1)[0]!.deletedAt).toBeTruthy()
    expect(buddy.countsOf(READ, S1)!.count).toBe(2)
    // Twice is once.
    emit({ type: 'deleted', messageId: message!.id, readId: READ, sectionId: S1 })
    expect(buddy.countsOf(READ, S1)!.count).toBe(2)
  })

  it('reads a message again for somebody’s reaction (the aggregates carry no member) and shows her own tap at once', async () => {
    const buddy = await store()
    await buddy.load(READ)
    const stored = row({ section_id: S1, body: 'React to me' })
    server.messages.push(stored)
    await buddy.openThread(READ, S1)
    await buddy.retain()
    stored.reactions = [{ emoji: '🔥', count: 2, mine: false }]
    server.calls = []
    emit({ type: 'reaction', messageId: stored.id as string, readId: READ, memberId: BEN, emoji: '🔥' })
    await settle()
    expect(buddy.messagesOf(READ, S1)[0]!.reactions).toEqual([{ emoji: '🔥', count: 2, mine: false }])
    expect(server.calls.filter((c) => c.fn === 'buddy_read_messages')).toHaveLength(1)

    expect(await buddy.react(READ, S1, stored.id as string, '🔥')).toBeNull()
    expect(buddy.messagesOf(READ, S1)[0]!.reactions).toEqual([{ emoji: '🔥', count: 3, mine: true }])
    // A refusal puts the old picture back.
    server.refuse = 'message_unavailable'
    expect(await buddy.react(READ, S1, stored.id as string, null)).toBe('message_unavailable')
    expect(buddy.messagesOf(READ, S1)[0]!.reactions).toEqual([{ emoji: '🔥', count: 3, mine: true }])
  })

  it('reads the read again when it changed, but only one a screen has open', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.retain()
    server.calls = []
    server.readThrough = 2
    emit({ type: 'changed', readId: READ })
    emit({ type: 'changed', readId: 'another' })
    await settle()
    expect(server.calls.filter((c) => c.fn === 'buddy_read')).toHaveLength(1)
    expect(buddy.reads[READ]!.readThrough).toBe(2)
    emit({ type: 'invitation', readId: 'another' })
    await settle()
    expect(server.calls.some((c) => c.fn === 'my_buddy_reads')).toBe(true)
  })

  it('reads again what it missed after a resync: the open read, its open threads, nothing for the rest', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    await buddy.openThread(READ, S2)
    buddy.closeThread(READ, S2)
    await buddy.retain()
    server.messages.push(row({ section_id: S1, body: 'missed in S1' }), row({ section_id: S2, body: 'missed in S2' }))
    server.calls = []
    live.handlers.resync!(undefined as never)
    await settle()
    expect(buddy.messagesOf(READ, S1).map((m) => m.body)).toEqual(['missed in S1'])
    // A thread nobody looks at is read afresh when it is opened again.
    expect(buddy.messagesOf(READ, S2)).toEqual([])
    await buddy.openThread(READ, S2)
    expect(buddy.messagesOf(READ, S2).map((m) => m.body)).toEqual(['missed in S2'])
  })
})

describe('the veil', () => {
  it('opens the Sections up to her marker, the whole book once she is through, a peek on this device, and the room always', async () => {
    const buddy = await store()
    await buddy.load(READ)
    expect(buddy.view(READ, null)).toMatchObject({ open: true })
    expect(buddy.view(READ, S1)).toMatchObject({ open: true, veiled: false, showTitle: true, showUnread: true })
    // Her marker is 1: Section 2 is veiled, and so is the whole book (she has not read the last part).
    expect(buddy.view(READ, S2)).toMatchObject({ open: false, veiled: true, showTitle: false, showUnread: false, peeked: false })
    expect(buddy.view(READ, S3)).toMatchObject({ open: false })

    buddy.peek(S2)
    expect(buddy.view(READ, S2)).toMatchObject({ open: true, peeked: true })
    // Her marker did not move.
    expect(buddy.reads[READ]!.readThrough).toBe(1)
    expect([...device.keys()].some((k) => k === 'libellus.buddyRead.peeks.ada')).toBe(true)

    server.readThrough = 2
    await buddy.load(READ)
    expect(buddy.view(READ, S3)).toMatchObject({ open: true })
  })

  it('counts the news of the room and the open Sections only: a veiled Section’s is a spoiler', async () => {
    const buddy = await store()
    await buddy.load(READ)
    // Room 2, Section 1 (open) 1, Section 2 (veiled) 4 are not counted.
    expect(buddy.unread(READ)).toBe(3)
    buddy.peek(S2)
    expect(buddy.unread(READ)).toBe(7)
    expect(buddy.unread('unknown')).toBe(0)
  })

  it('keeps one member’s peeks away from another’s', async () => {
    const buddy = await store()
    await buddy.load(READ)
    buddy.peek(S2)
    session.member = { id: BEN }
    expect(buddy.peeked(S2)).toBe(false)
  })
})

describe('the lazy door', () => {
  it('makes no live channel for anything but a screen that asks: reads, threads and sends leave it alone', async () => {
    const buddy = await store()
    await buddy.loadMine()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    await buddy.send(READ, S1, 'No socket for this')
    await settle()
    expect(live.made).toBe(0)
    expect(buddy.liveStatus).toBe('idle')
  })

  it('opens it once for every screen that retains it, for the signed-in member, and closes it when she is gone', async () => {
    const buddy = await store()
    await buddy.retain()
    await buddy.retain()
    expect(live.made).toBe(1)
    expect(live.retained).toEqual([ME, ME])
    session.member = { id: BEN }
    await settle()
    expect(live.stopped).toBe(1)
    expect(buddy.reads).toEqual({})
    // The next member's screen makes her own.
    await buddy.retain()
    expect(live.made).toBe(2)
    expect(live.retained.at(-1)).toBe(BEN)
  })

  it('retains nothing without a member, and without a window', async () => {
    const buddy = await store()
    session.member = null
    await buddy.retain()
    expect(live.made).toBe(0)
  })
})

describe('what she does to a read', () => {
  it('moves her Section with her hand at once, and forgets a read she left', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.openThread(READ, S1)
    await buddy.setHand(READ, 2)
    expect(server.calls.at(-1)).toMatchObject({ fn: 'set_buddy_hand', args: { p_id: READ, p_through: 2 } })
    await buddy.leave(READ, true)
    expect(server.calls.some((c) => c.fn === 'leave_buddy_read' && c.args.p_delete_messages === true)).toBe(true)
    expect(buddy.reads[READ]).toBeUndefined()
    expect(buddy.messagesOf(READ, S1)).toEqual([])
  })

  it('forgets a read the database no longer shows her', async () => {
    const buddy = await store()
    await buddy.load(READ)
    const spy = vi.spyOn(backend, 'rpc').mockResolvedValueOnce({ data: null, error: { message: 'not_found', code: 'PT404' } as never, status: 404 } as never)
    expect(await buddy.load(READ)).toBe('not_found')
    expect(buddy.reads[READ]).toBeUndefined()
    spy.mockRestore()
  })

  it('refuses every call offline, with the code, before anything is sent', async () => {
    const buddy = await store()
    online.value = false
    expect(await buddy.load(READ)).toBe('offline')
    expect(await buddy.react(READ, S1, 'm1', '🔥')).toBe('offline')
    expect((await buddy.finish(READ)).error).toBe('offline')
    expect(server.calls).toEqual([])
  })
})

// ------------------------------------------------------------------ review: the epoch, the lock, the poll

/** Waits for what a timer-less chain of promises comes to. */
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('an answer that comes after she is gone (A, nobody, B)', () => {
  const switchAway = async () => {
    session.member = null
    await nextTick()
    session.member = { id: BEN }
    await nextTick()
  }

  it('drops what a read, her list and a thread answer after she signed out: the store stays empty for the next member', async () => {
    const buddy = await store()
    // A queue exists already, so only the answers are in flight.
    await buddy.send(READ, S2, 'warm')
    await settle()
    let open!: () => void
    server.readGate = new Promise<void>((resolve) => (open = resolve))
    const asked = [buddy.load(READ), buddy.loadMine(), buddy.openThread(READ, S1)]
    await switchAway()
    server.readGate = null
    open()
    expect(await Promise.all(asked)).toEqual(['not_signed_in', 'not_signed_in', 'not_signed_in'])
    expect(buddy.reads).toEqual({})
    expect(buddy.mine).toBeNull()
    expect(buddy.messagesOf(READ, S1)).toEqual([])
    expect(buddy.messagesOf(READ, S2)).toEqual([])
  })

  it('lets go of the tab’s lock and makes no line when she is gone while it is claimed; the next member’s line is her own', async () => {
    let openLock!: () => void
    const gate = new Promise<void>((resolve) => (openLock = resolve))
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: (lock: unknown) => unknown) => (await gate, run({})) } })
    const buddy = await store()
    const sending = buddy.send(READ, S1, 'for Ada')
    await switchAway()
    openLock()
    expect(await sending).toEqual({ ok: false, error: 'not_signed_in' })
    await settle()
    expect(posts()).toHaveLength(0)
    // Ben's line is Ben's: his message goes out as his, and nothing of Ada's is on the device.
    const mine = await buddy.send(READ, S1, 'for Ben')
    expect(mine.ok).toBe(true)
    await settle()
    expect(posts().map((c) => c.args.p_body)).toEqual(['for Ben'])
    expect([...device.values()].some((v) => v.includes('for Ada'))).toBe(false)
  })

  it('never sends what was in flight for her under the next member, and shows nothing of it to him', async () => {
    const buddy = await store()
    await buddy.load(READ)
    const open = hold()
    await buddy.send(READ, S1, 'Ada’s, on its way')
    await settle()
    expect(posts()).toHaveLength(1)
    await switchAway()
    open()
    await settle()
    expect(buddy.messagesOf(READ, S1)).toEqual([])
    expect(buddy.reads).toEqual({})
    // The line was stopped with her: a kick under Ben sends nothing of hers.
    buddy.kick()
    await settle()
    expect(posts()).toHaveLength(1)
  })

  it('starts a line for the member who has one on the device without a screen opening a thread (the store is made)', async () => {
    const line = { v: 1, jobs: [{ id: 'j1', key: 'send:left', attempts: 0, payload: { conversationId: READ, threadId: S1, clientId: 'left', kind: 'text', body: 'Left over', replyTo: null, spoiler: false, createdAt: '2026-11-13T09:00:00.000Z' } }], refusals: [] }
    device.set('libellus.buddyRead.queue.ada', JSON.stringify(line))
    await store()
    await settle()
    expect(posts().map((c) => c.args.p_body)).toEqual(['Left over'])
    expect(device.has('libellus.buddyRead.queue.ada')).toBe(false)
  })

  it('does nothing for a member without a line, and for another member’s', async () => {
    const line = { v: 1, jobs: [{ id: 'j1', key: 'send:left', attempts: 0, payload: { conversationId: READ, threadId: S1, clientId: 'left', kind: 'text', body: 'Not yours', replyTo: null, spoiler: false, createdAt: '2026-11-13T09:00:00.000Z' } }], refusals: [] }
    device.set('libellus.buddyRead.queue.ben', JSON.stringify(line))
    await store()
    await settle()
    expect(posts()).toHaveLength(0)
  })
})

describe('the live channel that cannot be had', () => {
  it('says so when the chunk is not there, asks again every 25 s, reads what was missed, and is quiet again once it is live', async () => {
    vi.useFakeTimers()
    try {
      live.fail = 1
      const buddy = await store()
      await buddy.load(READ)
      const release = await buddy.retain(READ)
      // Offline start: no channel, no throw, and the screen has a word for it.
      expect(live.made).toBe(0)
      expect(buddy.liveStuck).toBe(true)
      server.calls = []
      await vi.advanceTimersByTimeAsync(25_000)
      // The chunk came this time: the channel is retained, and what may have been missed is read.
      expect(live.made).toBe(1)
      expect(live.retained).toEqual([ME])
      expect(server.calls.some((c) => c.fn === 'buddy_read')).toBe(true)
      // Until the channel says it is live the screen still says paused.
      expect(buddy.liveStuck).toBe(true)
      ;(live.deps.onChange as (state: unknown) => void)({ status: 'live', online: true, memberId: ME })
      expect(buddy.liveStuck).toBe(false)
      server.calls = []
      await vi.advanceTimersByTimeAsync(60_000)
      expect(server.calls).toEqual([])
      release()
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows the connection’s own word: stuck (a join that never comes) polls, live again stops it, and a screen that goes ends it', async () => {
    vi.useFakeTimers()
    try {
      const buddy = await store()
      await buddy.load(READ)
      const release = await buddy.retain(READ)
      expect(buddy.liveStuck).toBe(false)
      ;(live.deps.onStuck as (stuck: boolean) => void)(true)
      expect(buddy.liveStuck).toBe(true)
      server.calls = []
      await vi.advanceTimersByTimeAsync(25_000)
      expect(server.calls.filter((c) => c.fn === 'buddy_read')).toHaveLength(1)
      release()
      server.calls = []
      await vi.advanceTimersByTimeAsync(60_000)
      expect(server.calls).toEqual([])
      expect(buddy.liveStuck).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not throw from retain whatever the module does', async () => {
    live.fail = 2
    const buddy = await store()
    await expect(buddy.retain(READ)).resolves.toBeTypeOf('function')
    await expect(buddy.retain(READ)).resolves.toBeTypeOf('function')
    expect(buddy.liveStuck).toBe(true)
  })
})

describe('a resync is not a reload of everything', () => {
  it('runs once in ten seconds however often it is asked, and reads only what a screen has open', async () => {
    vi.useFakeTimers()
    try {
      const buddy = await store()
      await buddy.load(READ)
      const release = await buddy.retain(READ)
      server.calls = []
      live.handlers.resync!(undefined as never)
      live.handlers.resync!(undefined as never)
      live.handlers.resync!(undefined as never)
      await flush()
      expect(server.calls.filter((c) => c.fn === 'buddy_read')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(10_000)
      // The three that came inside the gap are one run after it.
      expect(server.calls.filter((c) => c.fn === 'buddy_read')).toHaveLength(2)

      // Nobody has it open any more: it is dropped (and read afresh when a screen opens it), not reloaded.
      release()
      server.calls = []
      await vi.advanceTimersByTimeAsync(10_000)
      live.handlers.resync!(undefined as never)
      await flush()
      expect(server.calls.filter((c) => c.fn === 'buddy_read')).toEqual([])
      expect(buddy.reads[READ]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the peeks and the counts', () => {
  it('asks the device once for the Sections it knows, until a peek is added', async () => {
    const buddy = await store()
    await buddy.load(READ)
    const read = vi.spyOn(localStorageStub, 'getItem')
    for (let i = 0; i < 10; i++) {
      buddy.view(READ, S1)
      buddy.view(READ, S2)
      buddy.view(READ, S3)
    }
    expect(read.mock.calls.filter(([key]) => String(key).includes('peeks'))).toHaveLength(3)
    buddy.peek(S2)
    read.mockClear()
    for (let i = 0; i < 10; i++) buddy.view(READ, S2)
    expect(buddy.view(READ, S2)).toMatchObject({ open: true, peeked: true })
    expect(read.mock.calls.filter(([key]) => String(key).includes('peeks'))).toHaveLength(1)
    read.mockRestore()
  })

  it('reads the numbers again for a message deleted in a thread it has not read, and does not touch the count itself', async () => {
    const buddy = await store()
    await buddy.load(READ)
    await buddy.retain(READ)
    server.calls = []
    emit({ type: 'deleted', messageId: 'never-seen', readId: READ, sectionId: S1 } as BuddyLiveEvent)
    // The thread was not read: the deleted message was never counted here, so the count is not touched, and the read's numbers are asked again.
    await settle()
    expect(buddy.countsOf(READ, S1)).toMatchObject({ count: 3 })
    expect(server.calls.filter((c) => c.fn === 'buddy_read')).toHaveLength(1)
  })
})

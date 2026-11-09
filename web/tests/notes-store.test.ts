import { createPinia, setActivePinia } from 'pinia'
import { reactive, readonly, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The notes store's paging (stores/notes.ts): a chapter's older pages are asked for with the keyset the database orders by, the oldest stored
 * note's (createdAt, id), so notes that share an instant (an import of second-resolution times makes them) are not lost at a page edge, and a
 * refresh keeps the older ones she paged back to. The store runs as it does in Nuxt, with the auto-imports it uses stood in for and a fake
 * backend that is a small notes server answering `book_notes` and `note_messages` with the database's keyset (`created_at, id`, newest first).
 * The database itself is pgTAP's (supabase/tests/book_notes_paging_test.sql), the repository's calls are tests/notes-db.test.ts.
 */

const ME = 'ida'
const ROOM = 'room-1'
const CH = 'chapter-1'
const END = 'chapter-end'
const INSTANT = '2026-11-01T10:00:00+00:00'

const online = ref(true)
const session = reactive<{ member: { id: string; email: string; name?: string } | null }>({ member: { id: ME, email: 'ida@test', name: 'Ida' } })
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

type Row = { id: string; createdAt: string }
const server = {
  rows: [] as Row[],
  calls: [] as { fn: string; args: Record<string, unknown> }[],
}
const pad = (n: number) => `n${String(n).padStart(4, '0')}`
const json = (r: Row) => ({
  id: r.id, sectionId: CH, clientId: null, author: { id: 'ben', name: 'Ben', photo: null }, mine: false, body: `Words of ${r.id}`, kind: 'note', visibility: 'friends',
  effectiveVisibility: 'friends', createdAt: r.createdAt, quote: null, reactions: [], myReaction: null,
})
const room = () => ({
  workKey: 'w:1',
  canWrite: true,
  room: {
    id: ROOM,
    chapterCount: 1,
    me: { chapter: 1, finished: false, hand: false, auto: { chapter: 1, finished: false } },
    chapters: [
      { id: CH, position: 1, kind: 'part', count: server.rows.length, unread: 0, open: true, faces: [] },
      { id: END, position: 2, kind: 'end', count: 0, unread: 0, open: false, faces: [] },
    ],
  },
})
/** `order by created_at desc, id desc`, the keyset of `note_messages`, as the migration 20261117010000 words it. */
function noteMessages(args: Record<string, unknown>) {
  const before = args.p_before as string | null
  const beforeId = (args.p_before_id as string | undefined) ?? null
  const sorted = [...server.rows].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
  const kept = sorted.filter((r) => before === null || r.createdAt < before || (beforeId !== null && r.createdAt === before && r.id < beforeId))
  return kept.slice(0, Number(args.p_limit)).map(json)
}
const backend = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    server.calls.push({ fn, args })
    if (fn === 'book_notes') return { data: room(), error: null }
    if (fn === 'note_messages') return { data: noteMessages(args), error: null }
    if (fn === 'notes_config') return { data: { publicEnabled: false }, error: null }
    return { data: null, error: null }
  },
}

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
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  vi.stubGlobal('localStorage', localStorageStub)
  vi.stubGlobal('window', {})
  setActivePinia(createPinia())
  const { useNotesStore } = await import('~/stores/notes')
  const notes = useNotesStore()
  expect(await notes.loadPage('book-1')).toBeNull()
  return notes
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
const shown = (notes: Awaited<ReturnType<typeof store>>) => notes.messagesOf(ROOM, CH).map((m) => m.id)
const asked = () => server.calls.filter((c) => c.fn === 'note_messages').map((c) => c.args)

beforeEach(() => {
  server.rows = []
  server.calls = []
  device.clear()
  online.value = true
  session.member = { id: ME, email: 'ida@test', name: 'Ida' }
})

describe('paging a chapter whose notes share one instant', () => {
  it('asks for each older page with the oldest stored note’s createdAt and id, and loses none of 130', async () => {
    server.rows = Array.from({ length: 130 }, (_, i) => ({ id: pad(i + 1), createdAt: INSTANT }))
    const notes = await store()
    expect(await notes.openThread(ROOM, CH)).toBeNull()
    expect(shown(notes)).toHaveLength(50)
    expect(await notes.loadOlder(ROOM, CH)).toBeNull()
    expect(await notes.loadOlder(ROOM, CH)).toBeNull()

    const ids = shown(notes)
    expect(ids).toHaveLength(130)
    expect(new Set(ids).size).toBe(130)
    // The thread reads in the database's order, oldest first: the instant, then the id.
    expect(ids).toEqual(server.rows.map((r) => r.id).sort())
    expect(notes.threads[`${ROOM}#${CH}`]!.more).toBe(false)

    const [first, second, third] = asked()
    // The first page asks for what it always did: no cursor, so no p_before_id for a database that has not got it yet.
    expect(first).toEqual({ p_room: ROOM, p_section: CH, p_before: null, p_limit: 50 })
    expect(second).toEqual({ p_room: ROOM, p_section: CH, p_before: INSTANT, p_limit: 50, p_before_id: pad(81) })
    expect(third).toEqual({ p_room: ROOM, p_section: CH, p_before: INSTANT, p_limit: 50, p_before_id: pad(31) })
  })

  it('keeps the notes she paged back to when the thread is read again, ties at the edge included', async () => {
    server.rows = Array.from({ length: 130 }, (_, i) => ({ id: pad(i + 1), createdAt: INSTANT }))
    const notes = await store()
    await notes.openThread(ROOM, CH)
    await notes.loadOlder(ROOM, CH)
    await notes.loadOlder(ROOM, CH)
    expect(shown(notes)).toHaveLength(130)
    expect(await notes.refresh('book-1', CH)).toBeNull()
    await settle()
    expect(shown(notes)).toHaveLength(130)
  })

  it('drops a note the database no longer shows her when the newest page is read again, and keeps those older than the page', async () => {
    server.rows = Array.from({ length: 70 }, (_, i) => ({ id: pad(i + 1), createdAt: i < 40 ? '2026-11-01T09:00:00+00:00' : INSTANT }))
    const notes = await store()
    await notes.openThread(ROOM, CH)
    await notes.loadOlder(ROOM, CH)
    expect(shown(notes)).toHaveLength(70)
    // Narrowed by its author since: hidden from her now (inside the newest page).
    server.rows = server.rows.filter((r) => r.id !== pad(65))
    await notes.refresh('book-1', CH)
    await settle()
    expect(shown(notes)).toHaveLength(69)
    expect(shown(notes)).not.toContain(pad(65))
  })

  it('does not ask for a page before it has a note, nor when there is no more', async () => {
    server.rows = Array.from({ length: 3 }, (_, i) => ({ id: pad(i + 1), createdAt: INSTANT }))
    const notes = await store()
    await notes.openThread(ROOM, CH)
    expect(notes.threads[`${ROOM}#${CH}`]!.more).toBe(false)
    const before = asked().length
    await notes.loadOlder(ROOM, CH)
    expect(asked()).toHaveLength(before)
  })
})

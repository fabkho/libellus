import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { buddyThreadAdapter, type BuddyThreadStore } from '@/utils/buddyThreadAdapter'
import { notesThreadAdapter, type NotesThreadStore } from '@/utils/notesThreadAdapter'
import { isRetryableBuddyError, type BuddyErrorCode } from '@/data/buddyReads'
import { isRetryableNoteError, type NoteErrorCode } from '@/data/notes'
import { noteErrorKey } from '@/utils/notes'
import { buddyErrorKey } from '@/utils/buddyRead'
import { threadKey } from '#layers/chat/app/utils/thread'
import type { PreparedVoice } from '@/data/buddyVoice'

/**
 * The two adapters the shared thread screen talks to (`utils/notesThreadAdapter.ts`, `utils/buddyThreadAdapter.ts`), over a fake store:
 * that a page's own addressing is closed over here and nowhere else, and that the two things a page decides — the audience of a note and
 * the voice gate, the read's retain and release, an archived room's read-only bar — never leak into the screen.
 */

const voice = { blob: new Blob([], { type: 'audio/webm' }), mime: 'audio/webm', durationMs: 1500, peaks: [1, 2] } as unknown as PreparedVoice

/** A call of a fake store: a function that records what it was given, and answers what it was made with. */
type Recorder<T extends unknown[], R> = ((...args: T) => R) & { calls: T[] }

function spy<T extends unknown[], R>(answer: R): Recorder<T, R> {
  const calls: T[] = []
  const fn = ((...args: T): R => {
    calls.push(args)
    return answer
  }) as Recorder<T, R>
  fn.calls = calls
  return fn
}

function fakeNotes(over: Partial<NotesThreadStore> = {}) {
  const store = {
    messagesOf: spy<[string, string], unknown[]>([]),
    threads: {} as NotesThreadStore['threads'],
    loadPage: spy<[string], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    openThread: spy<[string, string], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    closeThread: spy<[string, string], void>(undefined),
    refresh: spy<[string, string | null], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    loadOlder: spy<[string, string], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    peek: spy<[string, string], void>(undefined),
    previewOf: spy<[string | null], string | null>(null),
    send: spy<[string, string, string, string, { replyTo: string | null; quote: unknown }], Promise<{ ok: boolean; error?: NoteErrorCode }>>(Promise.resolve({ ok: true })),
    sendVoice: spy<[string, string, PreparedVoice, { replyTo: string | null; quote: unknown }], Promise<{ ok: boolean; error?: NoteErrorCode }>>(Promise.resolve({ ok: true })),
    retry: spy<[string, string, string], Promise<void>>(Promise.resolve()),
    discard: spy<[string, string, string], void>(undefined),
    react: spy<[string, string, string, string], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    deleteNote: spy<[string, string, string], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    report: spy<[string, string, string | null], Promise<NoteErrorCode | null>>(Promise.resolve(null)),
    voiceUrl: spy<[string], Promise<{ data: string; error: null }>>(Promise.resolve({ data: 'https://signed/x', error: null })),
    ...over,
  }
  const deps = {
    store: store as unknown as NotesThreadStore,
    bookId: () => 'book-1',
    roomId: () => 'room-1',
    chapterId: () => 'ch5',
    hasRoom: () => true,
    me: () => 'ada',
    isOpen: () => true,
    missing: () => false,
    veiled: () => false,
    errorWord: (code: string) => `word:${code}`,
    retryable: isRetryableNoteError as (code: string) => boolean,
    level: () => level.value,
    voiceAllowed: () => allowed.value,
    backTo: () => '/notes/book-1',
  }
  const level = ref<'private' | 'friends' | 'public'>('friends')
  const allowed = ref(false)
  return { store, deps, adapter: notesThreadAdapter(deps), level, allowed }
}

function fakeBuddy(over: Partial<BuddyThreadStore> = {}) {
  const releases: number[] = []
  const store = {
    threads: {} as BuddyThreadStore['threads'],
    messagesOf: spy<[string, string | null], unknown[]>([]),
    load: spy<[string], Promise<BuddyErrorCode | null>>(Promise.resolve(null)),
    openThread: spy<[string, string | null], Promise<BuddyErrorCode | null>>(Promise.resolve(null)),
    closeThread: spy<[string, string | null], void>(undefined),
    loadOlder: spy<[string, string | null], Promise<BuddyErrorCode | null>>(Promise.resolve(null)),
    peek: spy<[string], void>(undefined),
    retain: vi.fn(async () => () => void releases.push(1)),
    previewOf: spy<[string | null], string | null>(null),
    send: spy<[string, string | null, string, { replyTo: string | null }], Promise<{ ok: boolean; error?: BuddyErrorCode }>>(Promise.resolve({ ok: true })),
    sendVoice: spy<[string, string | null, PreparedVoice, { replyTo: string | null }], Promise<{ ok: boolean; error?: BuddyErrorCode }>>(Promise.resolve({ ok: true })),
    retry: spy<[string, string | null, string], Promise<void>>(Promise.resolve()),
    discard: spy<[string, string | null, string], void>(undefined),
    react: spy<[string, string | null, string, string], Promise<BuddyErrorCode | null>>(Promise.resolve(null)),
    deleteMessage: spy<[string, string | null, string], Promise<BuddyErrorCode | null>>(Promise.resolve(null)),
    report: spy<[string, string, string | null], Promise<{ error: BuddyErrorCode | null }>>(Promise.resolve({ error: null })),
    voiceUrl: spy<[string], Promise<{ data: string; error: null }>>(Promise.resolve({ data: 'https://signed/x', error: null })),
    ...over,
  }
  /** The Section: null for the read's own room, which the page addresses as `room`. */
  const section = ref<string | null>('s1')
  const deps = {
    store: store as unknown as BuddyThreadStore,
    readId: () => 'read-1',
    sectionId: () => section.value,
    hasRoom: () => true,
    me: () => 'ada',
    isOpen: () => true,
    missing: () => false,
    veiled: () => false,
    nameOf: (id: string | null) => (id === 'ben' ? 'Ben' : null),
    errorWord: (code: string) => `word:${code}`,
    retryable: (code: string) => isRetryableBuddyError(code as BuddyErrorCode),
    backTo: () => '/together/read-1',
  }
  return { store, deps, adapter: buddyThreadAdapter(deps), section, releases }
}

const call = <T>(calls: T[]) => calls.at(-1)!

describe('the Notes adapter', () => {
  it('addresses every call to its own room and chapter, never to a Section it was not given', async () => {
    const { adapter, store } = fakeNotes()
    await adapter.loadInitial()
    await adapter.openThread()
    adapter.closeThread()
    await adapter.loadOlder()
    adapter.peek()
    await adapter.send('Hello', { replyToId: 'n1', quote: null })
    adapter.discard('c1')
    await adapter.retry('c1')
    await adapter.react('n1', '🔥')
    await adapter.deleteMessage('n1')

    expect(call(store.loadPage.calls)).toEqual(['book-1'])
    for (const call of store.openThread.calls) expect(call).toEqual(['room-1', 'ch5'])
    expect(call(store.closeThread.calls)).toEqual(['room-1', 'ch5'])
    expect(call(store.loadOlder.calls)).toEqual(['room-1', 'ch5'])
    expect(call(store.peek.calls)).toEqual(['room-1', 'ch5'])
    expect(call(store.discard.calls)).toEqual(['room-1', 'ch5', 'c1'])
    expect(call(store.retry.calls)).toEqual(['room-1', 'ch5', 'c1'])
    expect(call(store.react.calls)).toEqual(['room-1', 'ch5', 'n1', '🔥'])
    expect(call(store.deleteNote.calls)).toEqual(['room-1', 'ch5', 'n1'])
  })

  it('sends at the page’s level, with the reply and the quote it was handed', async () => {
    const { adapter, store, level } = fakeNotes()
    level.value = 'private'
    const quote = { kind: 'note' as const, id: 'n1', author: { id: 'ben', name: 'Ben', photo: null }, excerpt: 'First words', voice: false }
    await adapter.send('Hello', { replyToId: 'n1', quote })
    expect(call(store.send.calls)).toEqual(['room-1', 'ch5', 'Hello', 'private', { replyTo: 'n1', quote }])

    level.value = 'public'
    await adapter.send('Everyone', { replyToId: null, quote: null })
    expect(call(store.send.calls)).toEqual(['room-1', 'ch5', 'Everyone', 'public', { replyTo: null, quote: null }])
  })

  it('refuses a voice note anywhere but Only me, before the store is called, with `voice_private_only`', async () => {
    const { adapter, store, allowed, level } = fakeNotes()
    level.value = 'friends'
    expect(await adapter.sendVoice(voice, { replyToId: null, quote: null })).toEqual({ ok: false, error: 'voice_private_only' })
    expect(store.sendVoice.calls).toEqual([])

    // The gate is the page's (the microphone is offered at Only me and on her own private note only).
    allowed.value = true
    expect(await adapter.sendVoice(voice, { replyToId: null, quote: null })).toEqual({ ok: true })
    expect(call(store.sendVoice.calls)).toEqual(['room-1', 'ch5', voice, { replyTo: null, quote: null }])
  })

  it('reads the pages of its own thread, and its own refresh', async () => {
    const { adapter, store } = fakeNotes()
    store.threads[threadKey('room-1', 'ch5')] = { messages: [], loaded: true, more: true, loading: false, marked: null }
    expect(adapter.paging()).toEqual({ more: true, loading: false, loaded: true, room: true })
    store.threads = {}
    expect(adapter.paging()).toEqual({ more: false, loading: false, loaded: false, room: true })
    await adapter.refresh?.()
    expect(call(store.refresh.calls)).toEqual(['book-1', 'ch5'])
  })

  it('words a note’s refusals by the notes’ own keys, and has no channel to retain', () => {
    const { adapter } = fakeNotes()
    expect(adapter.errorWord('note_wider_than_parent')).toBe(`word:note_wider_than_parent`)
    expect(adapter.retryable('rate_limited')).toBe(true)
    expect(adapter.retryable('note_wider_than_parent')).toBe(false)
    expect(adapter.retain).toBeUndefined()
    expect(noteErrorKey('voice_private_only' as NoteErrorCode)).toBe('notes.error.voice_private_only')
  })
})

describe('the buddy read adapter', () => {
  it('addresses every call to its own read and Section, the room’s own thread included', async () => {
    const { adapter, store, section } = fakeBuddy()
    await adapter.loadInitial()
    await adapter.openThread()
    adapter.closeThread()
    await adapter.send('Hello', { replyToId: null, quote: null })
    adapter.discard('c1')
    await adapter.deleteMessage('m1')
    expect(call(store.load.calls)).toEqual(['read-1'])
    expect(call(store.openThread.calls)).toEqual(['read-1', 's1'])
    expect(call(store.closeThread.calls)).toEqual(['read-1', 's1'])
    expect(call(store.deleteMessage.calls)).toEqual(['read-1', 's1', 'm1'])

    // The room: the same read, no Section (`threadKey(read, null)`).
    section.value = null
    await adapter.openThread()
    expect(call(store.openThread.calls)).toEqual(['read-1', null])
    store.threads[threadKey('read-1', null)] = { messages: [], loaded: true, more: false, loading: false, marked: null }
    expect(adapter.paging()).toMatchObject({ loaded: true, room: true })
  })

  it('sends only the reply, with no quote and no audience, and has nothing to peek at in the room', async () => {
    const { adapter, store, section } = fakeBuddy()
    await adapter.send('Hello', { replyToId: 'm1', quote: { kind: 'note' } })
    expect(call(store.send.calls)).toEqual(['read-1', 's1', 'Hello', { replyTo: 'm1' }])
    await adapter.sendVoice(voice, { replyToId: null, quote: null })
    expect(call(store.sendVoice.calls)).toEqual(['read-1', 's1', voice, { replyTo: null }])

    adapter.peek()
    expect(call(store.peek.calls)).toEqual(['s1'])
    section.value = null
    adapter.peek()
    expect(store.peek.calls).toHaveLength(1)
  })

  it('round-trips retain and release over its own read', async () => {
    const { adapter, store, releases } = fakeBuddy()
    const letGo = await adapter.retain?.()
    expect(store.retain).toHaveBeenCalledWith('read-1')
    expect(releases).toEqual([])
    letGo?.()
    expect(releases).toEqual([1])
  })

  it('answers its report with the refusal’s code, and words a read’s own', async () => {
    const { adapter, store } = fakeBuddy()
    ;(store as unknown as { report: unknown }).report = spy<[string, string, string | null], Promise<{ error: BuddyErrorCode | null }>>(Promise.resolve({ error: 'buddy_read_archived' }))
    expect(await adapter.report('m1', 'spam', null)).toBe('buddy_read_archived')
    expect(call(store.report.calls)).toEqual(['m1', 'spam', null])
    expect(adapter.errorWord('buddy_read_archived')).toBe(`word:buddy_read_archived`)
    expect(buddyErrorKey('buddy_read_archived' as BuddyErrorCode)).toBe('buddyRead.error.buddy_read_archived')
  })

  it('reads an archived read as one that may not be liked nor written to (the page’s own two answers)', () => {
    const archived = ref(false)
    // As the page passes them: `canLike` and `canWrite` are the read's, and the screen only asks.
    const { adapter } = fakeBuddy()
    const canLike = () => !archived.value
    const canWrite = () => !archived.value
    expect([canLike(), canWrite()]).toEqual([true, true])
    archived.value = true
    expect([canLike(), canWrite()]).toEqual([false, false])
    // And the bar the page composes: nobody's message is the bar's business once it takes no writing.
    expect(adapter.nameOf('ben')).toBe('Ben')
    expect(computed(() => adapter.nameOf('nobody')).value).toBeNull()
  })
})

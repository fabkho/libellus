import { createPinia, setActivePinia } from 'pinia'
import { reactive, readonly, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VOICE_QUEUE_MAX_AGE_MS, VOICE_URL_REUSE_MS } from '@/data/buddyVoice'
import { noteFromJson, mapNoteVoiceStorageError, type NoteMessage } from '@/data/notes'
import { NOTE_VOICE_BUCKET, notePath, voiceFromNoteJson } from '@/data/noteVoice'
import { noteItems, noteJob, noteQuoteOf, noteVoiceJob, noteVoiceOfJob, pendingNote, replyChipOf, sentNote, tombstoneNote, visibilityOfJob, type NoteThreadContext } from '@/utils/notes'
import { VOICE_UNSIGNED } from '@/utils/roomThread'

/**
 * Voice notes, the parts that need no stack (the rules through the database are tests/notes-voice-db.test.ts and supabase/tests/notes_private_voice_test.sql):
 * the object's name (the database works out the same one), how a row, a queue job and a stored note become a voice note, how the thread draws one (a placeholder
 * URL until she presses play: nothing is signed or fetched when it loads), what a quote of one says, and the store's send: the bubble at once, the sound stored
 * before the post, offline making a failed bubble and not a lost one, a signed URL asked for only when she presses play and kept for four minutes.
 */

const ROOM = 'room-1'
const CH = 'chapter-1'
const ME = '22222222-2222-4222-8222-222222222222'
const CLIENT = '44444444-4444-4444-8444-444444444444'
const card = (id: string, name: string | null = id) => ({ id, name, photo: null })
const blob = (bytes: number, type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array(bytes)], { type })

describe('the sound of a note', () => {
  it('lives in the private bucket note-voice, in her own folder of the room, under the name the database works out', () => {
    expect(NOTE_VOICE_BUCKET).toBe('note-voice')
    expect(notePath(ME, ROOM, CLIENT, 'audio/mp4')).toBe(`${ME}/${ROOM}/${CLIENT}.m4a`)
    expect(notePath(ME, ROOM, CLIENT, 'audio/webm')).toBe(`${ME}/${ROOM}/${CLIENT}.webm`)
    expect(notePath(ME, ROOM, CLIENT, 'audio/ogg')).toBe(`${ME}/${ROOM}/${CLIENT}.ogg`)
  })

  it('reads the voice of a row (camelCase, hers alone) and is none for a note without one or a type that is none of three', () => {
    expect(voiceFromNoteJson({ path: 'a/b/c.m4a', mime: 'audio/mp4', durationMs: 4_200.4, peaks: [1, 50, 100] })).toEqual({ path: 'a/b/c.m4a', mime: 'audio/mp4', durationMs: 4_200, peaks: [1, 50, 100] })
    expect(voiceFromNoteJson({ mime: 'audio/webm', durationMs: 1000, peaks: null })).toEqual({ path: null, mime: 'audio/webm', durationMs: 1000, peaks: [] })
    expect(voiceFromNoteJson(null)).toBeNull()
    expect(voiceFromNoteJson(undefined)).toBeNull()
    expect(voiceFromNoteJson({ mime: 'audio/mpeg', durationMs: 1000 })).toBeNull()
  })

  it('maps a refusal of the Storage API into the notes’ words', () => {
    expect(mapNoteVoiceStorageError({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe('not_found')
    expect(mapNoteVoiceStorageError({ statusCode: '413', message: 'The object exceeded the maximum allowed size' })).toBe('voice_too_large')
    expect(mapNoteVoiceStorageError({ message: 'mime type audio/mpeg is not supported' })).toBe('voice_invalid')
    expect(mapNoteVoiceStorageError({ name: 'StorageUnknownError', message: 'fetch failed' })).toBe('offline')
  })
})

describe('a voice note from the database', () => {
  const row = (over: object = {}) => ({
    id: 'n1',
    sectionId: CH,
    clientId: CLIENT,
    author: card(ME, 'Mia'),
    mine: true,
    body: '',
    kind: 'note' as const,
    visibility: 'private' as const,
    effectiveVisibility: 'private' as const,
    createdAt: '2026-11-18T10:00:00+00:00',
    quote: null,
    reactions: [],
    myReaction: null,
    voice: { path: `${ME}/${ROOM}/${CLIENT}.m4a`, mime: 'audio/mp4', durationMs: 4_200, peaks: [10, 40, 90] },
    ...over,
  })

  it('is a voice note with its sound, always Only me', () => {
    expect(noteFromJson(ROOM, row())).toMatchObject({ kind: 'voice', body: '', visibility: 'private', voice: { mime: 'audio/mp4', durationMs: 4_200, peaks: [10, 40, 90] } })
  })

  it('is a text note when there is no voice in the row, and a tombstone keeps no sound even if a row said so', () => {
    expect(noteFromJson(ROOM, row({ voice: undefined, body: 'words' }))).toMatchObject({ kind: 'text', body: 'words', voice: null })
    expect(noteFromJson(ROOM, row({ kind: 'removed' }))).toMatchObject({ kind: 'text', body: '', voice: null })
  })

  it('quotes a voice note as one, never with words', () => {
    const quoted = noteFromJson(ROOM, row({ voice: undefined, body: 'answer', quote: { id: 'n0', author: card(ME, 'Mia'), excerpt: '', voice: true } }))
    expect(quoted.quote).toEqual({ kind: 'note', id: 'n0', author: card(ME, 'Mia'), excerpt: '', voice: true })
    expect(noteQuoteOf({ quote: quoted.quote, replyTo: 'n0' }, [], ME, { deleted: 'Deleted', someone: 'Someone', you: 'You', hidden: 'Hidden', voice: 'Voice message' })).toEqual({
      id: null,
      mine: true,
      name: 'You',
      preview: 'Voice message',
    })
  })
})

describe('a voice note in a queue and in a thread', () => {
  const media = { mime: 'audio/webm' as const, durationMs: 2_000, peaks: [5, 80] }
  const job = noteVoiceJob({ roomId: ROOM, sectionId: CH, clientId: CLIENT, replyTo: null, createdAt: '2026-11-18T10:00:00.000Z' }, media)
  const ctx = (over: Partial<NoteThreadContext> = {}): NoteThreadContext => ({ me: ME, open: true, revealed: new Set(), nameOf: () => null, errorWord: (code) => `word:${code}`, retryable: (code) => code === 'offline', ...over })

  it('is a job of kind voice, Only me, that a job of text is not', () => {
    expect(job).toMatchObject({ kind: 'voice', body: '', spoiler: false, payload: { visibility: 'private' }, media })
    expect(noteVoiceOfJob(job)).toEqual(media)
    const text = noteJob({ roomId: ROOM, sectionId: CH, clientId: 'c2', body: 'words', replyTo: null, spoiler: false, createdAt: job.createdAt }, 'friends')
    expect(noteVoiceOfJob(text)).toBeNull()
    expect(noteVoiceOfJob({ ...job, media: { mime: 'audio/mpeg', durationMs: 1, peaks: [] } })).toBeNull()
    // A stored job that is not shaped like one is sent as a text at Friends at the widest, and never as a voice note.
    expect(visibilityOfJob({ ...job, payload: { visibility: 'public' } })).toBe('public')
    expect(noteVoiceOfJob({ ...job, kind: 'text' })).toBeNull()
  })

  it('shows at once as her own private voice note, with the name its object will have, and no URL', () => {
    const pending = pendingNote(job, ME, 'Mia')
    expect(pending).toMatchObject({ kind: 'voice', body: '', visibility: 'private', effectiveVisibility: 'private', state: 'sending', voice: { path: `${ME}/${ROOM}/${CLIENT}.webm`, mime: 'audio/webm', durationMs: 2_000, peaks: [5, 80] } })
    const [item] = noteItems([sentNote({ ...(pending as NoteMessage), id: 'n1' })], ctx())
    // Stored: the stand-in until she presses play (the thread never fetches a sound); a copy on this device plays from there.
    expect(item).toMatchObject({ voice: true, kind: 'media', body: '', media: { kind: 'voice', url: VOICE_UNSIGNED, path: `${ME}/${ROOM}/${CLIENT}.webm`, durationMs: 2_000, peaks: [5, 80] } })
    const [mine] = noteItems([sentNote({ ...(pending as NoteMessage), id: 'n1' })], ctx({ previewOf: () => 'blob:copy' }))
    expect(mine!.media?.url).toBe('blob:copy')
    const [sending] = noteItems([pending], ctx())
    expect(sending!.media?.url).toBeNull()
  })

  it('says "Voice message" in the chip of the answer, and is a tombstone with nothing to play once deleted', () => {
    const [item] = noteItems([sentNote({ ...(pendingNote(job, ME, 'Mia') as NoteMessage), id: 'n1' })], ctx())
    expect(replyChipOf(item!, { someone: 'Someone', you: 'You', voice: 'Voice message' })).toEqual({ name: 'You', preview: 'Voice message' })
    const gone = tombstoneNote(sentNote({ ...(pendingNote(job, ME, 'Mia') as NoteMessage), id: 'n1' }), '2026-11-18T11:00:00Z')
    expect(gone).toMatchObject({ kind: 'text', body: '', voice: null })
    expect(noteItems([gone], ctx())[0]).toMatchObject({ removed: true, voice: false, media: null })
  })
})

// ------------------------------------------------------------------ the store

const online = ref(true)
const session = reactive<{ member: { id: string; email: string; name?: string } | null }>({ member: { id: ME, email: 'mia@test', name: 'Mia' } })
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

const server = {
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  /** The rows `note_messages` answers: what the thread holds when it is opened again. */
  messages: [] as Record<string, unknown>[],
  uploads: [] as { path: string; type: string }[],
  signed: [] as string[],
  uploadError: null as { message: string; statusCode?: string } | null,
  postError: null as { message: string } | null,
}
const storedRow = (args: Record<string, unknown>) => ({
  id: `n-${args.p_client_id}`,
  sectionId: CH,
  clientId: args.p_client_id,
  author: card(ME, 'Mia'),
  mine: true,
  body: '',
  kind: 'note',
  visibility: 'private',
  effectiveVisibility: 'private',
  createdAt: '2026-11-18T10:00:00+00:00',
  quote: null,
  reactions: [],
  myReaction: null,
  voice: { path: args.p_object, mime: args.p_mime, durationMs: args.p_duration_ms, peaks: args.p_peaks ?? [] },
})
const backend = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    server.calls.push({ fn, args })
    if (fn === 'post_note_voice') return server.postError ? { data: null, error: server.postError } : { data: storedRow(args), error: null }
    if (fn === 'book_notes') {
      return {
        data: {
          workKey: 'w:1',
          canWrite: true,
          room: {
            id: ROOM,
            chapterCount: 1,
            me: { chapter: 1, finished: false, hand: false, auto: { chapter: 1, finished: false } },
            chapters: [
              { id: CH, position: 1, kind: 'part', count: 0, unread: 0, open: true, faces: [] },
              { id: 'end', position: 2, kind: 'end', count: 0, unread: 0, open: false, faces: [] },
            ],
          },
        },
        error: null,
      }
    }
    if (fn === 'note_messages') return { data: server.messages, error: null }
    if (fn === 'notes_config') return { data: { publicEnabled: false }, error: null }
    return { data: null, error: null }
  },
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, body: Blob) => {
        expect(bucket).toBe(NOTE_VOICE_BUCKET)
        if (server.uploadError) return { data: null, error: server.uploadError }
        server.uploads.push({ path, type: body.type })
        return { data: { path }, error: null }
      },
      createSignedUrl: async (path: string) => {
        expect(bucket).toBe(NOTE_VOICE_BUCKET)
        server.signed.push(path)
        return { data: { signedUrl: `https://stack/sign/${path}?token=${server.signed.length}` }, error: null }
      },
    }),
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
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
async function store() {
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  vi.stubGlobal('localStorage', localStorageStub)
  vi.stubGlobal('window', {})
  let n = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:copy-${++n}`, revokeObjectURL: () => undefined }))
  setActivePinia(createPinia())
  const { useNotesStore } = await import('~/stores/notes')
  const notes = useNotesStore()
  expect(await notes.loadPage('book-1')).toBeNull()
  await notes.openThread(ROOM, CH)
  return notes
}
const good = () => ({ blob: blob(20_000), durationMs: 2_300, peaks: [10, 50, 100] })

beforeEach(() => {
  server.calls = []
  server.messages = []
  server.uploads = []
  server.signed = []
  server.uploadError = null
  server.postError = null
  device.clear()
  online.value = true
  session.member = { id: ME, email: 'mia@test', name: 'Mia' }
})

describe('the store sends a recording as a private note', () => {
  it('shows a bubble at once, stores the sound in her folder before posting, posts it with no level and keeps her copy to play', async () => {
    const notes = await store()
    const sent = await notes.sendVoice(ROOM, CH, good())
    expect(sent.ok).toBe(true)
    const clientId = sent.ok ? sent.clientId : ''
    // At once: a sending bubble, a voice note at Only me, playable from the copy on this device.
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ clientId, kind: 'voice', visibility: 'private', state: 'sending' })
    expect(notes.previewOf(clientId)).toMatch(/^blob:/)
    await settle()
    expect(server.uploads).toEqual([{ path: notePath(ME, ROOM, clientId, 'audio/webm'), type: 'audio/webm' }])
    const post = server.calls.find((c) => c.fn === 'post_note_voice')!
    expect(post.args).toEqual({
      p_room: ROOM,
      p_section: CH,
      p_client_id: clientId,
      p_object: notePath(ME, ROOM, clientId, 'audio/webm'),
      p_mime: 'audio/webm',
      p_duration_ms: 2_300,
      p_peaks: [10, 50, 100],
      p_reply_to: null,
    })
    expect(Object.keys(post.args)).not.toContain('p_visibility')
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ state: 'sent', kind: 'voice', voice: { mime: 'audio/webm' } })
    // The upload comes first: the post never goes out before its sound is stored.
    expect(server.calls.filter((c) => c.fn === 'post_note_voice')).toHaveLength(1)
    expect(notes.threads[`${ROOM}#${CH}`]!.messages).toHaveLength(1)
  })

  it('is refused here, before anything leaves, when it is too short, too big or of a type the bucket does not take', async () => {
    const notes = await store()
    expect(await notes.sendVoice(ROOM, CH, { blob: blob(20_000), durationMs: 500, peaks: [] })).toEqual({ ok: false, error: 'voice_short' })
    expect(await notes.sendVoice(ROOM, CH, { blob: blob(4 * 1024 * 1024), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, error: 'voice_large' })
    expect(await notes.sendVoice(ROOM, CH, { blob: blob(20_000, 'audio/mpeg'), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, error: 'voice_type' })
    expect(notes.messagesOf(ROOM, CH)).toHaveLength(0)
    expect(server.uploads).toHaveLength(0)
  })

  it('offline: the bubble is a failed one she can send again from the copy in memory, and nothing was lost', async () => {
    const notes = await store()
    online.value = false
    const sent = await notes.sendVoice(ROOM, CH, good())
    const clientId = sent.ok ? sent.clientId : ''
    await settle()
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ clientId, state: 'failed', error: 'offline' })
    expect(server.uploads).toHaveLength(0)
    online.value = true
    await notes.retry(ROOM, CH, clientId)
    await settle()
    expect(server.uploads).toHaveLength(1)
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ state: 'sent', kind: 'voice' })
  })

  it('hands a refusal of the post back on the bubble, and a recording that waited too long is not sent at all', async () => {
    const notes = await store()
    server.postError = { message: 'voice_invalid' }
    const sent = await notes.sendVoice(ROOM, CH, good())
    const clientId = sent.ok ? sent.clientId : ''
    await settle()
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ clientId, state: 'failed', error: 'voice_invalid' })
    // Given up: the bubble goes, the copy with it.
    notes.discard(ROOM, CH, clientId)
    expect(notes.messagesOf(ROOM, CH)).toHaveLength(0)
    expect(notes.previewOf(clientId)).toBeNull()
    expect(VOICE_QUEUE_MAX_AGE_MS).toBe(4 * 60 * 60 * 1000)
  })

  it('a refusal of the bucket (no Book for the room, the hour spent) is a failed bubble she can only delete', async () => {
    const notes = await store()
    server.uploadError = { message: 'new row violates row-level security policy', statusCode: '403' }
    const sent = await notes.sendVoice(ROOM, CH, good())
    const clientId = sent.ok ? sent.clientId : ''
    await settle()
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ clientId, state: 'failed', error: 'not_found' })
    expect(server.calls.filter((c) => c.fn === 'post_note_voice')).toHaveLength(0)
  })

  it('answers her own private note only: any other parent is dropped with its quote, not sent to be refused', async () => {
    const notes = await store()
    const herPrivate = { id: 'n-private', senderId: ME, mine: true, visibility: 'private', clientId: null, kind: 'text', body: 'mine, private' }
    const herFriends = { id: 'n-friends', senderId: ME, mine: true, visibility: 'friends', clientId: null, kind: 'text', body: 'mine, for friends' }
    const theirs = { id: 'n-theirs', senderId: 'someone-else', mine: false, visibility: 'friends', clientId: null, kind: 'text', body: 'theirs' }
    const row = (over: Record<string, unknown>) => ({
      sectionId: CH, clientId: null, author: card(String(over.senderId), 'Someone'), mine: Boolean(over.mine), body: String(over.body), kind: 'note',
      effectiveVisibility: over.visibility, spoiler: false, createdAt: '2026-11-18T09:00:00+00:00', quote: null, reactions: [], myReaction: null, voice: null, ...over,
      // `kind` is the database's word for a live note, never the thread item's shape.
      kind: 'note',
    })
    server.messages = [herPrivate, herFriends, theirs].map(row)
    // A thread that is already loaded is read again by a Refresh (that is what the screen does); a fresh open asks for its page.
    await notes.refresh('book-1', CH)
    expect(notes.messagesOf(ROOM, CH)).toHaveLength(3)
    // Hers and private: the answer goes with the post.
    await notes.sendVoice(ROOM, CH, good(), { replyTo: 'n-private', quote: { kind: 'note', id: 'n-private', author: card(ME, 'Mia'), excerpt: 'mine', voice: false } })
    await settle()
    expect(server.calls.find((c) => c.fn === 'post_note_voice')!.args.p_reply_to).toBe('n-private')
    // Her own at Friends, somebody else's, and one that is not in the thread: no answer, and no quote on the bubble.
    for (const replyTo of ['n-friends', 'n-theirs', 'n-gone']) {
      server.calls = []
      const sent = await notes.sendVoice(ROOM, CH, good(), { replyTo, quote: { kind: 'note', id: replyTo, author: card(ME, 'Mia'), excerpt: 'x', voice: false } })
      await settle()
      const post = server.calls.find((c) => c.fn === 'post_note_voice')!
      expect(post.args.p_reply_to, replyTo).toBeNull()
      const bubble = notes.messagesOf(ROOM, CH).find((m) => m.clientId === (sent.ok ? sent.clientId : ''))!
      expect(bubble.replyTo, replyTo).toBeNull()
      expect(bubble.quote, replyTo).toBeNull()
    }
  })
})

describe('the store signs a URL only when she presses play', () => {
  it('asks for nothing when a thread opens or a voice note is stored, signs once and keeps the URL for four minutes', async () => {
    const notes = await store()
    await notes.sendVoice(ROOM, CH, good())
    await settle()
    expect(server.signed).toEqual([])
    const path = notes.messagesOf(ROOM, CH)[0]!.voice!.path!
    const first = await notes.voiceUrl(path)
    expect(first.error).toBeNull()
    expect(server.signed).toEqual([path])
    // A second press inside the window plays the one signed a moment ago.
    expect((await notes.voiceUrl(path)).data).toBe(first.data)
    expect(server.signed).toHaveLength(1)
    expect(VOICE_URL_REUSE_MS).toBe(240_000)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + VOICE_URL_REUSE_MS + 1_000)
    expect((await notes.voiceUrl(path)).data).not.toBe(first.data)
    vi.useRealTimers()
    expect(server.signed).toHaveLength(2)
  })

  it('forgets the URL of a note she deletes, and asks nothing offline', async () => {
    const notes = await store()
    await notes.sendVoice(ROOM, CH, good())
    await settle()
    const bubble = notes.messagesOf(ROOM, CH)[0]!
    const path = bubble.voice!.path!
    await notes.voiceUrl(path)
    expect(await notes.deleteNote(ROOM, CH, bubble.id)).toBeNull()
    expect(notes.messagesOf(ROOM, CH)[0]).toMatchObject({ kind: 'text', voice: null, deletedAt: expect.any(String) })
    expect(notes.previewOf(bubble.clientId)).toBeNull()
    await notes.voiceUrl(path)
    expect(server.signed).toHaveLength(2)
    online.value = false
    expect(await notes.voiceUrl('x/y/z.m4a')).toEqual({ data: null, error: 'offline' })
    expect(server.signed).toHaveLength(2)
  })

  it('forgets everything of the member when another signs in', async () => {
    const notes = await store()
    const sent = await notes.sendVoice(ROOM, CH, good())
    const clientId = sent.ok ? sent.clientId : ''
    expect(notes.previewOf(clientId)).not.toBeNull()
    notes.reset()
    expect(notes.previewOf(clientId)).toBeNull()
  })
})

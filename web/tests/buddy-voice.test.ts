import { describe, expect, it } from 'vitest'
import { checkVoice } from '@fabkho/ui/pure/voice'
import {
  mimeOfPath,
  prepareVoice,
  sendablePeaks,
  VOICE_LIMITS,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  VOICE_MAX_PEAKS,
  VOICE_MIN_MS,
  VOICE_URL_REUSE_MS,
  VOICE_URL_SECONDS,
  voiceFromJson,
  voicePath,
} from '@/data/buddyVoice'
import { messageFromJson, mapVoiceStorageError } from '@/data/buddyReads'
import { parseBuddyEvent } from '@/data/buddyLive'
import { pendingBubble, sentBubble, tombstoneOf, voiceJob, voiceOfJob, type BuddyBubble } from '@/utils/buddyRead'
import { quoteOf, threadItems, VOICE_UNSIGNED, type ThreadContext } from '@/utils/buddyThread'

/**
 * Voice messages in a buddy read, the parts that need no stack (the rules through the database are tests/buddy-voice-db.test.ts and
 * supabase/tests/buddy_voice_test.sql; the store's send is tests/buddy-read-store.test.ts): what a recording is held to before it is sent, the
 * name of its object (the database works out the same one), how a row, a live event and a queue job become a voice message, how the thread
 * draws one (a placeholder URL until she presses play, a veiled one has no sound, a tombstone nothing) and what a quote of one says.
 */

const READ = '11111111-1111-4111-8111-111111111111'
const ADA = '22222222-2222-4222-8222-222222222222'
const BEN = '33333333-3333-4333-8333-333333333333'
const CLIENT = '44444444-4444-4444-8444-444444444444'
const blob = (bytes: number, type = 'audio/mp4') => new Blob([new Uint8Array(bytes)], { type })

describe('what a recording is held to', () => {
  it('says the limits of the database: two minutes, a second at the least, 3 MB, 48 waveform values', () => {
    expect(VOICE_MAX_MS).toBe(120_000)
    expect(VOICE_MIN_MS).toBe(1_000)
    expect(VOICE_MAX_BYTES).toBe(3 * 1024 * 1024)
    expect(VOICE_MAX_PEAKS).toBe(48)
    expect(VOICE_LIMITS).toEqual({ minMs: 1_000, maxBytes: 3 * 1024 * 1024 })
  })

  it('sends a good recording as its type, its length and its waveform', () => {
    expect(prepareVoice({ blob: blob(5_000, 'audio/mp4;codecs=mp4a.40.2'), durationMs: 4_321.6, peaks: [0, 50, 100] })).toEqual({
      ok: true,
      mime: 'audio/mp4',
      durationMs: 4_322,
      peaks: [0, 50, 100],
    })
    expect(prepareVoice({ blob: blob(5_000, 'audio/webm;codecs=opus'), durationMs: 2_000, peaks: [] })).toMatchObject({ ok: true, mime: 'audio/webm' })
    expect(prepareVoice({ blob: blob(5_000, 'audio/ogg;codecs=opus'), durationMs: 2_000, peaks: [] })).toMatchObject({ ok: true, mime: 'audio/ogg' })
  })

  it('refuses a slip of the finger, an empty or big file and a type the bucket does not take, the way the base checks one', () => {
    expect(prepareVoice({ blob: blob(5_000), durationMs: 999, peaks: [] })).toEqual({ ok: false, reason: 'short' })
    expect(prepareVoice({ blob: blob(VOICE_MAX_BYTES + 1), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, reason: 'large' })
    expect(prepareVoice({ blob: blob(0), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, reason: 'large' })
    expect(prepareVoice({ blob: blob(5_000, 'audio/mpeg'), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, reason: 'type' })
    expect(prepareVoice({ blob: blob(5_000, 'video/mp4'), durationMs: 5_000, peaks: [] })).toEqual({ ok: false, reason: 'type' })
    expect(checkVoice(blob(5_000), 5_000, VOICE_LIMITS)).toBeNull()
  })

  it('cuts a recording that ran a little past two minutes to two minutes', () => {
    expect(prepareVoice({ blob: blob(5_000), durationMs: 120_400, peaks: [] })).toMatchObject({ ok: true, durationMs: VOICE_MAX_MS })
  })

  it('sends whole waveform values 0 - 100, at most 48, thinned evenly', () => {
    expect(sendablePeaks([-5, 12.4, 99.6, 140, Number.NaN])).toEqual([0, 12, 100, 100, 0])
    const long = Array.from({ length: 96 }, (_, i) => i)
    const thinned = sendablePeaks(long)
    expect(thinned).toHaveLength(48)
    expect(thinned.slice(0, 3)).toEqual([0, 2, 4])
    expect(sendablePeaks([])).toEqual([])
  })

  it('keeps a signed URL for four of its five minutes', () => {
    expect(VOICE_URL_SECONDS).toBe(300)
    expect(VOICE_URL_REUSE_MS).toBe(240_000)
  })
})

describe('where the sound is', () => {
  it('names the object after the read, the author, the client id and the type: the name the database works out', () => {
    expect(voicePath(READ, ADA, CLIENT, 'audio/mp4')).toBe(`${READ}/${ADA}/${CLIENT}.m4a`)
    expect(voicePath(READ, ADA, CLIENT, 'audio/webm')).toBe(`${READ}/${ADA}/${CLIENT}.webm`)
    expect(voicePath(READ, ADA, CLIENT, 'audio/ogg')).toBe(`${READ}/${ADA}/${CLIENT}.ogg`)
  })

  it('reads a type off a name, and nothing off any other', () => {
    expect(mimeOfPath('a/b/c.m4a')).toBe('audio/mp4')
    expect(mimeOfPath('a/b/c.webm')).toBe('audio/webm')
    expect(mimeOfPath('a/b/c.ogg')).toBe('audio/ogg')
    expect(mimeOfPath('a/b/c.mp3')).toBeNull()
    expect(mimeOfPath(null)).toBeNull()
  })

  it('takes the name from the row, and works it out from the ids for a live event, which carries none', () => {
    const ids = { readId: READ, authorId: ADA, clientId: CLIENT }
    expect(voiceFromJson({ path: 'row/path.m4a', mime: 'audio/mp4', duration_ms: 5400, peaks: [1, 2] }, ids)).toEqual({ path: 'row/path.m4a', mime: 'audio/mp4', durationMs: 5400, peaks: [1, 2] })
    expect(voiceFromJson({ mime: 'audio/webm', duration_ms: 2000, peaks: null }, ids)).toEqual({ path: `${READ}/${ADA}/${CLIENT}.webm`, mime: 'audio/webm', durationMs: 2000, peaks: [] })
    expect(voiceFromJson({ mime: 'audio/webm', duration_ms: 2000 }, { readId: READ, authorId: null, clientId: CLIENT })?.path).toBeNull()
    expect(voiceFromJson({ mime: 'audio/mpeg', duration_ms: 2000 }, ids)).toBeNull()
    expect(voiceFromJson(null, ids)).toBeNull()
  })

  it('says what a failed upload was: no answer is offline, a refusal of the bucket\'s policy a read she is not in, a big file its own', () => {
    expect(mapVoiceStorageError({ name: 'StorageUnknownError', message: 'fetch failed' })).toBe('offline')
    expect(mapVoiceStorageError({ message: 'new row violates row-level security policy', statusCode: '403' })).toBe('not_found')
    expect(mapVoiceStorageError({ message: 'The object exceeded the maximum allowed size', statusCode: '413' })).toBe('message_voice_too_large')
    expect(mapVoiceStorageError({ message: 'mime type audio/mpeg is not supported', statusCode: '415' })).toBe('message_voice_invalid')
    expect(mapVoiceStorageError({ message: 'boom', statusCode: '500' })).toBe('unknown')
  })
})

describe('a voice message from a row, a live event and the line', () => {
  const row = {
    id: 'm1',
    section_id: null,
    author: { id: ADA, name: 'Ada' },
    client_id: CLIENT,
    kind: 'voice',
    body: '',
    media_url: null,
    media_width: null,
    media_height: null,
    voice: { path: `${READ}/${ADA}/${CLIENT}.m4a`, mime: 'audio/mp4', duration_ms: 5400, peaks: [10, 40, 100] },
    reply_to: null,
    spoiler: false,
    created_at: '2026-11-14T10:00:00.000000+00:00',
    deleted_at: null,
    reactions: [],
  }

  it('reads a row: no words, a voice, no URL anywhere', () => {
    const message = messageFromJson(READ, row)
    expect(message).toMatchObject({ kind: 'voice', body: '', voice: { path: `${READ}/${ADA}/${CLIENT}.m4a`, mime: 'audio/mp4', durationMs: 5400, peaks: [10, 40, 100] } })
    expect(JSON.stringify(message)).not.toMatch(/https?:|token/)
  })

  it('reads a live event: the type, the length and the waveform, and the name worked out from the ids', () => {
    const event = parseBuddyEvent('message.new', {
      id: 'm1',
      buddy_read_id: READ,
      section_id: null,
      author_id: ADA,
      client_id: CLIENT,
      kind: 'voice',
      body: '',
      media_url: null,
      media_width: null,
      media_height: null,
      voice: { mime: 'audio/webm', duration_ms: 2000, peaks: [5, 6] },
      reply_to: null,
      spoiler: false,
      created_at: '2026-11-14T10:00:00.000000+00:00',
    })
    expect(event).toMatchObject({ type: 'message', message: { kind: 'voice', voice: { path: `${READ}/${ADA}/${CLIENT}.webm`, mime: 'audio/webm', durationMs: 2000, peaks: [5, 6] } } })
  })

  it('makes a queue item of a recording that carries only its type, length and waveform, never the sound', () => {
    const job = voiceJob({ conversationId: READ, threadId: 's1', clientId: CLIENT, replyTo: 'm0', spoiler: true, createdAt: '2026-11-14T10:00:00.000Z' }, { mime: 'audio/mp4', durationMs: 5400, peaks: [1, 2, 3] })
    expect(job).toMatchObject({ kind: 'voice', body: '', replyTo: 'm0', spoiler: true, threadId: 's1', media: { mime: 'audio/mp4', durationMs: 5400, peaks: [1, 2, 3] } })
    // It survives the device's storage as JSON, which is how the line keeps it across a reload.
    expect(voiceOfJob(JSON.parse(JSON.stringify(job)))).toEqual({ mime: 'audio/mp4', durationMs: 5400, peaks: [1, 2, 3] })
    expect(voiceOfJob({ ...job, kind: 'text' })).toBeNull()
    expect(voiceOfJob({ ...job, media: { mime: 'audio/mpeg', durationMs: 1, peaks: [] } })).toBeNull()
    expect(voiceOfJob({ ...job, media: null })).toBeNull()
  })

  it('shows the recording on its way as her voice bubble, with the name its object will have', () => {
    const job = voiceJob({ conversationId: READ, threadId: null, clientId: CLIENT, replyTo: null, spoiler: false, createdAt: '2026-11-14T10:00:00.000Z' }, { mime: 'audio/webm', durationMs: 2000, peaks: [9] })
    const bubble = pendingBubble(job, ADA, 'Ada')
    expect(bubble).toMatchObject({ kind: 'voice', body: '', state: 'sending', senderId: ADA, voice: { path: `${READ}/${ADA}/${CLIENT}.webm`, durationMs: 2000 }, media: { kind: 'voice' } })
  })

  it('makes a tombstone of a voice message with no sound left on it', () => {
    const bubble = sentBubble(messageFromJson(READ, row))
    expect(tombstoneOf(bubble, '2026-11-14T11:00:00.000Z')).toMatchObject({ kind: 'text', body: '', media: null, voice: null, deletedAt: '2026-11-14T11:00:00.000Z' })
  })
})

describe('how the thread draws a voice message', () => {
  const ctx = (over: Partial<ThreadContext> = {}): ThreadContext => ({
    me: ADA,
    open: true,
    revealed: new Set(),
    nameOf: (id) => (id === ADA ? 'Ada' : id === BEN ? 'Ben' : null),
    errorWord: (code) => `error:${code}`,
    previewOf: () => null,
    voiceLabel: 'Voice message',
    ...over,
  })
  const voice = (over: Partial<BuddyBubble> = {}): BuddyBubble => ({
    ...sentBubble(
      messageFromJson(READ, {
        id: 'm1', section_id: 's1', author: { id: BEN, name: 'Ben' }, client_id: CLIENT, kind: 'voice', body: '', media_url: null, media_width: null, media_height: null,
        voice: { path: `${READ}/${BEN}/${CLIENT}.m4a`, mime: 'audio/mp4', duration_ms: 5400, peaks: [10, 40, 100] },
        reply_to: null, spoiler: false, created_at: '2026-11-14T10:00:00.000000+00:00', deleted_at: null, reactions: [],
      }),
    ),
    ...over,
  })

  it('is the base\'s voice bubble: kind media, its length and waveform, and no URL but the placeholder: nothing was signed', () => {
    const [item] = threadItems([voice()], ctx())
    expect(item).toMatchObject({
      kind: 'media',
      body: '',
      voice: true,
      removed: false,
      veiled: false,
      media: { kind: 'voice', url: VOICE_UNSIGNED, path: `${READ}/${BEN}/${CLIENT}.m4a`, mime: 'audio/mp4', durationMs: 5400, peaks: [10, 40, 100], removed: false },
    })
    expect(item!.media!.url).not.toMatch(/^https?:/)
  })

  it('plays her own recording from the device\'s copy, which is no URL of the server\'s either', () => {
    const [item] = threadItems([voice({ senderId: ADA })], ctx({ previewOf: (clientId) => (clientId === CLIENT ? 'blob:local' : null) }))
    expect(item).toMatchObject({ mine: true, media: { url: 'blob:local' } })
  })

  it('draws a voice message marked Spoiler as a veiled bubble with no sound, until she taps it', () => {
    const veiled = threadItems([voice({ spoiler: true })], ctx())[0]!
    expect(veiled).toMatchObject({ kind: 'text', veiled: true, voice: true, media: null, body: 'Voice message' })
    const revealed = threadItems([voice({ spoiler: true })], ctx({ revealed: new Set([CLIENT]) }))[0]!
    expect(revealed).toMatchObject({ kind: 'media', veiled: false, media: { kind: 'voice' } })
    // Her own is never veiled from her.
    expect(threadItems([voice({ spoiler: true, senderId: ADA })], ctx())[0]).toMatchObject({ kind: 'media', veiled: false })
  })

  it('has nothing of a Section that is not open to her, and nothing of a deleted one but the line', () => {
    expect(threadItems([voice()], ctx({ open: false }))).toEqual([])
    const [gone] = threadItems([tombstoneOf(voice(), '2026-11-14T11:00:00.000Z')], ctx())
    expect(gone).toMatchObject({ kind: 'system', removed: true, voice: false, media: null, body: '' })
  })

  it('carries a failed recording with its refusal, for a tap to send again', () => {
    const [item] = threadItems([voice({ senderId: ADA, state: 'failed', error: 'offline' })], ctx())
    expect(item).toMatchObject({ delivery: 'failed', error: 'error:offline', permanent: false })
    expect(threadItems([voice({ senderId: ADA, state: 'failed', error: 'not_found' })], ctx())[0]).toMatchObject({ permanent: true })
  })

  it('quotes a voice message as "Voice message" (it has no words), and a veiled one as the spoiler it is', () => {
    const words = { deleted: 'Deleted', spoiler: 'Spoiler', someone: 'Someone', you: 'You', voice: '🎤 Voice message' }
    const items = threadItems([voice()], ctx())
    expect(quoteOf(items, 'm1', words)).toEqual({ id: 'm1', mine: false, name: 'Ben', preview: '🎤 Voice message' })
    const veiled = threadItems([voice({ spoiler: true })], ctx())
    expect(quoteOf(veiled, 'm1', words)).toMatchObject({ preview: 'Spoiler' })
    const own = threadItems([voice({ senderId: ADA })], ctx())
    expect(quoteOf(own, 'm1', words)).toMatchObject({ mine: true, name: 'You', preview: '🎤 Voice message' })
  })
})

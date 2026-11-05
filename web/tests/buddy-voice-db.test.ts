import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VOICE_BUCKET, VOICE_MAX_BYTES, VOICE_URL_SECONDS, voicePath } from '@/data/buddyVoice'
import { removedNames, sweep } from '../../supabase/functions/buddy-voice-sweep/sweep'
import { buddyOf, joinRead, startRead } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'
import { serviceRoleKey, sql, stack } from './support/stack'

/**
 * Voice messages through the repository and the real Storage API on the local stack (data/buddyVoice.ts and the voice calls of data/buddyReads.ts; the
 * rules are pgTAP's, supabase/tests/buddy_voice_test.sql). What this keeps: a recording is stored under her own folder and posted, another member of
 * the read signs a short-lived URL for it and gets the bytes, a member who is not in the read, who left or who is blocked with the author gets nothing, a deleted
 * message, a member who left with her messages, a deleted account all queue their audio and the Edge Function's sweep (its own pure module, run here against the
 * real service role) removes it: the object is gone from the bucket. Fixtures carry the run's tag (tests/support/buddy.ts).
 */

const M4A = readFileSync(new URL('./fixtures/voice.m4a', import.meta.url))
const WEBM = readFileSync(new URL('./fixtures/voice.webm', import.meta.url))
const asBlob = (bytes: Buffer, type: string) => new Blob([new Uint8Array(bytes)], { type })

let service: SupabaseClient
let host: TestMember
let ben: TestMember
let cy: TestMember
let dee: TestMember
let outsider: TestMember
let read: { id: string; linkToken: string | null }
let section: string

/** The service role's sweep, as the Edge Function runs it: the database names the objects, Storage removes them. */
async function runSweep() {
  return sweep({
    batch: async (limit) => ((await service.rpc('buddy_voice_sweep_batch', { p_limit: limit })).data as string[] | null) ?? [],
    remove: async (paths) => removedNames((await service.storage.from(VOICE_BUCKET).remove(paths)).data),
    done: async (paths) => void (await service.rpc('buddy_voice_sweep_done', { p_paths: paths })),
  })
}

const objectThere = async (path: string) => !(await service.storage.from(VOICE_BUCKET).download(path)).error

/** Stores the fixture as the member and posts it; the stored message. */
async function say(member: TestMember, over: { sectionId?: string | null; replyTo?: string | null; spoiler?: boolean } = {}) {
  const repo = buddyOf(member)
  const clientId = crypto.randomUUID()
  const stored = await repo.uploadVoice(read.id, member.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
  expect(stored.error).toBeNull()
  const sent = await repo.sendVoice({ readId: read.id, sectionId: over.sectionId === undefined ? section : over.sectionId, clientId, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [10, 50, 100, 40] }, replyTo: over.replyTo, spoiler: over.spoiler })
  expect(sent.error).toBeNull()
  return { clientId, path: stored.data!, message: sent.data! }
}

beforeAll(async () => {
  service = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  ;[host, ben, cy, dee, outsider] = await Promise.all([signUpMember(), signUpMember(), signUpMember(), signUpMember(), signUpMember()])
  read = await startRead(host, { title: 'Voice Flow', parts: 2 })
  for (const member of [ben, cy, dee]) await joinRead(member, read.linkToken!)
  section = (await buddyOf(host).read(read.id)).data!.chapters[0]!.id
})

afterAll(async () => {
  // What this file left in the bucket goes the way it goes in the app.
  await runSweep()
})

describe('sending a recording', () => {
  it('stores it under her own folder of the read, posts it, and answers it as a voice message with no URL anywhere', async () => {
    const { clientId, path, message } = await say(host)
    expect(path).toBe(voicePath(read.id, host.id, clientId, 'audio/mp4'))
    expect(message).toMatchObject({ kind: 'voice', body: '', threadId: section, clientId, voice: { path, mime: 'audio/mp4', durationMs: 2_000, peaks: [10, 50, 100, 40] } })
    expect(JSON.stringify(message)).not.toMatch(/https?:/)
    // A retry of the same send answers the message it made, whatever the retry says about it.
    const again = await buddyOf(host).sendVoice({ readId: read.id, sectionId: section, clientId, media: { mime: 'audio/mp4', durationMs: 999, peaks: [] } })
    expect(again.data?.id).toBe(message.id)
    // And the upload of the same send again is as good as stored.
    const twice = await buddyOf(host).uploadVoice(read.id, host.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect(twice).toEqual({ data: path, error: null })
  })

  it('takes a webm recording as well, and an answer, and a Spoiler mark', async () => {
    const repo = buddyOf(ben)
    const first = await say(host)
    const clientId = crypto.randomUUID()
    expect((await repo.uploadVoice(read.id, ben.id, clientId, asBlob(WEBM, 'audio/webm'), 'audio/webm')).error).toBeNull()
    const sent = await repo.sendVoice({ readId: read.id, sectionId: section, clientId, media: { mime: 'audio/webm', durationMs: 2_000, peaks: [] }, replyTo: first.message.id, spoiler: true })
    expect(sent.data).toMatchObject({ kind: 'voice', replyTo: first.message.id, spoiler: true, voice: { mime: 'audio/webm', path: `${read.id}/${ben.id}/${clientId}.webm` } })
  })

  it('refuses what the database refuses: an object that is not there, a type that is not its object\'s, a Section of nowhere', async () => {
    const repo = buddyOf(ben)
    expect((await repo.sendVoice({ readId: read.id, sectionId: section, clientId: crypto.randomUUID(), media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBe('message_voice_missing')
    const clientId = crypto.randomUUID()
    await repo.uploadVoice(read.id, ben.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect((await repo.sendVoice({ readId: read.id, sectionId: section, clientId, media: { mime: 'audio/mp4', durationMs: 120_001, peaks: [] } })).error).toBe('message_voice_invalid')
    expect((await repo.sendVoice({ readId: read.id, sectionId: crypto.randomUUID(), clientId, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBe('buddy_section_invalid')
  })

  it('refuses the bucket\'s own rules: another member\'s folder, a stranger to the read, a type that is no recording, a file over 3 MB', async () => {
    const id = crypto.randomUUID()
    const bucket = ben.client.storage.from(VOICE_BUCKET)
    const elsewhere = await bucket.upload(`${read.id}/${host.id}/${id}.m4a`, asBlob(M4A, 'audio/mp4'), { contentType: 'audio/mp4' })
    expect(elsewhere.error).toBeTruthy()
    const stranger = await buddyOf(outsider).uploadVoice(read.id, outsider.id, crypto.randomUUID(), asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect(stranger).toEqual({ data: null, error: 'not_found' })
    const mp3 = await bucket.upload(`${read.id}/${ben.id}/${crypto.randomUUID()}.m4a`, asBlob(M4A, 'audio/mpeg'), { contentType: 'audio/mpeg' })
    expect(mp3.error).toBeTruthy()
    const big = await bucket.upload(`${read.id}/${ben.id}/${crypto.randomUUID()}.m4a`, new Blob([new Uint8Array(VOICE_MAX_BYTES + 1)], { type: 'audio/mp4' }), { contentType: 'audio/mp4' })
    expect(big.error).toBeTruthy()
    const big2 = await buddyOf(ben).uploadVoice(read.id, ben.id, crypto.randomUUID(), new Blob([new Uint8Array(VOICE_MAX_BYTES + 1)], { type: 'audio/mp4' }), 'audio/mp4')
    expect(big2.error).toBe('message_voice_too_large')
  })
})

describe('the type the object is stored with', () => {
  it('is the bare type: a recorder\'s blob that names its codec is wrapped, and Storage keeps what it is sent', async () => {
    const repo = buddyOf(ben)
    const clientId = crypto.randomUUID()
    // What `MediaRecorder` hands over in Chrome and on Android.
    const recorded = asBlob(WEBM, 'audio/webm;codecs=opus')
    expect(recorded.type).toBe('audio/webm;codecs=opus')
    const stored = await repo.uploadVoice(read.id, ben.id, clientId, recorded, 'audio/webm')
    expect(stored.error).toBeNull()
    const [object] = await sql<{ mimetype: string; cache: string }>(
      `select metadata ->> 'mimetype' as mimetype, metadata ->> 'cacheControl' as cache from storage.objects where bucket_id = 'buddy-voice' and name = $1`,
      [stored.data],
    )
    expect(object!.mimetype).toBe('audio/webm')
    // A deleted recording must not stay in a browser's cache.
    expect(object!.cache).toBe('max-age=0')
    // And the post is accepted (the database compares the type without its parameters in any case).
    const sent = await repo.sendVoice({ readId: read.id, sectionId: section, clientId, media: { mime: 'audio/webm', durationMs: 2_000, peaks: [] } })
    expect(sent.error).toBeNull()
  })

  it('is refused by the bucket when it is no recording at all, with or without a codec', async () => {
    const bucket = ben.client.storage.from(VOICE_BUCKET)
    for (const type of ['audio/mpeg', 'audio/mpeg;codecs=mp3', 'image/png']) {
      const refused = await bucket.upload(`${read.id}/${ben.id}/${crypto.randomUUID()}.m4a`, asBlob(M4A, type), { contentType: type })
      expect(refused.error, type).toBeTruthy()
    }
  })
})

describe('hearing it', () => {
  it('gives a member of the read a URL that lives five minutes and plays the bytes that were recorded; the page of the thread carries none', async () => {
    const { path, message } = await say(host)
    const page = await buddyOf(ben).messages(read.id, section)
    const row = page.data!.items.find((m) => m.id === message.id)!
    expect(row.voice?.path).toBe(path)
    expect(JSON.stringify(row)).not.toMatch(/https?:|token/)
    const signed = await buddyOf(ben).voiceUrl(path)
    expect(signed.error).toBeNull()
    const url = new URL(signed.data!)
    expect(url.pathname).toContain('/object/sign/buddy-voice/')
    const claims = JSON.parse(Buffer.from(url.searchParams.get('token')!.split('.')[1]!, 'base64url').toString()) as { exp: number; iat?: number }
    const lives = claims.exp - Math.floor(Date.now() / 1000)
    expect(lives).toBeGreaterThan(VOICE_URL_SECONDS - 30)
    expect(lives).toBeLessThanOrEqual(VOICE_URL_SECONDS)
    const response = await fetch(signed.data!)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('audio/mp4')
    expect(Buffer.from(await response.arrayBuffer()).equals(M4A)).toBe(true)
    // Her own, too.
    expect((await buddyOf(host).voiceUrl(path)).error).toBeNull()
  })

  it('gives a stranger to the read nothing, and so a member who left, until she is gone from it', async () => {
    const { path } = await say(host)
    expect((await buddyOf(outsider).voiceUrl(path)).error).toBeTruthy()
    const anon = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } })
    expect((await anon.storage.from(VOICE_BUCKET).createSignedUrl(path, 60)).error).toBeTruthy()
    expect((await anon.storage.from(VOICE_BUCKET).download(path)).error).toBeTruthy()
    // The bucket is private: there is no public address for it.
    const publicUrl = anon.storage.from(VOICE_BUCKET).getPublicUrl(path).data.publicUrl
    expect((await fetch(publicUrl)).status).not.toBe(200)
    // Members hear a message of one who left; the one who left hears nothing of the read.
    const left = await say(dee)
    expect((await buddyOf(dee).leave(read.id)).error).toBeNull()
    expect((await buddyOf(dee).voiceUrl(left.path)).error).toBeTruthy()
    expect((await buddyOf(ben).voiceUrl(left.path)).error).toBeNull()
  })

  it('gives a member blocked with the author nothing, both ways, and the others still hear her', async () => {
    const blocker = await signUpMember()
    await joinRead(blocker, read.linkToken!)
    const { path } = await say(host)
    expect((await buddyOf(blocker).voiceUrl(path)).error).toBeNull()
    expect((await blocker.client.rpc('block', { p_member: host.id })).error).toBeNull()
    expect((await buddyOf(blocker).voiceUrl(path)).error).toBeTruthy()
    expect((await buddyOf(ben).voiceUrl(path)).error).toBeNull()
  })

  it('asks nothing of anyone when it is offline', async () => {
    const { path } = await say(host)
    const offline = (await import('@/data/buddyReads')).createBuddyReads(ben.client, { online: () => false })
    expect(await offline.voiceUrl(path)).toEqual({ data: null, error: 'offline' })
    expect(await offline.uploadVoice(read.id, ben.id, crypto.randomUUID(), asBlob(M4A, 'audio/mp4'), 'audio/mp4')).toEqual({ data: null, error: 'offline' })
  })
})

describe('no audio outlives its message', () => {
  it('queues the object of a deleted message, shows a tombstone with nothing to play, and the sweep removes the object', async () => {
    const { path, message } = await say(ben)
    expect(await objectThere(path)).toBe(true)
    expect((await buddyOf(ben).deleteMessage(message.id)).error).toBeNull()
    const page = (await buddyOf(cy).messages(read.id, section)).data!.items.find((m) => m.id === message.id)!
    expect(page).toMatchObject({ kind: 'text', body: '', voice: null, media: null })
    expect((await buddyOf(cy).voiceUrl(path)).error).toBeTruthy()
    await runSweep()
    expect(await objectThere(path)).toBe(false)
    expect(((await service.rpc('buddy_voice_sweep_batch', { p_limit: 500 })).data as string[]).includes(path)).toBe(false)
  })

  it('lets the host delete another member\'s recording', async () => {
    const { path, message } = await say(cy)
    expect((await buddyOf(host).deleteMessage(message.id)).error).toBeNull()
    await runSweep()
    expect(await objectThere(path)).toBe(false)
  })

  it('removes the recordings of a member who leaves choosing to delete her messages, and keeps those of one who does not', async () => {
    const leaver = await signUpMember()
    await joinRead(leaver, read.linkToken!)
    const mine = await say(leaver)
    expect((await buddyOf(leaver).leave(read.id, true)).error).toBeNull()
    await runSweep()
    expect(await objectThere(mine.path)).toBe(false)
    const stays = await signUpMember()
    await joinRead(stays, read.linkToken!)
    const kept = await say(stays)
    expect((await buddyOf(stays).leave(read.id, false)).error).toBeNull()
    await runSweep()
    expect(await objectThere(kept.path)).toBe(true)
  })

  it('removes the recordings of an account that is deleted', async () => {
    const goner = await signUpMember()
    await joinRead(goner, read.linkToken!)
    const mine = await say(goner)
    expect((await goner.client.rpc('delete_my_account')).error).toBeNull()
    await runSweep()
    expect(await objectThere(mine.path)).toBe(false)
  })

  it('removes an upload that never became a message once it is a day old, and not before', async () => {
    const clientId = crypto.randomUUID()
    const stored = await buddyOf(ben).uploadVoice(read.id, ben.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    await runSweep()
    expect(await objectThere(stored.data!)).toBe(true)
    const grace = await service.rpc('buddy_voice_sweep_batch', { p_limit: 500, p_grace: '0 seconds' })
    expect((grace.data as string[]).includes(stored.data!)).toBe(true)
  })
})

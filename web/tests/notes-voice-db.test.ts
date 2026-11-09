import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VOICE_MAX_BYTES, VOICE_URL_SECONDS } from '@/data/buddyVoice'
import { createNotes, type NoteMessage, type Notes } from '@/data/notes'
import { NOTE_VOICE_BUCKET, notePath } from '@/data/noteVoice'
import { createLibrary } from '../app/data/library'
import { itemsOf, removeFromBuckets, sweep } from '../../supabase/functions/buddy-voice-sweep/sweep'
import { catalogueEdition, follows } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'
import { serviceRoleKey, sql, stack } from './support/stack'

/**
 * Voice notes through the repository and the real Storage API on the local stack (data/notes.ts, data/noteVoice.ts; the rules are pgTAP's,
 * supabase/tests/notes_private_voice_test.sql). Every call is its own transaction through supabase-js as a signed-in member, so what has to commit as the role
 * `authenticated` does (pgTAP never commits). What this keeps: a recording is stored in her own folder of the private bucket `note-voice` and posted as a private
 * voice note; she signs a short-lived URL for it and gets the bytes; **nobody else** (a mutual friend, a member of Everyone, a stranger without the Book, a member
 * blocked with her, a signed-out caller) gets the note in a thread, a count, a URL or the bytes; it can never be widened; and a deleted note, an owner's removal and
 * a deleted account queue the audio, which the Edge Function's sweep (its own pure module, run here against the real service role) removes: the object is gone
 * from the bucket. Fixtures carry the run's tag (tests/support/buddy.ts).
 */

const M4A = readFileSync(new URL('./fixtures/voice.m4a', import.meta.url))
const WEBM = readFileSync(new URL('./fixtures/voice.webm', import.meta.url))
const asBlob = (bytes: Buffer, type: string) => new Blob([new Uint8Array(bytes)], { type })

let service: SupabaseClient
let mia: TestMember
let kai: TestMember
let pia: TestMember
let sam: TestMember
let bo: TestMember
let owner: TestMember
let before: { owner: string | null; on: boolean }
let bookId: string
let room: string
let chapter: string
let wholeBook: string

const notesOf = (member: TestMember): Notes => createNotes(member.client)

/** The service role's sweep, as the Edge Function runs it: the database names the objects (of both buckets), Storage removes them. */
async function runSweep() {
  return sweep({
    batch: async (limit) => itemsOf((await service.rpc('voice_sweep_batch', { p_limit: limit })).data),
    remove: (items) => removeFromBuckets(items, async (bucket, paths) => await service.storage.from(bucket).remove(paths)),
    done: async (items) => void (await service.rpc('voice_sweep_done', { p_items: items })),
  })
}

const objectThere = async (path: string) => !(await service.storage.from(NOTE_VOICE_BUCKET).download(path)).error

/** The voice ledger allows 10 a note a minute (the caps are pgTAP's, supabase/tests/notes_private_voice_test.sql): each seeded note starts from a clean one. */
const clearVoice = (memberId: string) => sql(`delete from private.note_calls where member_id = $1 and kind in ('voice', 'voice_day')`, [memberId])

/** Stores the fixture as the member and posts it; the stored note. */
async function say(member: TestMember, over: { sectionId?: string; replyTo?: string | null; mime?: 'audio/mp4' | 'audio/webm' } = {}) {
  const repo = notesOf(member)
  await clearVoice(member.id)
  const clientId = crypto.randomUUID()
  const mime = over.mime ?? 'audio/mp4'
  const stored = await repo.uploadVoice(room, member.id, clientId, asBlob(mime === 'audio/mp4' ? M4A : WEBM, mime), mime)
  expect(stored.error).toBeNull()
  const sent = await repo.sendVoice({ roomId: room, sectionId: over.sectionId ?? chapter, clientId, path: stored.data!, media: { mime, durationMs: 2_000, peaks: [10, 50, 100, 40] }, replyTo: over.replyTo })
  expect(sent.error).toBeNull()
  return { clientId, path: stored.data!, note: sent.data! as NoteMessage }
}

const thread = async (member: TestMember, sectionId = chapter) => (await notesOf(member).messages(room, sectionId)).data!.items

beforeAll(async () => {
  service = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  ;[mia, kai, pia, sam, bo, owner] = await Promise.all([signUpMember(), signUpMember(), signUpMember(), signUpMember(), signUpMember(), signUpMember()])
  await follows(mia, kai)
  await follows(kai, mia)
  before = {
    owner: (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null,
    on: (await sql<{ on: boolean }>('select public_enabled as on from private.notes_settings'))[0]?.on ?? false,
  }
  await sql('update private.instance_owner set owner_id = $1', [owner.id])
  await sql('update private.notes_settings set public_enabled = true')
  const book = catalogueEdition('Notes in her own voice')
  for (const member of [mia, kai, pia, bo]) {
    const added = await createLibrary(member.client).addToLibrary(book)
    if (added.error || !added.data) throw new Error(`Fixture failed: ${String(added.error)}`)
    bookId = added.data.book.id
  }
  const page = await notesOf(mia).setChapters(bookId, 4)
  if (page.error || !page.data?.room) throw new Error('Fixture failed: no chapters')
  room = page.data.room.id
  chapter = page.data.room.chapters.find((c) => c.position === 1)!.id
  wholeBook = page.data.room.chapters.find((c) => c.kind === 'end')!.id
  for (const member of [kai, pia, bo]) await notesOf(member).setChapter(room, 4)
  // Bo and Mia are blocked with each other.
  await sql('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [mia.id, bo.id])
})

afterAll(async () => {
  await runSweep()
  await sql('update private.instance_owner set owner_id = $1', [before.owner])
  await sql('update private.notes_settings set public_enabled = $1', [before.on])
})

describe('saying it', () => {
  it('stores it in her own folder of the private bucket, posts it as a private voice note, and answers it with no URL anywhere', async () => {
    const { clientId, path, note } = await say(mia)
    expect(path).toBe(notePath(mia.id, room, clientId, 'audio/mp4'))
    expect(note).toMatchObject({ kind: 'voice', body: '', threadId: chapter, clientId, visibility: 'private', effectiveVisibility: 'private', voice: { path, mime: 'audio/mp4', durationMs: 2_000, peaks: [10, 50, 100, 40] } })
    expect(JSON.stringify(note)).not.toMatch(/https?:/)
    // A retry of the same send answers the note it made, whatever the retry says about it.
    const again = await notesOf(mia).sendVoice({ roomId: room, sectionId: chapter, clientId, path, media: { mime: 'audio/mp4', durationMs: 999, peaks: [] } })
    expect(again.data?.id).toBe(note.id)
    // And the upload of the same send again is as good as stored.
    expect(await notesOf(mia).uploadVoice(room, mia.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')).toEqual({ data: path, error: null })
    // It is in her thread, as a voice note.
    expect((await thread(mia)).find((n) => n.id === note.id)).toMatchObject({ kind: 'voice', voice: { path } })
  })

  it('takes a webm recording, and an answer to her own private note, and a text answer to a voice note', async () => {
    const repo = notesOf(mia)
    const text = await repo.post({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), body: 'a private thought', visibility: 'private' })
    const spoken = await say(mia, { mime: 'audio/webm', replyTo: text.data!.id })
    expect(spoken.note).toMatchObject({ kind: 'voice', voice: { mime: 'audio/webm', path: `${mia.id}/${room}/${spoken.clientId}.webm` }, quote: { kind: 'note', voice: false } })
    const answer = await repo.post({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), body: 'and a text answer', visibility: 'private', replyTo: spoken.note.id })
    expect(answer.data?.quote).toMatchObject({ kind: 'note', id: spoken.note.id, voice: true, excerpt: '' })
    // A friends answer would be wider than the voice note it answers.
    expect((await repo.post({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), body: 'wide', visibility: 'friends', replyTo: spoken.note.id })).error).toBe('note_wider_than_parent')
  })

  it('refuses what the database refuses: an object that is not there, a length that is none, a reply to a note that is not hers or not private', async () => {
    const repo = notesOf(mia)
    const missing = crypto.randomUUID()
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId: missing, path: notePath(mia.id, room, missing, 'audio/mp4'), media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBe('voice_missing')
    const clientId = crypto.randomUUID()
    const stored = await repo.uploadVoice(room, mia.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId, path: stored.data!, media: { mime: 'audio/mp4', durationMs: 120_001, peaks: [] } })).error).toBe('voice_invalid')
    // Not her object's name.
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId, path: notePath(kai.id, room, clientId, 'audio/mp4'), media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBe('voice_invalid')
    // A friends note of her own, and a friend's.
    const friends = (await repo.post({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), body: 'for friends', visibility: 'friends' })).data!
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId, path: stored.data!, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] }, replyTo: friends.id })).error).toBe('reply_not_visible')
    const theirs = (await notesOf(kai).post({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), body: 'Kai for friends', visibility: 'friends' })).data!
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId, path: stored.data!, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] }, replyTo: theirs.id })).error).toBe('reply_not_visible')
    // And for the good send, the same object posts.
    expect((await repo.sendVoice({ roomId: room, sectionId: chapter, clientId, path: stored.data!, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBeNull()
  })

  it('refuses the bucket\'s own rules: another member\'s folder, a room she has no Book for, a type that is no recording, a file over 3 MB', async () => {
    const bucket = mia.client.storage.from(NOTE_VOICE_BUCKET)
    const elsewhere = await bucket.upload(`${kai.id}/${room}/${crypto.randomUUID()}.m4a`, asBlob(M4A, 'audio/mp4'), { contentType: 'audio/mp4' })
    expect(elsewhere.error).toBeTruthy()
    const nobook = await notesOf(sam).uploadVoice(room, sam.id, crypto.randomUUID(), asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect(nobook).toEqual({ data: null, error: 'not_found' })
    const noroom = await bucket.upload(`${mia.id}/${crypto.randomUUID()}/${crypto.randomUUID()}.m4a`, asBlob(M4A, 'audio/mp4'), { contentType: 'audio/mp4' })
    expect(noroom.error).toBeTruthy()
    const mp3 = await bucket.upload(`${mia.id}/${room}/${crypto.randomUUID()}.m4a`, asBlob(M4A, 'audio/mpeg'), { contentType: 'audio/mpeg' })
    expect(mp3.error).toBeTruthy()
    const big = await notesOf(mia).uploadVoice(room, mia.id, crypto.randomUUID(), new Blob([new Uint8Array(VOICE_MAX_BYTES + 1)], { type: 'audio/mp4' }), 'audio/mp4')
    expect(big.error).toBe('voice_too_large')
  })

  it('asks nothing of anyone when it is offline', async () => {
    const { path } = await say(mia)
    const offline = createNotes(mia.client, { online: () => false })
    expect(await offline.voiceUrl(path)).toEqual({ data: null, error: 'offline' })
    expect(await offline.uploadVoice(room, mia.id, crypto.randomUUID(), asBlob(M4A, 'audio/mp4'), 'audio/mp4')).toEqual({ data: null, error: 'offline' })
    expect((await offline.sendVoice({ roomId: room, sectionId: chapter, clientId: crypto.randomUUID(), path, media: { mime: 'audio/mp4', durationMs: 1000, peaks: [] } })).error).toBe('offline')
  })
})

describe('hearing it: only the one who said it', () => {
  it('gives her a URL that lives five minutes and plays the bytes that were recorded; the page of the thread carries none', async () => {
    const { path, note } = await say(mia)
    const row = (await thread(mia)).find((n) => n.id === note.id)!
    expect(row.voice?.path).toBe(path)
    expect(JSON.stringify(row)).not.toMatch(/https?:|token/)
    const signed = await notesOf(mia).voiceUrl(path)
    expect(signed.error).toBeNull()
    const url = new URL(signed.data!)
    expect(url.pathname).toContain(`/object/sign/${NOTE_VOICE_BUCKET}/`)
    const claims = JSON.parse(Buffer.from(url.searchParams.get('token')!.split('.')[1]!, 'base64url').toString()) as { exp: number }
    const lives = claims.exp - Math.floor(Date.now() / 1000)
    expect(lives).toBeGreaterThan(VOICE_URL_SECONDS - 30)
    expect(lives).toBeLessThanOrEqual(VOICE_URL_SECONDS)
    const response = await fetch(signed.data!)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('audio/mp4')
    expect(Buffer.from(await response.arrayBuffer()).equals(M4A)).toBe(true)
  })

  it('gives a mutual friend, a member of Everyone, a stranger, a blocked member and a signed-out caller nothing: no note, no count, no URL, no bytes', async () => {
    const { path, note } = await say(mia)
    // Her friends note in another chapter, so there is something she may see.
    await notesOf(mia).post({ roomId: room, sectionId: wholeBook, clientId: crypto.randomUUID(), body: 'for friends', visibility: 'friends' })
    const anon = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } })
    for (const member of [kai, pia, sam, bo, owner]) {
      expect((await thread(member)).some((n) => n.id === note.id || n.voice !== null || n.kind === 'voice'), member.email).toBe(false)
      expect(JSON.stringify(await thread(member))).not.toContain(path)
      expect((await notesOf(member).voiceUrl(path)).error, member.email).toBeTruthy()
      expect((await member.client.storage.from(NOTE_VOICE_BUCKET).download(path)).error, member.email).toBeTruthy()
      expect((await notesOf(member).react(note.id, '❤️')).error, member.email).toBe('not_found')
      expect((await notesOf(member).report(note.id, 'spam')).error, member.email).toBe('not_found')
      expect((await notesOf(member).setVisibility(note.id, 'public')).error, member.email).toBe('not_found')
      expect((await notesOf(member).deleteNote(note.id)).error, member.email).toBe('not_found')
    }
    // Counts: the chapter holds Mia's voice notes and some friends notes; her friend counts the friends notes (hers and Kai's) and not one voice note, Everyone counts
    // nothing (no note of the chapter is public), she counts them all. Worked out from the table, past RLS.
    const [{ n: friendsNotes }] = await sql<{ n: number }>(`select count(*)::int as n from public.room_messages where section_id = $1 and deleted_at is null and visibility <> 'private'`, [chapter])
    const [{ n: voiceNotes }] = await sql<{ n: number }>(`select count(*)::int as n from public.room_messages where section_id = $1 and deleted_at is null and kind = 'voice'`, [chapter])
    expect(voiceNotes).toBeGreaterThan(0)
    const counts = async (member: TestMember) => (await notesOf(member).page(bookId)).data!.room!.chapters.find((c) => c.id === chapter)!.count
    expect(await counts(kai)).toBe(friendsNotes)
    expect((await thread(kai)).length).toBe(friendsNotes)
    expect(await counts(pia)).toBe(0)
    expect(await counts(mia)).toBeGreaterThan(friendsNotes)
    // Mia's face is in her friend's chapter only for a note he may see: none of them is a voice note, and a chapter with only voice notes has no face of hers.
    const [{ n: friendsOfMia }] = await sql<{ n: number }>(`select count(*)::int as n from public.room_messages where deleted_at is null and visibility = 'friends' and author_id = $1`, [mia.id])
    expect((await notesOf(kai).summary(bookId)).data!.friends.count).toBe(friendsOfMia)
    expect((await anon.storage.from(NOTE_VOICE_BUCKET).createSignedUrl(path, 60)).error).toBeTruthy()
    expect((await anon.storage.from(NOTE_VOICE_BUCKET).download(path)).error).toBeTruthy()
    // The bucket is private: there is no public address for it.
    const publicUrl = anon.storage.from(NOTE_VOICE_BUCKET).getPublicUrl(path).data.publicUrl
    expect((await fetch(publicUrl)).status).not.toBe(200)
    // The service role (the sweep) can; nobody a member can be reaches it.
    expect((await service.storage.from(NOTE_VOICE_BUCKET).download(path)).error).toBeNull()
  })

  it('cannot be widened: not to Friends, not to Everyone, and Only me again is no change', async () => {
    const { note } = await say(mia)
    expect((await notesOf(mia).setVisibility(note.id, 'friends')).error).toBe('voice_private_only')
    expect((await notesOf(mia).setVisibility(note.id, 'public')).error).toBe('voice_private_only')
    expect((await notesOf(mia).setVisibility(note.id, 'private')).error).toBeNull()
    expect((await thread(kai)).some((n) => n.id === note.id)).toBe(false)
  })

  it('is a bucket nobody browses: a friend lists none of her folder, and not even she sees an upload no note points at', async () => {
    const { clientId, path } = await say(mia)
    const bucket = (member: TestMember) => member.client.storage.from(NOTE_VOICE_BUCKET)
    const folder = `${mia.id}/${room}`
    const namesOf = async (member: TestMember, path = folder) => ((await bucket(member).list(path, { limit: 100 })).data ?? []).map((o) => o.name)
    // Hers: the objects of the voice notes this file gave her, all under the name their notes have, and nothing else.
    const hers = await namesOf(mia)
    expect(hers).toContain(`${clientId}.m4a`)
    expect(hers.every((n) => /^[0-9a-f-]{36}\.(m4a|webm)$/.test(n))).toBe(true)
    // An upload no note points at is invisible to her as well (the policy is the note's, not the folder's).
    const unpostedId = crypto.randomUUID()
    const unposted = await notesOf(mia).uploadVoice(room, mia.id, unpostedId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect(unposted.error).toBeNull()
    expect(await namesOf(mia)).toEqual(hers)
    expect(hers).not.toContain(`${unpostedId}.m4a`)
    // A friend, a member of Everyone, the owner: nothing at all, not even the folder.
    for (const member of [kai, pia, owner]) {
      expect(await namesOf(member), member.email).toEqual([])
      expect(await namesOf(member, ''), member.email).not.toContain(mia.id)
    }
    expect(path).toBe(notePath(mia.id, room, clientId, 'audio/mp4'))
  })

  it('lets nobody but her read, and lets nobody at all change it: remove, move, copy and an overwrite are refused, hers too', async () => {
    const { path } = await say(mia)
    const bucket = (member: TestMember) => member.client.storage.from(NOTE_VOICE_BUCKET)
    for (const member of [mia, kai, pia, owner]) {
      const who = member.email
      // No delete policy (the sweep, through the service role, removes an object): refused, or nothing removed.
      const removed = await bucket(member).remove([path])
      expect(removed.data ?? [], who).toEqual([])
      expect(await objectThere(path), who).toBe(true)
      const moved = await bucket(member).move(path, `${member.id}/${room}/${crypto.randomUUID()}.m4a`)
      expect(moved.error ?? moved.data, who).toBeTruthy()
      const copied = await bucket(member).copy(path, `${member.id}/${room}/${crypto.randomUUID()}.m4a`)
      expect(copied.error ?? copied.data, who).toBeTruthy()
      const overwritten = await bucket(member).upload(path, asBlob(WEBM, 'audio/webm'), { contentType: 'audio/webm', upsert: true })
      expect(overwritten.error, who).toBeTruthy()
    }
    // Still the bytes she recorded, and still hers alone.
    expect(await objectThere(path)).toBe(true)
    expect((await notesOf(mia).voiceUrl(path)).error).toBeNull()
    expect((await notesOf(kai).voiceUrl(path)).error).toBeTruthy()
  })

  it('is not a table anyone reads directly', async () => {
    const table = await kai.client.from('room_messages').select('voice_object').limit(1)
    expect(table.error?.code).toBe('42501')
  })
})

describe('no audio outlives its note', () => {
  it('queues the object of a deleted note, shows a tombstone with nothing to play, and the sweep removes the object', async () => {
    const { path, note } = await say(mia)
    expect(await objectThere(path)).toBe(true)
    expect((await notesOf(mia).deleteNote(note.id)).error).toBeNull()
    expect((await thread(mia)).find((n) => n.id === note.id)).toMatchObject({ kind: 'text', body: '', voice: null })
    expect((await notesOf(mia).voiceUrl(path)).error).toBeTruthy()
    await runSweep()
    expect(await objectThere(path)).toBe(false)
    const queued = await sql<{ n: number }>(`select count(*)::int as n from private.buddy_voice_trash where bucket = 'note-voice' and path = $1`, [path])
    expect(queued[0]!.n).toBe(0)
  })

  it('lets the owner remove it (the tombstone and the object queued)', async () => {
    const { path, note } = await say(mia)
    expect((await notesOf(owner).ownerRemove(note.id, 'test')).error).toBeNull()
    expect((await thread(mia)).find((n) => n.id === note.id)).toMatchObject({ kind: 'text', body: '', voice: null, moderated: true })
    await runSweep()
    expect(await objectThere(path)).toBe(false)
  })

  it('removes the recordings of an account that is deleted', async () => {
    const goner = await signUpMember()
    const book = catalogueEdition('A book for the one who leaves')
    const added = await createLibrary(goner.client).addToLibrary(book)
    const page = await notesOf(goner).setChapters(added.data!.book.id, 2)
    const goneRoom = page.data!.room!.id
    const goneChapter = page.data!.room!.chapters[0]!.id
    const clientId = crypto.randomUUID()
    const stored = await notesOf(goner).uploadVoice(goneRoom, goner.id, clientId, asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    expect((await notesOf(goner).sendVoice({ roomId: goneRoom, sectionId: goneChapter, clientId, path: stored.data!, media: { mime: 'audio/mp4', durationMs: 2_000, peaks: [] } })).error).toBeNull()
    expect(await objectThere(stored.data!)).toBe(true)
    expect((await goner.client.rpc('delete_my_account')).error).toBeNull()
    await runSweep()
    expect(await objectThere(stored.data!)).toBe(false)
  })

  it('removes an upload that never became a note once it is past the grace, and not before; and never an object a note points at', async () => {
    const stored = await notesOf(mia).uploadVoice(room, mia.id, crypto.randomUUID(), asBlob(M4A, 'audio/mp4'), 'audio/mp4')
    await runSweep()
    expect(await objectThere(stored.data!)).toBe(true)
    const kept = await say(mia)
    const grace = await service.rpc('voice_sweep_batch', { p_limit: 500, p_grace: '0 seconds', p_orphans: true })
    const named = itemsOf(grace.data)
    expect(named.some((item) => item.bucket === 'note-voice' && item.path === stored.data)).toBe(true)
    expect(named.some((item) => item.path === kept.path)).toBe(false)
    await runSweep()
    expect(await objectThere(kept.path)).toBe(true)
  })
})

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createNotes, isRetryableNoteError, mapNoteError, NOTE_ERROR_CODES, NOTES_PAGE } from '@/data/notes'
import { sql } from './support/stack'
import { signUpMember, type TestMember } from './support/member'
import { befriend, makeChapters, notesOf, shelveBook, sharedBook, writeNote } from './support/notes'

/**
 * The notes repository through real RPCs on the local stack (data/notes.ts; the functions are supabase/migrations/20261116010000_book_notes.sql, their
 * rules are pgTAP's, supabase/tests/book_notes_test.sql). What this keeps: every call answers the shape the screens read, each refusal becomes its code,
 * the layer's types come out (a chapter is a thread, a note a ChatRecord), and each level shows a note to the members it is for and to nobody else:
 * Ida and Anna follow each other, Mo is a member with no relation to either.
 */

let ida: TestMember
let anna: TestMember
let mo: TestMember

/** The owner's switch as the stack had it (the migration ships it off; production turns it on at release): the suite turns it on for its cases and puts it back. */
let switchWas = false

beforeAll(async () => {
  switchWas = (await sql<{ public_enabled: boolean }>('select public_enabled from private.notes_settings'))[0]!.public_enabled
  await sql('update private.notes_settings set public_enabled = true, updated_at = now()')
  ;[ida, anna, mo] = await Promise.all([signUpMember(), signUpMember(), signUpMember()])
  await befriend(ida, anna)
})

/** A Book all three have, with its chapters made by Ida: the Book's id, the room and the chapter ids. */
async function room(parts = 4) {
  const snapshot = sharedBook('Shared')
  const [idaBook] = await Promise.all([shelveBook(ida, snapshot), shelveBook(anna, snapshot), shelveBook(mo, snapshot)])
  const made = await makeChapters(ida, idaBook, parts)
  return { bookId: idaBook, room: made, chapter: (n: number) => made.chapters.find((c) => c.position === n)!.id }
}

const bodies = async (member: TestMember, r: Awaited<ReturnType<typeof room>>, n: number) =>
  ((await notesOf(member).messages(r.room.id, r.chapter(n))).data?.items ?? []).map((i) => i.body)

describe('a refusal is a code', () => {
  it('maps the database’s messages, an id that is no id and a retry the database asks for', () => {
    expect(mapNoteError({ message: 'chapters_already_set', code: 'PT409' })).toBe('chapters_already_set')
    expect(mapNoteError({ message: 'note_wider_than_parent', code: '22023' })).toBe('note_wider_than_parent')
    expect(mapNoteError({ message: 'invalid input syntax for type uuid', code: '22P02' })).toBe('not_found')
    expect(mapNoteError({ message: 'deadlock detected', code: '40P01' })).toBe('busy')
    expect(mapNoteError({ message: 'something nobody explained' })).toBe('unknown')
    expect(NOTE_ERROR_CODES.every((code) => mapNoteError({ message: code }) === code)).toBe(true)
    expect(isRetryableNoteError('offline')).toBe(true)
    expect(isRetryableNoteError('notes_public_off')).toBe(false)
  })

  it('is offline before anything is sent, and when the request got no answer', async () => {
    const rpc = vi.fn()
    expect(await createNotes({ rpc } as never, { online: () => false }).page('b')).toEqual({ data: null, error: 'offline' })
    expect(rpc).not.toHaveBeenCalled()
    const silent = { rpc: async () => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) }
    expect(await createNotes(silent as never).page('b')).toEqual({ data: null, error: 'offline' })
    const thrown = { rpc: async () => Promise.reject(new Error('cancelled')) }
    expect(await createNotes(thrown as never).page('b')).toEqual({ data: null, error: 'offline' })
  })
})

describe('the chapters of a Book', () => {
  it('has no room until somebody makes one, then one list for everyone with the Book; the second maker gets chapters_already_set', async () => {
    const snapshot = sharedBook('Chapters')
    const [idaBook, annaBook] = await Promise.all([shelveBook(ida, snapshot), shelveBook(anna, snapshot, 'want_to_read')])
    const before = await notesOf(anna).page(annaBook)
    expect(before.data).toMatchObject({ canWrite: true, room: null })

    const made = await notesOf(ida).setChapters(idaBook, 12)
    expect(made.error).toBeNull()
    expect(made.data!.room!.chapterCount).toBe(12)
    expect(made.data!.room!.chapters).toHaveLength(13)
    expect(made.data!.room!.chapters.at(-1)).toMatchObject({ kind: 'end', position: 13 })

    const second = await notesOf(anna).setChapters(annaBook, 30)
    expect(second.error).toBe('chapters_already_set')
    const shown = await notesOf(anna).page(annaBook)
    expect(shown.data!.room!.chapterCount).toBe(12)
    expect(shown.data!.room!.id).toBe(made.data!.room!.id)
  })

  it('refuses a count out of range, and a member without the Book writes nothing but may read', async () => {
    const snapshot = sharedBook('Counts')
    const idaBook = await shelveBook(ida, snapshot)
    expect((await notesOf(ida).setChapters(idaBook, 0)).error).toBe('invalid_count')
    expect((await notesOf(ida).setChapters(idaBook, 301)).error).toBe('invalid_count')
    expect((await notesOf(mo).setChapters(idaBook, 5)).error).toBe('notes_need_book')
    const outside = await notesOf(mo).page(idaBook)
    expect(outside.data).toMatchObject({ canWrite: false, room: null })
  })

  it('adds at the end with the ids kept', async () => {
    const r = await room(3)
    const ids = r.room.chapters.map((c) => c.id)
    expect((await notesOf(ida).addChapters(r.room.id, 2)).error).toBeNull()
    const grown = (await notesOf(ida).page(r.bookId)).data!.room!
    expect(grown.chapterCount).toBe(5)
    expect(grown.chapters.slice(0, 3).map((c) => c.id)).toEqual(ids.slice(0, 3))

  })

  it('keeps her chapter by hand and back to automatic', async () => {
    const r = await room(10)
    const mine = notesOf(anna)
    expect((await mine.setChapter(r.room.id, 7)).data).toMatchObject({ chapter: 7, hand: true })
    expect((await mine.page(r.bookId)).data!.room!.me).toMatchObject({ chapter: 7, hand: true })
    expect((await mine.setChapter(r.room.id, null, true)).data).toMatchObject({ finished: true, hand: true })
    expect((await mine.setChapter(r.room.id, 99)).error).toBe('invalid_chapter')
    expect((await mine.setChapter(r.room.id, null)).data).toMatchObject({ hand: false })
  })
})

describe('who sees a note', () => {
  it('shows Only me to its author alone, Friends to her friends, Everyone to every member', async () => {
    const r = await room()
    const chapter = r.chapter(2)
    await writeNote(ida, r.room, chapter, 'only mine', 'private')
    await writeNote(ida, r.room, chapter, 'for friends', 'friends')
    await writeNote(ida, r.room, chapter, 'for everyone', 'public')

    expect(await bodies(ida, r, 2)).toEqual(['only mine', 'for friends', 'for everyone'])
    expect(await bodies(anna, r, 2)).toEqual(['for friends', 'for everyone'])
    expect(await bodies(mo, r, 2)).toEqual(['for everyone'])

    // The counts follow the same rule, per reader.
    const count = async (member: TestMember) => (await notesOf(member).page(r.bookId)).data!.room!.chapters.find((c) => c.position === 2)!.count
    expect([await count(ida), await count(anna), await count(mo)]).toEqual([3, 2, 1])
  })

  it('tells the Book page the friends’ and the public lines, never her own', async () => {
    const r = await room()
    await writeNote(ida, r.room, r.chapter(3), 'friends note', 'friends')
    await writeNote(mo, r.room, r.chapter(4), 'public note', 'public')

    const anna_ = (await notesOf(anna).summary(r.bookId)).data!
    expect(anna_.friends).toMatchObject({ count: 1, authorCount: 1, firstChapter: 3, lastChapter: 3 })
    expect(anna_.friends.authors.map((a) => a.id)).toEqual([ida.id])
    expect(anna_.public).toEqual({ count: 1, authorCount: 1 })

    const mo_ = (await notesOf(mo).summary(r.bookId)).data!
    expect(mo_.friends.count).toBe(0)
    expect(mo_.public.count).toBe(0)
  })

  it('shows a quote only to a reader of the note it answers: the hidden and the removed shapes carry no words', async () => {
    const r = await room()
    const chapter = r.chapter(1)
    const base = await writeNote(ida, r.room, chapter, 'what Ida said to friends', 'friends')
    const answer = await writeNote(anna, r.room, chapter, 'Anna answers at friends', 'friends', base.id)
    expect(answer.quote).toMatchObject({ kind: 'note', id: base.id, excerpt: 'what Ida said to friends' })

    // A public reply to a friends-only note is refused: never wider than its parent.
    const wider = await notesOf(anna).post({ roomId: r.room.id, sectionId: chapter, clientId: crypto.randomUUID(), body: 'wider', visibility: 'public', replyTo: base.id })
    expect(wider.error).toBe('note_wider_than_parent')

    // Ida narrows her own note: Anna's friends-level reply stays, Mo never saw either.
    const publicBase = await writeNote(ida, r.room, chapter, 'public base', 'public')
    const publicReply = await writeNote(mo, r.room, chapter, 'Mo answers publicly', 'public', publicBase.id)
    expect((await notesOf(mo).messages(r.room.id, chapter)).data!.items.find((i) => i.id === publicReply.id)!.quote).toMatchObject({ kind: 'note' })
    expect((await notesOf(ida).setVisibility(publicBase.id, 'private')).error).toBeNull()
    // The reply (wider than its parent now) was narrowed with it: Mo's own note stays his, and its quote is hidden for Anna and Ida's parent is gone for her.
    const afterForAnna = (await notesOf(anna).messages(r.room.id, chapter)).data!.items
    expect(afterForAnna.find((i) => i.id === publicReply.id)).toBeUndefined()
    const afterForMo = (await notesOf(mo).messages(r.room.id, chapter)).data!.items.find((i) => i.id === publicReply.id)!
    expect(afterForMo.quote).toEqual({ kind: 'hidden' })

    // A deleted parent reads removed, never its words.
    expect((await notesOf(ida).deleteNote(base.id)).error).toBeNull()
    const removed = (await notesOf(anna).messages(r.room.id, chapter)).data!.items.find((i) => i.id === answer.id)!
    expect(removed.quote).toEqual({ kind: 'removed' })
    const tomb = (await notesOf(anna).messages(r.room.id, chapter)).data!.items.find((i) => i.id === base.id)!
    expect(tomb).toMatchObject({ body: '', deletedAt: expect.any(String), moderated: false, reactions: [] })
  })

  it('does not widen a note to a level its parent does not have, and widens her own note up to Everyone', async () => {
    const r = await room()
    const note = await writeNote(ida, r.room, r.chapter(1), 'widen me', 'private')
    expect((await notesOf(ida).setVisibility(note.id, 'public')).error).toBeNull()
    expect(await bodies(mo, r, 1)).toEqual(['widen me'])
    expect((await notesOf(anna).setVisibility(note.id, 'private')).error).toBe('not_found')
    expect((await notesOf(ida).setVisibility(note.id, 'nobody' as never)).error).toBe('invalid_visibility')
  })
})

describe('writing and reading', () => {
  it('answers the same note to the same client id, and keeps the client id for its author only', async () => {
    const r = await room()
    const clientId = crypto.randomUUID()
    const post = () => notesOf(ida).post({ roomId: r.room.id, sectionId: r.chapter(1), clientId, body: 'once', visibility: 'friends' })
    const first = await post()
    const again = await post()
    expect(again.data!.id).toBe(first.data!.id)
    expect(first.data).toMatchObject({ clientId, conversationId: r.room.id, threadId: r.chapter(1), senderId: ida.id, kind: 'text', visibility: 'friends', effectiveVisibility: 'friends' })
    const seen = (await notesOf(anna).messages(r.room.id, r.chapter(1))).data!.items[0]!
    expect(seen.clientId).toBeNull()
  })

  it('refuses an empty note, a long one, a visibility that is none and a note without the Book', async () => {
    const r = await room()
    const post = (member: TestMember, body: string, visibility = 'friends') =>
      notesOf(member).post({ roomId: r.room.id, sectionId: r.chapter(1), clientId: crypto.randomUUID(), body, visibility: visibility as never })
    expect((await post(ida, '   ')).error).toBe('body_empty')
    expect((await post(ida, 'x'.repeat(2001))).error).toBe('body_too_long')
    expect((await post(ida, 'ok', 'everyone')).error).toBe('invalid_visibility')
    const stranger = await signUpMember()
    expect((await post(stranger, 'no book')).error).toBe('notes_need_book')
  })

  it('pages back in time, oldest first, and says when there may be more', async () => {
    const r = await room()
    const chapter = r.chapter(1)
    for (let i = 1; i <= 5; i++) await writeNote(ida, r.room, chapter, `note ${i}`)
    const first = (await notesOf(ida).messages(r.room.id, chapter, { limit: 3 })).data!
    expect(first.items.map((i) => i.body)).toEqual(['note 3', 'note 4', 'note 5'])
    expect(first.more).toBe(true)
    const older = (await notesOf(ida).messages(r.room.id, chapter, { before: first.items[0]!.createdAt, limit: 3 })).data!
    expect(older.items.map((i) => i.body)).toEqual(['note 1', 'note 2'])
    expect(older.more).toBe(false)
    expect(NOTES_PAGE).toBe(50)
  })

  it('reacts once a note, counts without names, and takes it back; reading marks the cursor', async () => {
    const r = await room()
    const chapter = r.chapter(1)
    const note = await writeNote(ida, r.room, chapter, 'react to me')
    expect((await notesOf(anna).react(note.id, '❤️')).error).toBeNull()
    const seen = (await notesOf(anna).messages(r.room.id, chapter)).data!.items[0]!
    expect(seen.reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }])
    expect((await notesOf(ida).messages(r.room.id, chapter)).data!.items[0]!.reactions).toEqual([{ emoji: '❤️', count: 1, mine: false }])
    expect((await notesOf(anna).react(note.id, '🙂')).error).toBe('invalid_emoji')
    expect((await notesOf(mo).react(note.id, '❤️')).error).toBe('not_found')
    expect((await notesOf(anna).react(note.id, null)).error).toBeNull()

    await notesOf(anna).setChapter(r.room.id, 1)
    const unread = async () => (await notesOf(anna).page(r.bookId)).data!.room!.chapters.find((c) => c.position === 1)!.unread
    expect(await unread()).toBe(1)
    expect((await notesOf(anna).markRead(r.room.id, chapter, seen.createdAt)).error).toBeNull()
    expect(await unread()).toBe(0)
  })
})

describe('moderation', () => {
  it('reports a note she can see once, refuses her own, and says not_found for one she cannot see', async () => {
    const r = await room()
    const chapter = r.chapter(1)
    const note = await writeNote(ida, r.room, chapter, 'report me', 'public')
    expect((await notesOf(mo).report(note.id, 'spam', 'because')).error).toBeNull()
    expect((await notesOf(mo).report(note.id, 'spam')).error).toBeNull()
    expect((await notesOf(mo).report(note.id, 'nonsense')).error).toBe('invalid_reason')
    expect((await notesOf(ida).report(note.id, 'spam')).error).toBe('report_self')
    const private_ = await writeNote(ida, r.room, chapter, 'hidden', 'private')
    expect((await notesOf(mo).report(private_.id, 'spam')).error).toBe('not_found')
    const rows = await sql<{ n: number }>(`select count(*)::int n from public.feedback where kind = 'report' and context ->> 'note' = $1`, [note.id])
    expect(rows[0]!.n).toBe(1)
  })

  it('lets only the owner remove a note and flip the switch', async () => {
    const r = await room()
    const note = await writeNote(ida, r.room, r.chapter(1), 'for the moderator', 'public')
    expect((await notesOf(mo).ownerRemove(note.id, 'no')).error).toBe('not_owner')
    expect((await notesOf(mo).ownerSetPublic(false)).error).toBe('not_owner')
  })

  it('hides Everyone behind the owner’s switch: a public note counts as friends’, the control would be refused', async () => {
    const r = await room()
    const note = await writeNote(ida, r.room, r.chapter(1), 'was public', 'public')
    expect((await notesOf(mo).config()).data).toEqual({ publicEnabled: true })
    try {
      await sql('update private.notes_settings set public_enabled = false, updated_at = now()')
      expect((await notesOf(mo).config()).data).toEqual({ publicEnabled: false })
      expect(await bodies(mo, r, 1)).toEqual([])
      expect(await bodies(anna, r, 1)).toEqual(['was public'])
      const mine = (await notesOf(ida).messages(r.room.id, r.chapter(1))).data!.items.find((i) => i.id === note.id)!
      expect(mine).toMatchObject({ visibility: 'public', effectiveVisibility: 'friends' })
      const refused = await notesOf(ida).post({ roomId: r.room.id, sectionId: r.chapter(1), clientId: crypto.randomUUID(), body: 'now', visibility: 'public' })
      expect(refused.error).toBe('notes_public_off')
      expect((await notesOf(mo).summary(r.bookId)).data!.public.count).toBe(0)
    } finally {
      await sql('update private.notes_settings set public_enabled = true, updated_at = now()')
    }
    expect(await bodies(mo, r, 1)).toEqual(['was public'])
  })
})

describe('a block cuts every level', () => {
  it('hides a public note and its author’s others from the member who blocked her, and the other way round', async () => {
    const r = await room()
    const chapter = r.chapter(1)
    await writeNote(ida, r.room, chapter, 'ida public', 'public')
    await writeNote(mo, r.room, chapter, 'mo public', 'public')
    expect(await bodies(ida, r, 1)).toEqual(['ida public', 'mo public'])
    // A member may block the author of a note she can see, friend or not.
    expect((await mo.client.rpc('block', { p_member: ida.id })).error).toBeNull()
    expect(await bodies(mo, r, 1)).toEqual(['mo public'])
    expect(await bodies(ida, r, 1)).toEqual(['ida public'])
  })
})

afterAll(async () => {
  await sql('update private.notes_settings set public_enabled = $1, updated_at = now()', [switchWas])
})

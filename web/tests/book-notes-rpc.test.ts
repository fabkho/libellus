import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLibrary } from '../app/data/library'
import { catalogueEdition, follows } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'
import { sql } from './support/stack'

/**
 * Notes on a Book, N1 (supabase/migrations/20261116010000_book_notes.sql): every client call through supabase-js as a signed-in
 * member, so each one is its own transaction that COMMITS as the role `authenticated`. pgTAP never commits, and the deferred
 * checks (`room_sections_order`, `room_messages_replies_check`) fire only at commit, after the security definer function has
 * returned: a check that runs as the caller there could not read the tables (a bug N2 found on 7962eddb). Here every call must
 * answer without an error. The screens' repository is N2's; these call the RPCs as the contract names them.
 */

let mia: TestMember
let kai: TestMember
let owner: TestMember
let before: { owner: string | null; on: boolean }
let bookId: string

beforeAll(async () => {
  ;[mia, kai, owner] = await Promise.all([signUpMember(), signUpMember(), signUpMember()])
  await follows(mia, kai)
  await follows(kai, mia)
  before = {
    owner: (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null,
    on: (await sql<{ on: boolean }>('select public_enabled as on from private.notes_settings'))[0]?.on ?? false,
  }
  await sql('update private.instance_owner set owner_id = $1', [owner.id])
  const book = catalogueEdition('Notes over the wire')
  const added = await createLibrary(mia.client).addToLibrary(book)
  if (added.error || !added.data) throw new Error(`Fixture failed: ${String(added.error)}`)
  bookId = added.data.book.id
  const hers = await createLibrary(kai.client).addToLibrary(book)
  if (hers.error || hers.data?.book.id !== bookId) throw new Error('Fixture failed: not the same Book')
})

afterAll(async () => {
  await sql('update private.instance_owner set owner_id = $1', [before.owner])
  await sql('update private.notes_settings set public_enabled = $1', [before.on])
})

async function call<T = unknown>(member: TestMember, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await member.client.rpc(fn, args)
  expect(error, `${fn}: ${error?.message}`).toBeNull()
  return data as T
}

describe('every Notes call commits as a signed-in member', () => {
  it('chapters, notes, replies, levels, reactions, reports, cursors, deletion and the owner’s functions', async () => {
    expect(await call(owner, 'owner_set_notes_public', { p_enabled: true })).toEqual({ publicEnabled: true })
    expect(await call(mia, 'notes_config')).toEqual({ publicEnabled: true })

    type Page = { room: { id: string; chapterCount: number; chapters: { id: string; position: number }[] } }
    const page = await call<Page>(mia, 'set_book_chapters', { p_book: bookId, p_count: 5 })
    const room = page.room.id
    expect((await call<Page>(kai, 'add_book_chapters', { p_room: room, p_count: 2 })).room.chapterCount).toBe(7)
    const ch1 = (await call<Page>(kai, 'book_notes', { p_book: bookId })).room.chapters.find((c) => c.position === 1)!.id
    await call(mia, 'set_note_chapter', { p_room: room, p_chapter: 3 })

    type Note = { id: string; visibility: string }
    const n1 = await call<Note>(mia, 'post_note', { p_room: room, p_section: ch1, p_client_id: crypto.randomUUID(), p_body: 'Mia, for everyone', p_visibility: 'public' })
    const r1 = await call<Note>(kai, 'post_note', { p_room: room, p_section: ch1, p_client_id: crypto.randomUUID(), p_body: 'Kai answers', p_visibility: 'public', p_reply_to: n1.id })
    const r2 = await call<Note>(mia, 'post_note', { p_room: room, p_section: ch1, p_client_id: crypto.randomUUID(), p_body: 'Mia answers Kai', p_visibility: 'friends', p_reply_to: r1.id })

    // Narrowing narrows the replies, and the deferred check of the replies passes at commit.
    expect((await call<Note>(mia, 'set_note_visibility', { p_note: n1.id, p_visibility: 'private' })).visibility).toBe('private')
    expect((await sql<{ visibility: string }>('select visibility from public.room_messages where id = $1', [r1.id]))[0]!.visibility).toBe('private')
    expect((await call<Note>(mia, 'set_note_visibility', { p_note: n1.id, p_visibility: 'friends' })).visibility).toBe('friends')

    await call(kai, 'react_to_note', { p_note: n1.id, p_emoji: '❤️' })
    expect(await call(kai, 'report_note', { p_note: n1.id, p_reason: 'spam' })).toEqual({ reported: true })
    await call(kai, 'mark_notes_read', { p_room: room, p_section: ch1, p_until: null })
    expect((await call<Note[]>(kai, 'note_messages', { p_room: room, p_section: ch1 })).map((n) => n.id)).toContain(n1.id)
    await call(kai, 'notes_summary', { p_book: bookId })
    await call(kai, 'delete_note', { p_note: r1.id })

    expect(await call(owner, 'owner_set_chapter_count', { p_room: room, p_count: 6 })).toEqual({ chapterCount: 6, was: 7 })
    expect(await call(owner, 'owner_remove_note', { p_note: r2.id, p_reason: 'test' })).toEqual({ removed: true })

    const sections = await sql<{ position: number; kind: string }>('select position, kind from public.room_sections where room_id = $1 order by position', [room])
    expect(sections.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(sections.at(-1)!.kind).toBe('end')
  })

  it('refuses what it should, over the wire too', async () => {
    const { error } = await kai.client.rpc('remove_book_chapters', { p_room: crypto.randomUUID(), p_count: 1 })
    expect(error?.code).toBe('PGRST202')
    const notOwner = await kai.client.rpc('owner_set_chapter_count', { p_room: crypto.randomUUID(), p_count: 3 })
    expect(notOwner.error?.message).toBe('not_owner')
    const table = await kai.client.from('room_messages').select('id').limit(1)
    expect(table.error?.code).toBe('42501')
  })
})

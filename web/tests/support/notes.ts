import { createLibrary } from '../../app/data/library'
import { createNotes, type Notes, type NoteVisibility } from '../../app/data/notes'
import { catalogueEdition, follows } from './buddy'
import type { TestMember } from './member'

/**
 * Fixtures of the notes suites (tests/notes-db.test.ts, the flows): members of one Book, who follows whom, a note written. Everything carries the run's
 * tag (the Book's title, the member's address), so the sweep of a run removes it. Assertions about what a member sees go through her own client.
 */
export { follows }

/** The member's repository, online. */
export const notesOf = (member: TestMember): Notes => createNotes(member.client)

/** One Catalogue Book that several members shelve (the same edition, so the same Book and the same Work). */
export const sharedBook = (title = 'Notes Book') => catalogueEdition(title)

/** The Book in the member's Library (any status); the Book's id. */
export async function shelveBook(member: TestMember, snapshot: ReturnType<typeof sharedBook>, status: 'reading' | 'want_to_read' = 'reading'): Promise<string> {
  const added = await createLibrary(member.client).addToLibrary(snapshot, status === 'reading' ? { status, startedOn: new Date().toISOString().slice(0, 10) } : { status })
  if (added.error || !added.data) throw new Error(`Fixture failed: ${String(added.error)}`)
  return added.data.book.id
}

/** The two follow each other (both accepted): friends, in the sense of Notes. */
export async function befriend(a: TestMember, b: TestMember) {
  await follows(a, b)
  await follows(b, a)
}

/** The chapters of a Book, made by `member` (who has it): the room and its chapters. */
export async function makeChapters(member: TestMember, bookId: string, count = 5) {
  const made = await notesOf(member).setChapters(bookId, count)
  if (made.error || !made.data.room) throw new Error(`Fixture failed: ${String(made.error)}`)
  return made.data.room
}

/** A note, written through the repository; the stored note. */
export async function writeNote(member: TestMember, room: { id: string }, sectionId: string, body: string, visibility: NoteVisibility = 'friends', replyTo: string | null = null) {
  const posted = await notesOf(member).post({ roomId: room.id, sectionId, clientId: crypto.randomUUID(), body, visibility, replyTo })
  if (posted.error) throw new Error(`Fixture failed: ${posted.error}`)
  return posted.data
}

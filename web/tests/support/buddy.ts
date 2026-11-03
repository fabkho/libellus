import type { BookSnapshot } from '../../app/data/books'
import { createLibrary } from '../../app/data/library'
import { createBuddyReads, type BuddyReads, type BuddySectionInput } from '../../app/data/buddyReads'
import type { TestMember } from './member'
import { runTitle, TEST_PUBLISHER, uniqueEditionKey } from './stack'

/**
 * Fixtures of the buddy read suites (tests/buddy-reads.test.ts, tests/buddy-live.test.ts): members who follow each other, a Catalogue
 * Book in a Library, a read started and joined. Everything carries the run's tag (`runTitle`, the member's address), so the sweep of
 * a run removes it and only it. Assertions about what a member can do go through her own client and the repository, never over SQL.
 */

/** A Catalogue Book (an Open Library edition, so a buddy read may be made of it), its title carrying the run tag. */
export function catalogueEdition(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['A. Reader'],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: uniqueEditionKey(),
    openLibraryWorkKey: `OL${Math.floor(Math.random() * 8_000_000) + 1_000_000}W`,
  }
}

/** The Book in the member's Library: the entry (its id and the Book's). */
export async function shelve(member: TestMember, title = 'Shared Book') {
  const added = await createLibrary(member.client).addToLibrary(catalogueEdition(title), { status: 'reading', startedOn: new Date().toISOString().slice(0, 10) })
  if (added.error || !added.data) throw new Error(`Fixture failed: ${String(added.error)}`)
  return added.data
}

/** `n` Sections and the end: parts of equal size, "Part 1" …, `end` last (`create_buddy_read`'s division). */
export function sectionsOf(n = 3, from = 1): BuddySectionInput[] {
  const parts: BuddySectionInput[] = Array.from({ length: n }, (_, i) => ({ kind: 'part', label: `Part ${i + from}`, toFraction: Math.round(((i + 1) / n) * 1e4) / 1e4 }))
  return [...parts, { kind: 'end', label: 'The whole book', toFraction: 1 }]
}

/** `follower` follows `followee`, who accepts (an account is private by default): the follower may then invite the followee to a read. */
export async function follows(follower: TestMember, followee: TestMember) {
  const mine = await followee.client.rpc('my_social')
  const target = await follower.client.rpc('follow_target', { p_token: mine.data.link })
  if (target.error) throw new Error(`Fixture failed: ${target.error.message}`)
  const asked = await follower.client.rpc('follow', { p_member: followee.id })
  if (asked.error) throw new Error(`Fixture failed: ${asked.error.message}`)
  const answered = await followee.client.rpc('answer_request', { p_member: follower.id, p_accept: true })
  if (answered.error) throw new Error(`Fixture failed: ${answered.error.message}`)
}

/** The member's repository, online. */
export const buddyOf = (member: TestMember): BuddyReads => createBuddyReads(member.client, { self: () => member.id })

/** A read of the host's own Book, started through the repository: its id, the link and what the host's Library holds. */
export async function startRead(host: TestMember, { title = 'Shared Book', parts = 3, invite = [] as string[], link = true } = {}) {
  const entry = await shelve(host, title)
  const made = await buddyOf(host).create({ bookId: entry.book.id, clientId: crypto.randomUUID(), sections: sectionsOf(parts), invite, link })
  if (made.error) throw new Error(`Fixture failed: ${made.error}`)
  return { ...made.data, entry, bookId: entry.book.id }
}

/** The member joins by the link. */
export async function joinRead(member: TestMember, token: string): Promise<string> {
  const joined = await buddyOf(member).join(token)
  if (joined.error) throw new Error(`Fixture failed: ${joined.error}`)
  return joined.data
}

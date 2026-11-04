import type { SendJob } from '#layers/chat/app/types/adapter'
import { byCreated, insertMessage, sameMessage } from '#layers/chat/app/utils/thread'
import type { BuddyErrorCode, BuddyMessage, BuddyRead, BuddyReaction } from '~/data/buddyReads'

/**
 * Buddy reads, the glue between the repository (data/buddyReads.ts), the chat layer (`@fabkho/chat`) and the store (stores/buddyRead.ts):
 * pure functions on plain data, so Vitest drives them in Node. The store holds the state and the connection; the rules of a thread
 * (where a message goes, how a bubble and its stored row become one, what a count does) are here.
 */

/** The message-file key a refusal is worded under (en.json, `buddyRead.error.<code>`): every code has one (tests/buddy-read-errors.test.ts). */
export const buddyErrorKey = (code: BuddyErrorCode): string => `buddyRead.error.${code}`

/** The queue's key of a send: one job per client id, so a retry of the same message replaces itself. */
export const buddySendKey = (clientId: string): string => `send:${clientId}`

/** A message in a thread, with what only this device knows: it is on its way (`sending`), refused (`failed`, with the code) or stored (`sent`). */
export type BuddyBubble = BuddyMessage & { state: 'sent' | 'sending' | 'failed'; error: BuddyErrorCode | null }

export const sentBubble = (message: BuddyMessage): BuddyBubble => ({ ...message, state: 'sent', error: null })

/** What she wrote, shown at once while the queue sends it: the id is the client id's, the time her device's, until the stored row replaces it. */
export function pendingBubble(job: SendJob, me: string, name: string | null): BuddyBubble {
  return {
    id: `local:${job.clientId}`,
    conversationId: job.conversationId,
    threadId: job.threadId,
    senderId: me,
    clientId: job.clientId,
    kind: 'text',
    body: job.body,
    createdAt: job.createdAt,
    replyTo: job.replyTo,
    spoiler: job.spoiler,
    media: null,
    authorName: name,
    deletedAt: null,
    reactions: [],
    state: 'sending',
    error: null,
  }
}

/** The thread in the order it is drawn: stored rows by the server's time, then what is still on its way, in the order it was sent. */
export function settleBubbles(list: BuddyBubble[]): void {
  const sent = list.filter((b) => b.state === 'sent').sort(byCreated)
  const rest = list.filter((b) => b.state !== 'sent')
  list.splice(0, list.length, ...sent, ...rest)
}

/**
 * Puts a message into a thread, in place (the layer's `insertMessage`: the same row, or the same send of the same member by client id,
 * is merged over the old one, anything else goes where its time says). A message from a live event carries no author name and no
 * reactions (`live: true`): what the thread already knows of them is kept. Resolves whether a *stored* row is new to the thread: the
 * stored row that replaces her bubble is (the bubble was no row yet), a row seen before is not.
 */
export function mergeBubble(list: BuddyBubble[], incoming: BuddyBubble, { live = false }: { live?: boolean } = {}): boolean {
  const seen = list.some((m) => m.state === 'sent' && sameMessage(m, incoming))
  insertMessage(list, incoming, (old, next) => ({
    authorName: next.authorName ?? old.authorName,
    ...(live ? { reactions: old.reactions, deletedAt: old.deletedAt ?? next.deletedAt } : {}),
  }))
  settleBubbles(list)
  return !seen
}

/** A message that became a tombstone: no body, no picture, no reactions; it reads as text, as the database says. */
export const tombstoneOf = (bubble: BuddyBubble, at: string): BuddyBubble => ({ ...bubble, kind: 'text', body: '', media: null, reactions: [], deletedAt: bubble.deletedAt ?? at })

/** Her reaction at once, before the database says: `emoji` replaces the one she had (null takes it back; the same one again takes it back too, as the database does). */
export function reactedBy(reactions: readonly BuddyReaction[], emoji: string | null): BuddyReaction[] {
  const had = reactions.find((r) => r.mine)?.emoji ?? null
  const next = emoji === had ? null : emoji
  const out = reactions
    .map((r) => (r.emoji === had ? { ...r, count: r.count - 1, mine: false } : { ...r }))
    .filter((r) => r.count > 0)
  if (!next) return out
  const there = out.find((r) => r.emoji === next)
  if (there) {
    there.count += 1
    there.mine = true
  } else out.push({ emoji: next, count: 1, mine: true })
  return out
}

/** The numbers of a thread of a read (the room when `sectionId` is null). */
export function countsOf(read: BuddyRead, sectionId: string | null): { count: number; unread: number } | null {
  if (sectionId === null) return read.room
  return read.chapters.find((c) => c.id === sectionId) ?? null
}

/** A message came into a thread (`unread`: it is somebody else's and the thread is not open) or went (a tombstone of one that counted). */
export function bumpCounts(read: BuddyRead, sectionId: string | null, change: { count?: number; unread?: number }): void {
  const counts = countsOf(read, sectionId)
  if (!counts) return
  counts.count = Math.max(0, counts.count + (change.count ?? 0))
  counts.unread = Math.max(0, counts.unread + (change.unread ?? 0))
}

/** Reads her cursor as caught up to the newest message (the thread is open and she is looking at it). */
export function clearUnread(read: BuddyRead, sectionId: string | null): void {
  const counts = countsOf(read, sectionId)
  if (counts) counts.unread = 0
}

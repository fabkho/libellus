import { sameSide, type BubbleMessage, type BubbleQuote } from '#layers/ui/app/utils/chat/message'
import { messageVeiled } from '#layers/chat/app/utils/veil'
import { isRetryableBuddyError, REPORT_REASONS, type BuddyErrorCode, type ReportReason } from '~/data/buddyReads'
import type { BuddyBubble } from '~/utils/buddyRead'

/**
 * A buddy read's thread as its screen draws it (pages/together/[id]/[section].vue): the stored bubbles of the store
 * (stores/buddyRead.ts) turned into what the base's `UiChatThread` and `UiBubble` take (`BubbleMessage`), plus what only a buddy
 * read adds: who wrote it, the message it answers, the spoiler mark and the tombstone. Pure functions on plain data, so Vitest
 * drives them in Node.
 *
 * **The veil lives here**: a Section that is not open to her (her marker has not reached it and she has not opened it anyway:
 * the layer's `chapterView`) has no items at all, whatever the store holds, so nothing of what was said in it can be drawn,
 * measured or read by a screen reader; a message marked **Spoiler** is veiled for her until she taps it. The database gives
 * every member every message of the read (the veil is the app's, plan part 5.4): this is the one place the rule is applied.
 */

/** One message of a thread: the base's message and what the screen needs besides. */
export type ThreadItem = BubbleMessage & {
  /** The member who wrote it; null for one who has gone. */
  authorId: string | null
  /** Her name as the others know her; null from a live event the members do not name yet, or a member who has gone. */
  author: string | null
  /** The message it answers. */
  replyTo: string | null
  spoiler: boolean
  /** It was deleted: a tombstone (`kind: 'system'`, no words, no reactions), drawn as a quiet line, never as a bubble. */
  removed: boolean
  /** A spoiler she has not tapped: the bubble keeps its size but shows no word (`UiBubble` `veiled`). */
  veiled: boolean
  /** A voice message (its sound is the bubble's, drawn by `UiVoiceBubble`; veiled or not, its words are none: the quote says "Voice message"). */
  voice: boolean
  /** It was refused for a reason a second try cannot change (removed, blocked, archived, invalid): no "Try again", only "Delete". */
  permanent: boolean
}

/** What the thread needs of the screen: who she is, whether the Section is open to her, the spoilers she tapped, the words. */
export type ThreadContext = {
  me: string | null
  /** The Section is open to her (the store's `view(...).open`; the room always is). */
  open: boolean
  /** The ids of the spoilers she tapped on this screen (not kept: a reload veils them again). */
  revealed: ReadonlySet<string>
  /** A member's name among the read's members, or null. */
  nameOf: (memberId: string | null) => string | null
  /** The sentence a refusal is worded with (`buddyRead.error.<code>`). */
  errorWord: (code: BuddyErrorCode) => string
  /** The device's own copy of a recording she sent in this session (a `blob:` URL), by client id; null for every other message. */
  previewOf?: (clientId: string | null) => string | null
  /** What a veiled voice message is drawn as (its size is a text bubble's; "Voice message"): the one phrase of the message file's. */
  voiceLabel?: string
}

/**
 * What a voice bubble plays from before anything is signed: nothing (the thread never fetches a sound). The base's play button is off while a
 * message has no `url`, so an unsigned one carries this stand-in; the page asks for the real, short-lived URL when she presses play
 * (`pages/together/[id]/[section].vue`, the press gate) and the stand-in is never given to the player.
 */
export const VOICE_UNSIGNED = 'about:blank'

/** The key a message keeps from its bubble to its stored row: the client id (the same send), else the stored id. */
export const bubbleKey = (bubble: Pick<BuddyBubble, 'clientId' | 'id'>): string => bubble.clientId ?? bubble.id

/**
 * The messages the screen draws, oldest first. A Section that is not open has none. A tombstone becomes a system line (the base
 * breaks a run at it and the screen draws "Message removed"); her own spoiler is never veiled from her (she knows what she wrote).
 */
export function threadItems(bubbles: readonly BuddyBubble[], ctx: ThreadContext): ThreadItem[] {
  if (!ctx.open) return []
  return bubbles.map((bubble) => {
    const removed = bubble.deletedAt !== null
    const mine = ctx.me !== null && bubble.senderId === ctx.me
    const reaction = bubble.reactions.find((r) => r.mine)
    const veiled = !removed && !mine && messageVeiled(bubble, ctx.revealed.has(bubbleKey(bubble)))
    const voice = !removed && bubble.kind === 'voice' ? bubble.voice : null
    // A voice message under the veil is a veiled text bubble (the same size, no words, no play button): nothing of it is signed or played.
    const playable = voice && !veiled
    return {
      key: bubbleKey(bubble),
      // Null while it is on its way or refused: it cannot be reacted to or answered yet.
      id: bubble.state === 'sent' ? bubble.id : null,
      mine,
      kind: removed ? 'system' : playable ? 'media' : 'text',
      body: removed ? '' : voice ? (veiled ? (ctx.voiceLabel ?? '') : '') : bubble.body,
      createdAt: bubble.createdAt,
      delivery: bubble.state,
      error: bubble.state === 'failed' && bubble.error ? ctx.errorWord(bubble.error) : null,
      media: playable
        ? {
            kind: 'voice',
            // Stored: the stand-in, until she presses play. On its way with no copy on this device (restored after a reload): no URL, the button is off.
            url: ctx.previewOf?.(bubble.clientId) ?? (bubble.state === 'sent' ? VOICE_UNSIGNED : null),
            path: voice.path,
            width: 1,
            height: 1,
            removed: false,
            durationMs: voice.durationMs,
            peaks: voice.peaks,
            mime: voice.mime,
          }
        : null,
      reactions: removed ? [] : bubble.reactions.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine })),
      myReaction: removed ? null : (reaction?.emoji ?? null),
      authorId: bubble.senderId,
      author: bubble.authorName ?? ctx.nameOf(bubble.senderId),
      replyTo: bubble.replyTo,
      spoiler: bubble.spoiler,
      removed,
      veiled,
      voice: voice !== null,
      permanent: bubble.state === 'failed' && !!bubble.error && !isRetryableBuddyError(bubble.error),
    }
  })
}

/**
 * Whether two messages in a row are one run (they sit closer, the first of it carries the name, the last the avatar and the tail): the
 * base's rule (`sameSide`: both hers or both somebody else's, neither a system line, so a tombstone breaks a run) **and the same author**.
 * The base's default knows only mine and not mine, which is right for a 1:1 chat and wrong in a room of three: two other members
 * posting one after the other would be one run under the first one's name with the last one's face. Day breaks are the base's own
 * (a separator row between two messages ends the run before this is asked). Pass it as `UiChatThread`'s `sameRun`.
 */
export function sameAuthorRun(before: Pick<ThreadItem, 'mine' | 'kind' | 'authorId'>, item: Pick<ThreadItem, 'mine' | 'kind' | 'authorId'>): boolean {
  return sameSide(before, item) && before.authorId === item.authorId
}

/** The words a quote needs that are the app's. */
export type QuoteWords = { deleted: string; spoiler: string; someone: string; you: string; voice?: string }

/**
 * The message `replyTo` names, as a quote over a bubble or the composer: who wrote it and its first words. A tombstone says it is
 * gone, a voice message is "Voice message" (it has no words) and a spoiler she has not tapped gives none of its words away. null when it answers nothing.
 */
export function quoteOf(items: readonly ThreadItem[], replyTo: string | null, words: QuoteWords): BubbleQuote | null {
  if (!replyTo) return null
  const original = items.find((item) => item.id === replyTo)
  if (!original) return { id: null, mine: false, name: words.someone, preview: words.deleted }
  const preview = original.removed ? words.deleted : original.veiled ? words.spoiler : original.voice ? (words.voice ?? '') : original.body.replace(/\s+/g, ' ').trim().slice(0, 120)
  return { id: original.removed ? null : original.id, mine: original.mine, name: original.mine ? words.you : (original.author ?? words.someone), preview }
}

// ------------------------------------------------------------------ report

/** The most of a note the database keeps (`report_note_too_long`). */
export const REPORT_NOTE_MAX = 1000

/**
 * What a report sends: the reason, and the note she added trimmed, cut to what the database takes and null when there is none.
 * The reason is the one she picked; null for anything the database would refuse (nothing is sent then). The message's words are
 * never part of it: the database copies a short excerpt itself (`feedback.context`, kind `report`), which is what the owner reads.
 */
export function reportInput(reason: string | null, note: string): { reason: ReportReason; note: string | null } | null {
  if (!reason || !(REPORT_REASONS as readonly string[]).includes(reason)) return null
  const cleaned = [...note.replace(/\r\n?/g, '\n').trim()].slice(0, REPORT_NOTE_MAX).join('')
  return { reason: reason as ReportReason, note: cleaned || null }
}

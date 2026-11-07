import { isRetryableBuddyError, type BuddyErrorCode } from '~/data/buddyReads'
import type { BuddyBubble } from '~/utils/buddyRead'
import { roomItems, type RoomThreadContext, type ThreadItem } from '~/utils/roomThread'

/**
 * A buddy read's thread as its screen draws it (pages/together/[id]/[section].vue): the stored bubbles of the store (stores/buddyRead.ts)
 * turned into what the base's `UiChatThread` and `UiBubble` take. The rules a buddy read shares with a Book's notes (the veil, the items, the
 * runs, the quote, the report's input) live in utils/roomThread.ts and are handed on from here unchanged, so the buddy screens and
 * tests/buddy-thread-view.test.ts do not move; what is left here is what only a buddy read is: its error codes.
 */
export {
  bubbleKey,
  quoteOf,
  reportInput,
  REPORT_NOTE_MAX,
  sameAuthorRun,
  VOICE_UNSIGNED,
  type QuoteWords,
  type ThreadItem,
} from '~/utils/roomThread'

/** What the thread needs of the screen: who she is, whether the Section is open to her, the spoilers she tapped, the words. */
export type ThreadContext = Omit<RoomThreadContext, 'errorWord' | 'retryable'> & {
  /** The sentence a refusal is worded with (`buddyRead.error.<code>`). */
  errorWord: (code: BuddyErrorCode) => string
}

/**
 * The messages the screen draws, oldest first. A Section that is not open has none. A tombstone becomes a system line (the base
 * breaks a run at it and the screen draws "Message removed"); her own spoiler is never veiled from her (she knows what she wrote).
 */
export function threadItems(bubbles: readonly BuddyBubble[], ctx: ThreadContext): ThreadItem[] {
  return roomItems(bubbles, { ...ctx, errorWord: (code) => ctx.errorWord(code as BuddyErrorCode), retryable: (code) => isRetryableBuddyError(code as BuddyErrorCode) })
}

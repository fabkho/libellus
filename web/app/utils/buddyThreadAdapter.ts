import { threadKey } from '#layers/chat/app/utils/thread'
import type { ThreadError, ThreadItemsContext, ThreadPaging, ThreadScreenAdapter } from '~/composables/useThreadScreen'
import type { BuddyBubble, BuddyErrorCode } from '~/utils/buddyRead'
import type { PreparedVoice } from '~/data/buddyVoice'
import type { ReportReason } from '~/data/buddyReads'
import { roomItems } from '~/utils/roomThread'
import type { ThreadItem } from '~/utils/roomThread'

/**
 * A buddy read's thread as the shared thread screen sees it (`composables/useThreadScreen.ts`): one factory, one page
 * (pages/together/[id]/[section].vue), and the read and its Section — `threadKey(read, section)`, the room's `null` — closed over here
 * and nowhere else. Everything the screen calls is a call of the buddy read store.
 *
 * It touches no Nuxt runtime (the channel the page retains is the store's own, imported lazily there) and reads no word of its own, so
 * `tests/thread-screen-adapters.test.ts` drives it over a fake store.
 */

/** The slice of the buddy read store this adapter calls. */
export type BuddyThreadStore = {
  threads: Record<string, { messages: BuddyBubble[]; more: boolean; loading: boolean; loaded: boolean } | undefined>
  messagesOf: (readId: string, sectionId: string | null) => readonly BuddyBubble[]
  loadOlder: (readId: string, sectionId: string | null) => Promise<BuddyErrorCode | null>
  previewOf: (clientId: string | null) => string | null
  send: (readId: string, sectionId: string | null, body: string, extra: { replyTo: string | null }) => Promise<{ ok: boolean; error?: BuddyErrorCode }>
  sendVoice: (readId: string, sectionId: string | null, voice: PreparedVoice, extra: { replyTo: string | null }) => Promise<{ ok: boolean; error?: BuddyErrorCode }>
  retry: (readId: string, sectionId: string | null, clientId: string) => Promise<void>
  discard: (readId: string, sectionId: string | null, clientId: string) => void
  react: (readId: string, sectionId: string | null, messageId: string, emoji: string) => Promise<BuddyErrorCode | null>
  deleteMessage: (readId: string, sectionId: string | null, messageId: string) => Promise<BuddyErrorCode | null>
  report: (messageId: string, reason: ReportReason, note: string | null) => Promise<{ error: BuddyErrorCode | null }>
  voiceUrl: (path: string) => Promise<{ data: string; error: null } | { data: null; error: string }>
}

export type BuddyThreadDeps = {
  store: BuddyThreadStore
  /** The read and the Section (null for the read's own room). */
  readId: () => string
  sectionId: () => string | null
  /** The read is loaded: the thread hangs on it. */
  hasRoom: () => boolean
  me: () => string | null
  isOpen: () => boolean
  nameOf: (memberId: string | null) => string | null
  errorWord: (code: ThreadError) => string
  retryable: (code: ThreadError) => boolean
}

export function buddyThreadAdapter(deps: BuddyThreadDeps): ThreadScreenAdapter<BuddyBubble, ThreadItem> {
  const { store } = deps
  const key = () => threadKey(deps.readId(), deps.sectionId())

  /** A buddy read's quote comes from the messages alone: the server sends none, so the item's `replyTo` is all there is. */
  const quoteSourceOf = (item: ThreadItem) => (item.replyTo ? { kind: 'reply' as const, replyTo: item.replyTo } : null)

  return {
    me: deps.me,
    isOpen: deps.isOpen,
    paging: (): ThreadPaging => {
      const thread = store.threads[key()]
      return { more: thread?.more === true, loading: thread?.loading === true, loaded: thread?.loaded === true, room: deps.hasRoom() }
    },
    nameOf: deps.nameOf,
    previewOf: (clientId) => store.previewOf(clientId),
    errorWord: deps.errorWord,
    retryable: deps.retryable,
    quoteSourceOf,
    bubblesOf: () => store.messagesOf(deps.readId(), deps.sectionId()),
    itemsOf: (bubbles, ctx: ThreadItemsContext) => roomItems(bubbles, ctx),
    loadOlder: () => store.loadOlder(deps.readId(), deps.sectionId()).then(() => {}),
    send: (body, extra) => store.send(deps.readId(), deps.sectionId(), body, { replyTo: extra.replyToId }),
    sendVoice: (voice, extra) => store.sendVoice(deps.readId(), deps.sectionId(), voice, { replyTo: extra.replyToId }),
    retry: (k) => store.retry(deps.readId(), deps.sectionId(), k),
    discard: (k) => store.discard(deps.readId(), deps.sectionId(), k),
    react: (id, emoji) => store.react(deps.readId(), deps.sectionId(), id, emoji),
    deleteMessage: (id) => store.deleteMessage(deps.readId(), deps.sectionId(), id),
    report: (id, reason, note) => store.report(id, reason, note).then((answer) => answer.error),
    voiceUrl: (path) => store.voiceUrl(path),
  }
}

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
 * and nowhere else. Everything the screen calls is a call of the buddy read store, `retain` included: the room's live channel is kept
 * while any screen shows it and let go when the last one goes.
 *
 * It touches no Nuxt runtime (the store's own `retain` is the one place the real Realtime client is imported, lazily) and reads no
 * word of its own, so `tests/thread-screen-adapters.test.ts` drives it over a fake store.
 */

/** The slice of the buddy read store this adapter calls. */
export type BuddyThreadStore = {
  threads: Record<string, { messages: BuddyBubble[]; more: boolean; loading: boolean; loaded: boolean } | undefined>
  messagesOf: (readId: string, sectionId: string | null) => readonly BuddyBubble[]
  load: (readId: string) => Promise<BuddyErrorCode | null>
  openThread: (readId: string, sectionId: string | null) => Promise<BuddyErrorCode | null>
  closeThread: (readId: string, sectionId: string | null) => void
  loadOlder: (readId: string, sectionId: string | null) => Promise<BuddyErrorCode | null>
  peek: (sectionId: string) => void
  retain: (readId: string) => Promise<() => void>
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
  /** The address names no thread of this read (she is not in it any more, or the Section is not its own). */
  missing: () => boolean
  /** A Section the veil keeps shut. */
  veiled: () => boolean
  nameOf: (memberId: string | null) => string | null
  errorWord: (code: ThreadError) => string
  retryable: (code: ThreadError) => boolean
  /** Where Back goes when the history has none. */
  backTo: () => string
}

export function buddyThreadAdapter(deps: BuddyThreadDeps): ThreadScreenAdapter<BuddyBubble, ThreadItem> {
  const { store } = deps
  const key = () => threadKey(deps.readId(), deps.sectionId())

  /** A buddy read's quote comes from the messages alone: the server sends none, so the item's `replyTo` is all there is. */
  const quoteSourceOf = (item: ThreadItem) => (item.replyTo ? { kind: 'reply' as const, replyTo: item.replyTo } : null)

  return {
    me: deps.me,
    isOpen: deps.isOpen,
    missing: deps.missing,
    veiled: deps.veiled,
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
    loadInitial: () => store.load(deps.readId()),
    openThread: () => store.openThread(deps.readId(), deps.sectionId()),
    closeThread: () => store.closeThread(deps.readId(), deps.sectionId()),
    loadOlder: () => store.loadOlder(deps.readId(), deps.sectionId()).then(() => {}),
    peek: () => {
      const section = deps.sectionId()
      // The room is always open: there is nothing to peek at.
      if (section) store.peek(section)
    },
    retain: () => store.retain(deps.readId()),
    backTo: deps.backTo,
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

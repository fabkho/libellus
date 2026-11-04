import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SendJob } from '#layers/chat/app/types/adapter'
import { claimQueue, createSaveQueue, parseStoredQueue, type JobOutcome, type Refusal, type SaveQueue, type TabQueue, UNEXPLAINED_ATTEMPTS } from '#layers/chat/app/utils/queue'
import { readPoint, threadKey } from '#layers/chat/app/utils/thread'
import { chapterView, createPeeks, type ChapterView } from '#layers/chat/app/utils/veil'
import {
  createBuddyReads,
  isRetryableBuddyError,
  MESSAGES_PAGE,
  justAfter,
  type BuddyErrorCode,
  type BuddyMe,
  type BuddyMessage,
  type BuddyRead,
  type BuddyReads,
  type BuddyResult,
  type CreateBuddyRead,
  type MyBuddyReads,
  type ReportReason,
} from '~/data/buddyReads'
import type { BuddyLive, BuddyLiveEvent, LiveRealtimeModule } from '~/data/buddyLive'
import { useSessionStore } from '~/stores/session'
import { parseAppConfig } from '~/utils/appConfig'
import {
  bumpCounts,
  buddyPeekKey,
  buddyQueueKey,
  buddySendKey,
  clearUnread,
  countsOf,
  mergeBubble,
  pendingBubble,
  reactedBy,
  sentBubble,
  tombstoneOf,
  type BuddyBubble,
} from '~/utils/buddyRead'

/**
 * Buddy reads, her side (data/buddyReads.ts, docs/plans/buddy-read-shared.md): the reads she is in, the thread of the room and of every
 * Section, what she wrote that is still on its way, her Section and the Sections she opened anyway. The one store for every buddy
 * read screen; it is only imported by those screens (tests/buddy-read-entry.test.ts keeps it, and data/buddyLive.ts, out of the entry).
 *
 * - **Threads** are keyed by the layer's `threadKey(read, section)` (the room is the read's id alone). A thread is read when a screen
 *   opens it (the newest 50, older ones on `loadOlder`) and then follows the live channel and `resync`.
 * - **Sending is optimistic and queued.** A message shows at once as a bubble the queue sends in order (the layer's `createSaveQueue`:
 *   kept in `localStorage` across a reload, one tab owns a member's line, a retry with a growing pause). The stored row replaces the
 *   bubble by its client id; a refusal is handed back on the bubble (`failed`, with the code), for the screen to word and lead her back.
 * - **The veil** is drawn here, not by the database: `view(read, section)` says whether a Section is open to her (her marker, the whole
 *   book once she is through, a peek) and what a row may show; a veiled Section's unread is not counted in `unread(read)`.
 * - **Live** (data/buddyLive.ts) is started only while a screen has `retain`ed it and loaded lazily (the real Realtime client is a chunk
 *   of its own: no Realtime request until a screen asks). Home does not retain it: it reads `loadMine` on focus.
 *
 * Writes wait for a connection (the repository refuses them offline, the controls say Offline); a send does not: it waits in the
 * queue. Signing out, or another member signing in, forgets everything and closes the channel.
 */

type Thread = { messages: BuddyBubble[]; loaded: boolean; more: boolean; loading: boolean; marked: string | null }

/** The send's outcome for the screen: the client id its bubble goes by. */
export type BuddySend = { ok: true; clientId: string } | { ok: false; error: BuddyErrorCode }

const newId = () => globalThis.crypto.randomUUID()
const deviceStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export const useBuddyReadStore = defineStore('buddyRead', () => {
  const backend = useBackend()
  const config = parseAppConfig(useRuntimeConfig().public)
  const session = useSessionStore()

  /** The reads she opened, by id. */
  const reads = ref<Record<string, BuddyRead>>({})
  /** Her reads and invitations (Home, the invitation row); null until asked. */
  const mine = ref<MyBuddyReads | null>(null)
  const threads = ref<Record<string, Thread>>({})
  /** Sends still in line (on their way or waiting for a connection). */
  const waiting = ref(0)
  /** The live channel's word: `idle` until a screen retains it. */
  const liveStatus = ref<string>('idle')
  /** Raised when a peek is added, so rows that read `peeked` follow. */
  const peekVersion = ref(0)

  const me = computed(() => session.member?.id ?? null)
  const online = useOnline()

  // ------------------------------------------------------------------ the repository

  let repository: BuddyReads | null = null
  function repo(): BuddyReads | null {
    if (!backend) return null
    repository ??= createBuddyReads(backend, { online: isOnline, self: () => me.value })
    return repository
  }
  const unavailable = <T>(): BuddyResult<T> => ({ data: null, error: 'offline' })

  // ------------------------------------------------------------------ threads

  const keyOf = (readId: string, sectionId: string | null) => threadKey(readId, sectionId)
  function thread(readId: string, sectionId: string | null): Thread {
    const key = keyOf(readId, sectionId)
    return (threads.value[key] ??= { messages: [], loaded: false, more: false, loading: false, marked: null })
  }
  /** The messages of a thread, oldest first, what is on its way last. */
  const messagesOf = (readId: string, sectionId: string | null): BuddyBubble[] => threads.value[keyOf(readId, sectionId)]?.messages ?? []

  /** How many screens look at a thread: a message that comes into one of them is read at once. */
  const viewing: Record<string, number> = {}
  const isViewing = (readId: string, sectionId: string | null) => (viewing[keyOf(readId, sectionId)] ?? 0) > 0

  function nameOf(readId: string, memberId: string | null): string | null {
    return reads.value[readId]?.members.find((m) => m.id === memberId)?.name ?? null
  }

  /** Puts a page into a thread (the stored rows are the truth: they replace the same rows, what is still on its way stays). */
  function takePage(readId: string, sectionId: string | null, items: BuddyMessage[]) {
    const t = thread(readId, sectionId)
    for (const item of items) {
      mergeBubble(t.messages, sentBubble({ ...item, authorName: item.authorName ?? nameOf(readId, item.senderId) }))
    }
  }

  /** Opens a thread: its newest page when it has none yet. The screen that shows it calls `closeThread` when it goes. */
  async function openThread(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const key = keyOf(readId, sectionId)
    viewing[key] = (viewing[key] ?? 0) + 1
    await ensureQueue()
    const t = thread(readId, sectionId)
    if (t.loaded) {
      void markThread(readId, sectionId)
      return null
    }
    return loadNewest(readId, sectionId)
  }
  function closeThread(readId: string, sectionId: string | null) {
    const key = keyOf(readId, sectionId)
    viewing[key] = Math.max(0, (viewing[key] ?? 0) - 1)
  }

  async function loadNewest(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const t = thread(readId, sectionId)
    t.loading = true
    const answer = await r.messages(readId, sectionId, { limit: MESSAGES_PAGE })
    t.loading = false
    if (answer.error) return answer.error
    takePage(readId, sectionId, answer.data.items)
    // Only the first load decides whether there is more to ask for: a reload of a thread that grew keeps the answer it had.
    if (!t.loaded) t.more = answer.data.more
    t.loaded = true
    if (isViewing(readId, sectionId)) void markThread(readId, sectionId)
    return null
  }

  /** The page before the oldest stored message. */
  async function loadOlder(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    const t = thread(readId, sectionId)
    const oldest = t.messages.find((m) => m.state === 'sent')
    if (!r || !oldest || t.loading || !t.more) return null
    t.loading = true
    const answer = await r.messages(readId, sectionId, { before: oldest.createdAt, limit: MESSAGES_PAGE })
    t.loading = false
    if (answer.error) return answer.error
    takePage(readId, sectionId, answer.data.items)
    t.more = answer.data.more
    return null
  }

  /** Her cursor in a thread moves to the newest message that is somebody else's (nothing to tell: no call). */
  async function markThread(readId: string, sectionId: string | null) {
    const r = repo()
    const read = reads.value[readId]
    if (read) clearUnread(read, sectionId)
    const t = thread(readId, sectionId)
    const point = readPoint(
      t.messages.filter((m) => m.state === 'sent'),
      t.marked,
      me.value,
    )
    if (!r || !point) return
    t.marked = point
    const answer = await r.mark(readId, sectionId, point)
    // Not moved after all: the next look asks again.
    if (answer.error) t.marked = null
  }

  // ------------------------------------------------------------------ the send queue

  let queue: SaveQueue<SendJob> | null = null
  let queueFor: string | null = null
  let queueTab: TabQueue | null = null
  let opening: Promise<void> | null = null

  /** Sends one queued message; the stored row (or the one a retry made before) replaces the bubble. */
  async function runSend(job: SendJob): Promise<JobOutcome> {
    const r = repo()
    if (!r) return { ok: false, retry: true, error: 'offline' }
    const answer = await r.post({ readId: job.conversationId, sectionId: job.threadId, clientId: job.clientId, body: job.body, replyTo: job.replyTo, spoiler: job.spoiler })
    if (answer.error) {
      if (isRetryableBuddyError(answer.error)) return { ok: false, retry: true, error: answer.error, giveUpAfter: answer.error === 'offline' ? undefined : UNEXPLAINED_ATTEMPTS }
      return { ok: false, retry: false, error: answer.error, field: null }
    }
    arrived(sentBubble({ ...answer.data, authorName: answer.data.authorName ?? nameOf(job.conversationId, me.value) }), false)
    return { ok: true }
  }

  /** A stored row came in (a send's answer, or a live event): into its thread, and the read's numbers follow. */
  function arrived(bubble: BuddyBubble, live: boolean) {
    const sectionId = bubble.threadId
    const t = thread(bubble.conversationId, sectionId)
    const fresh = mergeBubble(t.messages, bubble, { live })
    const read = reads.value[bubble.conversationId]
    if (!fresh || !read) return
    const mineAlready = bubble.senderId === me.value
    const open = isViewing(bubble.conversationId, sectionId)
    bumpCounts(read, sectionId, { count: 1, unread: mineAlready || open ? 0 : 1 })
    if (open && !mineAlready) void markThread(bubble.conversationId, sectionId)
  }

  function refused(refusal: Refusal<SendJob>) {
    const job = refusal.payload
    const bubble = thread(job.conversationId, job.threadId).messages.find((m) => m.clientId === job.clientId && m.state !== 'sent')
    if (bubble) {
      bubble.state = 'failed'
      bubble.error = refusal.error as BuddyErrorCode
    }
  }

  /** The line of the signed-in member, restored from the device, sending. One tab owns it (Web Locks); without them the single key does. */
  function ensureQueue(): Promise<void> {
    const member = me.value
    if (!member) return Promise.resolve()
    if (queue && queueFor === member) return Promise.resolve()
    opening ??= (async () => {
      closeQueue()
      const storage = deviceStorage()
      const prefix = buddyQueueKey(member)
      const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
      let storageKey = prefix
      if (storage && locks) {
        try {
          queueTab = await claimQueue({ storage, locks, tabStorage: typeof sessionStorage === 'undefined' ? null : sessionStorage, prefix })
          storageKey = queueTab.key
        } catch {
          queueTab = null
        }
      }
      const q = createSaveQueue<SendJob>({
        storage,
        storageKey,
        run: runSend,
        onChange: (snapshot) => {
          waiting.value = snapshot.jobs.length
        },
        onRefused: refused,
      })
      queue = q
      queueFor = member
      showRestored(q, member)
      // What a closed tab left in line is ours now.
      if (queueTab) {
        await queueTab.adoptOrphans((raw) => {
          const orphan = parseStoredQueue<SendJob>(raw)
          q.adopt(orphan.jobs, orphan.refusals)
        })
      }
      showRestored(q, member)
      q.start()
    })().finally(() => (opening = null))
    return opening
  }

  /** What the device kept in line shows as bubbles again (their threads are read when a screen opens them). */
  function showRestored(q: SaveQueue<SendJob>, member: string) {
    const snapshot = q.snapshot()
    waiting.value = snapshot.jobs.length
    const put = (job: SendJob, state: 'sending' | 'failed', error: string | null) => {
      const list = thread(job.conversationId, job.threadId).messages
      if (list.some((m) => m.clientId === job.clientId)) return
      mergeBubble(list, { ...pendingBubble(job, member, nameOf(job.conversationId, member)), state, error: error as BuddyErrorCode | null })
    }
    for (const job of snapshot.jobs) put(job.payload, 'sending', null)
    for (const refusal of snapshot.refusals) put(refusal.payload, 'failed', refusal.error)
  }

  function closeQueue() {
    queue?.stop()
    queueTab?.release()
    queue = null
    queueTab = null
    queueFor = null
  }

  /**
   * Writes a message: a bubble at once, the queue sends it. The room is `sectionId` null. A text with nothing to read is not sent
   * (the database would refuse it as `message_body_invalid`, and she should not wait to hear it). The screen words the codes.
   */
  async function send(readId: string, sectionId: string | null, body: string, { replyTo = null, spoiler = false }: { replyTo?: string | null; spoiler?: boolean } = {}): Promise<BuddySend> {
    const member = me.value
    if (!member) return { ok: false, error: 'not_signed_in' }
    if (!/[^\s\u00a0\u200b\p{Cc}]/u.test(body) || body.length > 2000) return { ok: false, error: 'message_body_invalid' }
    await ensureQueue()
    const job: SendJob = { conversationId: readId, threadId: sectionId, clientId: newId(), kind: 'text', body, replyTo, spoiler: sectionId === null ? false : spoiler, createdAt: new Date().toISOString() }
    mergeBubble(thread(readId, sectionId).messages, pendingBubble(job, member, nameOf(readId, member)))
    queue!.enqueue(buddySendKey(job.clientId), job)
    return { ok: true, clientId: job.clientId }
  }

  /** Sends a refused message again (the refusal is forgotten, the bubble is on its way). */
  async function retry(readId: string, sectionId: string | null, clientId: string) {
    await ensureQueue()
    const refusal = queue?.snapshot().refusals.find((r) => r.payload.clientId === clientId)
    const bubble = messagesOf(readId, sectionId).find((m) => m.clientId === clientId)
    if (!queue || !refusal || !bubble) return
    bubble.state = 'sending'
    bubble.error = null
    queue.enqueue(refusal.key, refusal.payload)
  }

  /** Gives up on a message that was refused or is still waiting: the bubble goes. */
  function discard(readId: string, sectionId: string | null, clientId: string) {
    queue?.remove(buddySendKey(clientId))
    queue?.dismissRefusal(buddySendKey(clientId))
    const list = thread(readId, sectionId).messages
    const at = list.findIndex((m) => m.clientId === clientId && m.state !== 'sent')
    if (at >= 0) list.splice(at, 1)
  }

  /** Back online, or the page is visible again: the line goes at once instead of waiting out its pause. */
  function kick() {
    queue?.kick()
  }

  // ------------------------------------------------------------------ reads

  /** Her reads and invitations, for Home and the invitation row: one query, asked on focus (no live channel). */
  async function loadMine(): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.mine()
    if (answer.error) return answer.error
    mine.value = answer.data
    return null
  }

  /** One read as its screen draws it; its counts replace what the store counted itself. */
  async function load(readId: string): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.read(readId)
    if (answer.error) {
      // She is not in it (any more): nothing of it is kept.
      if (answer.error === 'not_found') forget(readId)
      return answer.error
    }
    reads.value[readId] = answer.data
    return null
  }

  function forget(readId: string) {
    delete reads.value[readId]
    for (const key of Object.keys(threads.value)) if (key === readId || key.startsWith(`${readId}#`)) delete threads.value[key]
    if (mine.value) mine.value = { ...mine.value, reads: mine.value.reads.filter((x) => x.id !== readId) }
  }

  /** A write that changes a read: on success the read (and her list) are read again. */
  async function act<T>(readId: string | null, call: (r: BuddyReads) => Promise<BuddyResult<T>>, after: 'read' | 'forget' | 'mine' | 'none' = 'read'): Promise<BuddyResult<T>> {
    const r = repo()
    if (!r) return unavailable()
    const answer = await call(r)
    if (answer.error || !readId) return answer
    if (after === 'forget') forget(readId)
    else if (after === 'read') await load(readId)
    if (after === 'forget' || after === 'mine') void loadMine()
    return answer
  }

  const create = (input: CreateBuddyRead) => act(null, (r) => r.create(input))
  const invite = (readId: string, members: string[]) => act(readId, (r) => r.invite(readId, members))
  const setLink = (readId: string, on: boolean, renew = false) => act(readId, (r) => r.link(readId, on, renew))
  const target = (token: string) => (repo() ? repo()!.target(token) : Promise.resolve(unavailable<null>()))
  const join = async (token: string) => {
    const answer = await act(null, (r) => r.join(token))
    if (!answer.error) void loadMine()
    return answer
  }
  const answerInvite = (readId: string, accept: boolean) => act(readId, (r) => r.answer(readId, accept), 'mine')
  const leave = (readId: string, deleteMessages = false) => act(readId, (r) => r.leave(readId, deleteMessages), 'forget')
  const remove = (readId: string, member: string) => act(readId, (r) => r.remove(readId, member))
  const finish = (readId: string) => act(readId, (r) => r.finish(readId))
  const archive = (readId: string) => act(readId, (r) => r.archive(readId))
  const setSections = (readId: string, ...args: Parameters<BuddyReads['setSections']> extends [string, ...infer Rest] ? Rest : never) =>
    act(readId, (r) => r.setSections(readId, ...args))

  /** Her own `me` of a read changed (hand, entry): the Section and the marker follow at once. */
  async function changeMe(readId: string, call: (r: BuddyReads) => Promise<BuddyResult<BuddyMe>>): Promise<BuddyResult<BuddyMe>> {
    const r = repo()
    if (!r) return unavailable()
    const answer = await call(r)
    if (!answer.error) {
      const read = reads.value[readId]
      if (read) {
        read.me = answer.data
        read.readThrough = answer.data.readThrough
        const self = read.members.find((m) => m.id === me.value)
        if (self) self.where = answer.data.where
        read.marks = read.marks.filter((m) => m.memberId !== me.value).concat({ memberId: me.value!, readThrough: answer.data.readThrough })
      }
    }
    return answer
  }
  /** "Where are you?": the Sections she has read through, null for "automatic" (from her reading). */
  const setHand = (readId: string, through: number | null) => changeMe(readId, (r) => r.setHand(readId, through))
  /** Which of her Library entries the read follows (null: none). */
  const linkEntry = (readId: string, entry: string | null) => changeMe(readId, (r) => r.linkEntry(readId, entry))

  // ------------------------------------------------------------------ talking

  /** Her reaction: at once on the message, the database's answer settles it (a refusal puts the old one back). */
  async function react(readId: string, sectionId: string | null, messageId: string, emoji: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const bubble = messagesOf(readId, sectionId).find((m) => m.id === messageId)
    const before = bubble?.reactions
    if (bubble) bubble.reactions = reactedBy(bubble.reactions, emoji)
    const answer = await r.react(messageId, emoji)
    if (answer.error && bubble && before) bubble.reactions = before
    return answer.error
  }

  /** Her own message, or any of the room as the host: it stays as a tombstone (the live event does the rest for the others). */
  async function deleteMessage(readId: string, sectionId: string | null, messageId: string): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.deleteMessage(messageId)
    if (!answer.error) tombstone(readId, sectionId, messageId)
    return answer.error
  }

  function tombstone(readId: string, sectionId: string | null, messageId: string) {
    const list = messagesOf(readId, sectionId)
    const at = list.findIndex((m) => m.id === messageId)
    if (at < 0 || list[at]!.deletedAt) return
    const read = reads.value[readId]
    if (read) bumpCounts(read, sectionId, { count: -1 })
    list[at] = tombstoneOf(list[at]!, new Date().toISOString())
  }

  const report = async (messageId: string, reason: ReportReason, note: string | null = null) => (repo() ? repo()!.report(messageId, reason, note) : unavailable())

  // ------------------------------------------------------------------ the veil

  /** The device's set of her peeks (the key carries her id, so another member's are never hers). */
  function peeksOf() {
    const storage = deviceStorage()
    if (!me.value) return null
    return createPeeks({ get: (k) => storage?.getItem(k) ?? null, set: (k, v) => storage?.setItem(k, v) }, buddyPeekKey(me.value))
  }
  const peeked = (sectionId: string): boolean => {
    void peekVersion.value
    return peeksOf()?.has(sectionId) ?? false
  }
  /** She opened a Section anyway ("Show anyway"): remembered on this device, her marker does not move. */
  function peek(sectionId: string) {
    peeksOf()?.add(sectionId)
    peekVersion.value++
  }

  /** What a Section may show her (the room, null, is always open). */
  function view(readId: string, sectionId: string | null): (ChapterView & { peeked: boolean }) | null {
    const read = reads.value[readId]
    if (!read) return null
    if (sectionId === null) return { open: true, veiled: false, showTitle: true, showUnread: true, peeked: false }
    const chapter = read.chapters.find((c) => c.id === sectionId)
    if (!chapter) return null
    const last = read.chapters.filter((c) => c.kind === 'chapter').length
    const was = peeked(sectionId)
    return { ...chapterView(chapter, read.readThrough, last, was), peeked: was }
  }

  /** New comments over the threads she may see (the room, the open Sections): a veiled Section's news is a spoiler and is not counted. */
  function unread(readId: string): number {
    const read = reads.value[readId]
    if (!read) return 0
    return read.chapters.reduce((sum, c) => sum + (view(readId, c.id)?.showUnread ? c.unread : 0), read.room.unread)
  }

  // ------------------------------------------------------------------ live

  let live: BuddyLive | null = null
  let liveOpening: Promise<BuddyLive | null> | null = null
  const stops: Array<() => void> = []

  /** The lazy door: the module and the real client load when a screen first retains the channel, not before. */
  function liveOf(): Promise<BuddyLive | null> {
    if (live) return Promise.resolve(live)
    if (!backend || !config.ok || typeof window === 'undefined') return Promise.resolve(null)
    const app = config.config
    liveOpening ??= import('~/data/buddyLive').then(({ browserLiveEnv, createBuddyLive }) => {
      const made = createBuddyLive({
        url: app.supabaseUrl,
        anonKey: app.supabaseAnonKey,
        token: async () => (await backend.auth.getSession()).data.session?.access_token ?? null,
        load: () => import('#realtime-client') as unknown as Promise<LiveRealtimeModule>,
        env: browserLiveEnv(window),
        onChange: (state) => {
          liveStatus.value = state.status
          if (state.status === 'live' && state.online) kick()
        },
      })
      stops.push(
        made.on('message', (e) => arrived(sentBubble(withName(e.message)), true)),
        made.on('deleted', (e) => tombstone(e.readId, e.sectionId, e.messageId)),
        made.on('reaction', (e) => void reacted(e)),
        made.on('changed', (e) => void changedRead(e.readId)),
        made.on('invitation', () => void loadMine()),
        made.on('resync', () => void resync()),
      )
      live = made
      return made
    })
    return liveOpening
  }

  const withName = (m: BuddyMessage): BuddyMessage => ({ ...m, authorName: m.authorName ?? nameOf(m.conversationId, m.senderId) })

  /** A reaction of somebody's: the aggregates carry no member, so the message is read again (one message, not the thread). */
  async function reacted(e: Extract<BuddyLiveEvent, { type: 'reaction' }>) {
    const r = repo()
    if (!r) return
    for (const key of Object.keys(threads.value)) {
      const bubble = threads.value[key]!.messages.find((m) => m.id === e.messageId)
      if (!bubble || bubble.conversationId !== e.readId) continue
      // Her own, already shown by her tap.
      if (e.memberId === me.value && (bubble.reactions.find((x) => x.mine)?.emoji ?? null) === e.emoji) return
      const answer = await r.messages(e.readId, bubble.threadId, { before: justAfter(bubble.createdAt), limit: 5 })
      const fresh = answer.data?.items.find((m) => m.id === e.messageId)
      if (fresh) bubble.reactions = fresh.reactions
      return
    }
  }

  /** A member, a role, a Section or the status changed: the read is read again (only when a screen has it). */
  async function changedRead(readId: string) {
    if (reads.value[readId]) await load(readId)
  }

  /** The channel was down or may have missed something: the reads she has open, their open threads and her list are read again. */
  async function resync() {
    await Promise.all(Object.keys(reads.value).map((id) => load(id)))
    for (const [key, t] of Object.entries(threads.value)) {
      if (!t.loaded) continue
      const [readId, sectionId] = key.includes('#') ? (key.split('#') as [string, string]) : [key, null]
      if (!reads.value[readId]) continue
      if ((viewing[key] ?? 0) > 0) await loadNewest(readId, sectionId)
      // A thread nobody looks at is read afresh when it is opened again, not kept stale.
      else t.loaded = false
    }
    if (mine.value) await loadMine()
    kick()
  }

  /**
   * A buddy read screen (or the invitation row) needs the live channel. Returns the function that lets it go: call it when the screen
   * closes. Nothing starts without a signed-in member, and nothing loads before this is called.
   */
  async function retain(): Promise<() => void> {
    const member = me.value
    if (!member) return () => {}
    const door = await liveOf()
    if (!door) return () => {}
    return door.retain(member)
  }

  // ------------------------------------------------------------------ sign-out

  /** Forgets everything of the member and closes what is open (sign-out, another member). */
  async function reset() {
    closeQueue()
    opening = null
    reads.value = {}
    mine.value = null
    threads.value = {}
    waiting.value = 0
    for (const key of Object.keys(viewing)) delete viewing[key]
    for (const stop of stops.splice(0)) stop()
    const door = live
    live = null
    liveOpening = null
    liveStatus.value = 'idle'
    await door?.stop()
  }
  watch(me, (now, before) => {
    if (before && now !== before) void reset()
  })
  // The connection is back: the line goes at once instead of waiting out its pause.
  watch(online, (now) => {
    if (now) kick()
  })

  return {
    reads,
    mine,
    threads,
    waiting,
    liveStatus,
    peekVersion,
    // threads
    messagesOf,
    openThread,
    closeThread,
    loadOlder,
    markThread,
    send,
    retry,
    discard,
    kick,
    react,
    deleteMessage,
    report,
    // reads
    loadMine,
    load,
    create,
    invite,
    setLink,
    target,
    join,
    answerInvite,
    leave,
    remove,
    finish,
    archive,
    setSections,
    setHand,
    linkEntry,
    // the veil
    peeked,
    peek,
    view,
    unread,
    // live
    retain,
    reset,
    countsOf: (readId: string, sectionId: string | null) => (reads.value[readId] ? countsOf(reads.value[readId]!, sectionId) : null),
  }
})

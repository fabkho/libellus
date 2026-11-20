import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import type { BubbleQuote } from '#layers/ui/app/utils/chat/message'
import { computed, nextTick, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useVoicePress, type VoicePressPlayer } from '~/composables/useVoicePress'
import type { PreparedVoice } from '~/data/buddyVoice'
import type { ReportReason } from '~/data/buddyReads'
import { quoteOf, replyChipOf, type QuoteSource, type QuoteWords, type ThreadItem } from '~/utils/roomThread'

/**
 * The thread screen two pages share: a buddy read's Section (pages/together/[id]/[section].vue) and a Book's chapter of Notes
 * (pages/notes/[book]/[chapter].vue). Both draw the base's `UiChatThread` over a store's messages and carry the same state machine —
 * open and load, earlier pages on scrolling up, send and retry and discard, react, answer, the action bar, the veil, the press on a
 * voice message — and differ only in what their store and their words are.
 *
 * This is that shared half. It never asks which page it is on: everything a page decides differently arrives in its **adapter** (the
 * store's calls, addressed by the page's own room and section) or in its **opts** (the words, the emoji, what the page allows, the
 * buttons only its bar has). What stays in a page is what only one of them has: the audience of a note and the level flow, the
 * microphone's gate, the edit flow, an archived read's read-only composer, the banners, the title and the address.
 *
 * A note's audience is never seen here: the notes page closes over its level inside its own `send`/`sendVoice`. The shell of a screen — its
 * load, the thread opening when the veil lets her in, the channel where a page has one, the connection coming back, the heading's focus and
 * the teardown — is `start()`.
 */

/** A refusal, as a code: a note's (`NoteErrorCode`) or a buddy read's (`BuddyErrorCode`). The page words it (`adapter.errorWord`). */
export type ThreadError = string

/** What a send answered: the store's `{ ok, error }`, with the code kept and not worded. */
export type SendResult = { ok: boolean; error?: ThreadError }

/** What a thread says of its pages: the store's own (`more`, `loading`, `loaded`), and whether the page the thread hangs on is loaded. */
export type ThreadPaging = {
  /** There is a page before the oldest message. */
  more: boolean
  /** A page is on its way. */
  loading: boolean
  /** The thread's newest page is in: its items may be drawn. */
  loaded: boolean
  /** The read, or the Book's Notes page, is loaded. */
  room: boolean
}

/** What `itemsOf` needs of the screen: who she is, whether the thread is open to her, the words, and the device's own copies. */
export type ThreadItemsContext = {
  me: string | null
  /** The veil's answer (`utils/roomThread.ts` `RoomThreadContext.open`). */
  open: boolean
  nameOf: (memberId: string | null) => string | null
  previewOf: (clientId: string | null) => string | null
  errorWord: (code: ThreadError) => string
  retryable: (code: ThreadError) => boolean
}

/**
 * One page's store, as the thread screen calls it. Every call closes over the page's own addressing (`threadKey(read, section)`,
 * `store.messagesOf(room, chapter)`): the room and the Section are the page's, never the screen's.
 */
export type ThreadScreenAdapter<Bubble, Item extends ThreadItem> = {
  /** The signed-in member's id, or null. */
  me: () => string | null
  /** The thread is open to her (the veil's answer; a buddy read's room always is). */
  isOpen: () => boolean
  /** How far the store has read this thread. */
  paging: () => ThreadPaging
  /** A member's name among the thread's readers, or null. */
  nameOf: (memberId: string | null) => string | null
  /** The device's own copy of a recording she sent in this session, by client id. */
  previewOf: (clientId: string | null) => string | null
  /** The sentence a refusal is worded with (`notes.error.<code>`, `buddyRead.error.<code>`). */
  errorWord: (code: ThreadError) => string
  /** Whether a second try can change a refusal (`isRetryableNoteError`, `isRetryableBuddyError`). */
  retryable: (code: ThreadError) => boolean
  /** Where a message's quote comes from (`utils/notes.ts`'s `quoteSourceOf` for a note, the reply for a buddy read). */
  quoteSourceOf: (item: Item, me: string | null) => QuoteSource | null
  /** The store's bubbles of this thread, oldest first. */
  bubblesOf: () => readonly Bubble[]
  /** Those bubbles as the screen draws them (`roomItems`, `noteItems`), with the veil applied there. */
  itemsOf: (bubbles: readonly Bubble[], ctx: ThreadItemsContext) => Item[]
  openThread: () => Promise<ThreadError | null>
  closeThread: () => void
  /** The address has no thread to open (she is not in the read, the chapter is not this Book's): one quiet answer instead. */
  missing: () => boolean
  /** A Chapter or a Section the veil keeps shut: the quiet screen with "Show anyway". */
  veiled: () => boolean
  /** Asked again when the app comes back to the front (a Book's Notes: no Realtime). A buddy read's channel keeps itself in line. */
  refresh?: () => Promise<ThreadError | null>
  loadOlder: () => Promise<void>
  /** She opened a veiled Chapter or Section anyway ("Show anyway"), on this device: her marker does not move. */
  peek: () => void
  /** The live channel, kept while the screen shows (a buddy read only). Resolves the way to let it go. */
  retain?: () => Promise<() => void>
  /** Where Back goes when the history has none (the page's own list). */
  backTo: () => string
  send: (body: string, extra: { replyToId: string | null; quote: unknown }) => Promise<SendResult>
  sendVoice: (voice: PreparedVoice, extra: { replyToId: string | null; quote: unknown }) => Promise<SendResult>
  retry: (key: string) => Promise<void>
  discard: (key: string) => void
  react: (id: string, emoji: string) => Promise<ThreadError | null>
  deleteMessage: (id: string) => Promise<ThreadError | null>
  report: (id: string, reason: ReportReason, note: string | null) => Promise<ThreadError | null>
  voiceUrl: (path: string) => Promise<{ data: string; error: null } | { data: null; error: string }>
}

/** What a page says and allows; the screen never decides any of it. */
export type ThreadScreenOpts<Item extends ThreadItem> = {
  /** The thread's reactions, in the bar's order. */
  emojis: readonly string[]
  /** The first of them: what a double tap on a message puts on it. */
  likeEmoji: string
  /** A message of this thread may be liked at all (an archived buddy read may not; a note always may). */
  canLike: () => boolean
  /** The thread takes writing (an archived buddy read does not: its composer is a line, and no bar offers anything). */
  canWrite: () => boolean
  quoteWords: () => QuoteWords
  /** The base's two words of the bar ("Report", "Delete"), before the page's own. */
  barWords: () => { report: string; delete: string }
  /** What only this page's bar offers, after the base's Report and Delete. */
  extraActions: (item: Item) => BarAction[]
  /** A bar button was pressed: whether this page opened its own sheet for it (`edit`, `visibility`, `block`). */
  onAction?: (id: string, item: Item) => boolean
  /** What a note sends with an answer (the server's own quote shape); a buddy read sends the id alone. */
  sendQuote?: (item: Item) => unknown
  /** "You are offline", in the app's words for this screen. */
  offlineWord: () => string
  /** "That recording will not play", in the app's words for this screen. */
  failedWord: () => string
  /** The screen's test id prefix (`notesThread`, `buddyThread`): the composer's field is `<prefix>.composer`. */
  composerTestid: string
  /** The base's one audio element (`useVoicePlayer`). */
  voicePlayer: VoicePressPlayer
}

// ------------------------------------------------------------------ behaviour

/** What the screen hands a page: one key per thing the page binds, and the two calls that mount and silence it. */
export type ThreadScreen<Item extends ThreadItem> = {
  /** The messages of the thread, oldest first; none at all while it is not open to her. */
  items: ComputedRef<Item[]>
  /** The page's or the read's own refusal, as a code (a send that was refused is `notice`, already worded). */
  error: Ref<ThreadError | null>
  status: ComputedRef<'loading' | 'ready' | 'error'>
  /**
   * The thread was in the store when the screen mounted: its first frame is `ready`, and the page plays
   * the thread's reveal *instead of* the skeleton (docs/MOTION.md, "A chapter's notes"). False for a thread
   * that had to be read: its messages arrive with the motion of their own arrival.
   */
  revealed: ComputedRef<boolean>
  hasMore: ComputedRef<boolean>
  olderStatus: ComputedRef<'idle' | 'loading'>
  /** The page before the oldest message: whether the list grew. */
  loadOlder: () => Promise<boolean>
  /** What she is writing. */
  text: Ref<string>
  /** The message she answers, or null. */
  replyTo: Ref<Item | null>
  /** A refusal worded above the thread (a send that was refused, a recording that would not play). */
  notice: Ref<string | null>
  /** The messages that arrived after the thread was shown: they play the arrival animation once. */
  fresh: Ref<ReadonlySet<string>>
  /** The quote over a message, as the base draws it. */
  quoteFor: (item: Item) => BubbleQuote | null
  /** The quote over the composer while she answers one. */
  replyChip: ComputedRef<{ name: string; preview: string } | null>
  send: () => Promise<void>
  sendVoice: (voice: PreparedVoice) => Promise<void>
  retry: (key: string) => Promise<void>
  discard: (key: string) => void
  /** Answers a message: it becomes the quote over the composer. */
  answer: (key: string) => void
  react: (id: string, emoji: string) => Promise<void>
  /** The bar's buttons for one message: the base's Report and Delete, then what the page adds. */
  actionsOf: (item: Item) => BarAction[]
  /** A bar button was pressed: the page's own first, then the screen's two. */
  action: (actionId: string, key: string) => void
  deleteRef: Ref<Item | null>
  /** What the confirm says for that message (the page's words). */
  deleteText: ComputedRef<string>
  deleteOpen: Ref<boolean>
  deleteBusy: Ref<boolean>
  deleteError: Ref<ThreadError | null>
  confirmDelete: () => Promise<void>
  reportId: Ref<string | null>
  reportOpen: Ref<boolean>
  /** The message id the report sheet answers, as the store takes it. */
  report: (id: string, reason: ReportReason, note: string | null) => Promise<ThreadError | null>
  /** The press on a voice message's play button (the capture phase of the thread's root). */
  onPress: (event: MouseEvent) => void
  /** "Show anyway": the sheet's open state, and the one way in. */
  showOpen: Ref<boolean>
  showAnyway: () => Promise<void>
  back: () => void
  /** Asked again (a Book's Notes, when the app comes back to the front or the page is pressed to refresh). */
  refresh: () => Promise<void>
  /**
   * Mounts the shell — the first load, the thread opening when the veil lets her in, the channel (where the page has one), the
   * connection coming back, the heading's focus and the teardown on unmount — and returns that teardown.
   */
  start: () => () => void
}

/**
 * The thread screen of one page, over its adapter and its opts. Everything that differs between a buddy read and a Book's Notes is
 * asked of them; nothing here looks at where it is drawn (no word, no route, no product word).
 */
export function useThreadScreen<Bubble, Item extends ThreadItem>(adapter: ThreadScreenAdapter<Bubble, Item>, opts: ThreadScreenOpts<Item>): ThreadScreen<Item> {
  // ------------------------------------------------------------------ the messages

  const items = computed<Item[]>(() =>
    adapter.itemsOf(adapter.bubblesOf(), {
      me: adapter.me(),
      open: adapter.isOpen(),
      nameOf: adapter.nameOf,
      previewOf: adapter.previewOf,
      errorWord: adapter.errorWord,
      retryable: adapter.retryable,
    }),
  )
  const byKey = computed(() => new Map(items.value.map((item) => [item.key, item])))
  const itemOf = (key: string): Item | undefined => byKey.value.get(key)

  /** The messages that came after the thread was shown: they play the arrival animation once (and not for an earlier page). */
  const fresh = ref<ReadonlySet<string>>(new Set())
  let known = new Set<string>()
  let settled = false
  watch(
    () => (adapter.paging().loaded ? items.value.map((item) => item.key) : null),
    (keys) => {
      if (!keys) return
      const added = keys.filter((key) => !known.has(key))
      known = new Set([...keys, ...added])
      if (settled && added.length) fresh.value = new Set([...fresh.value, ...added])
      settled = true
    },
    { immediate: true },
  )

  const hasMore = computed(() => adapter.paging().more)
  const olderStatus = computed<'idle' | 'loading'>(() => (adapter.paging().loading && adapter.paging().loaded ? 'loading' : 'idle'))
  /** The page before the oldest message, and whether the list grew (the base scrolls back to what was being read only then). */
  async function loadOlder(): Promise<boolean> {
    const before = items.value.length
    await adapter.loadOlder()
    return items.value.length > before
  }

  const quoteFor = (item: Item): BubbleQuote | null => quoteOf(items.value, adapter.quoteSourceOf(item, adapter.me()), opts.quoteWords())

  // ------------------------------------------------------------------ writing

  const text = ref('')
  const replyTo = ref<Item | null>(null) as Ref<Item | null>
  const notice = ref<string | null>(null)
  const replyChip = computed(() => (replyTo.value ? replyChipOf(replyTo.value, opts.quoteWords()) : null))

  /** What an answer carries besides its words: the id, and the quote the page's own database takes (a note's shape; none for a buddy read). */
  const extraOf = (item: Item | null) => ({ replyToId: item?.id ?? null, quote: item && opts.sendQuote ? opts.sendQuote(item) : null })

  async function send(): Promise<void> {
    const body = text.value
    if (!body.trim()) return
    notice.value = null
    const sent = await adapter.send(body, extraOf(replyTo.value))
    if (!sent.ok) {
      notice.value = adapter.errorWord(sent.error ?? 'unknown')
      return
    }
    text.value = ''
    replyTo.value = null
  }

  /** A finished recording from the composer: a bubble at once, stored, then posted. A refusal (too short, too big) is said above the thread. */
  async function sendVoice(voice: PreparedVoice): Promise<void> {
    notice.value = null
    const sent = await adapter.sendVoice(voice, extraOf(replyTo.value))
    if (!sent.ok) {
      notice.value = adapter.errorWord(sent.error ?? 'unknown')
      return
    }
    replyTo.value = null
  }

  async function retry(key: string): Promise<void> {
    const item = itemOf(key)
    // Refused for a reason a second try cannot change: the tap on the bubble leads nowhere, "Delete" is what is offered.
    if (item && !item.permanent) await adapter.retry(key)
  }

  /** A message that was refused (or still waits) is given up: the bubble goes, and the refusal the device kept with it. */
  function discard(key: string): void {
    adapter.discard(key)
  }

  async function react(messageId: string, emoji: string): Promise<void> {
    const failed = await adapter.react(messageId, emoji)
    notice.value = failed ? adapter.errorWord(failed) : null
  }

  function answer(key: string): void {
    const item = itemOf(key)
    if (item?.id && !item.removed) replyTo.value = item
  }

  // ------------------------------------------------------------------ the action bar

  /**
   * The bar's buttons: the base's Report (somebody else's message) and Delete (hers), then the page's own (an archived read's Host
   * deletes anybody's, a note offers Edit and its audience). Nothing on a tombstone or a message still on its way, and nothing at
   * all where the page takes no writing.
   */
  function actionsOf(item: Item): BarAction[] {
    if (item.removed || !item.id || !opts.canWrite()) return []
    const words = opts.barWords()
    const mine: BarAction[] = []
    if (!item.mine) mine.push({ id: 'report', label: words.report, icon: 'flag' })
    if (item.mine) mine.push({ id: 'delete', label: words.delete, icon: 'trash' })
    return [...mine, ...opts.extraActions(item)]
  }

  /** The message the confirm is about. */
  const deleteRef = ref<Item | null>(null) as Ref<Item | null>
  const deleteOpen = ref(false)
  const deleteBusy = ref(false)
  const deleteError = ref<ThreadError | null>(null)
  const reportId = ref<string | null>(null)
  const reportOpen = ref(false)
  const deleteText = computed(() => (deleteRef.value ? opts.deleteText(deleteRef.value) : ''))

  async function confirmDelete(): Promise<void> {
    const item = deleteRef.value
    if (!item?.id || deleteBusy.value) return
    deleteBusy.value = true
    deleteError.value = null
    const failed = await adapter.deleteMessage(item.id)
    deleteBusy.value = false
    if (failed) deleteError.value = failed
    else deleteOpen.value = false
  }

  /**
   * A bar button was pressed. The page's own buttons are only its to open (`onAction`), so it is asked first — under the same guard
   * the bar was drawn with (a tombstone, a message still on its way, a page that takes no writing) — and Delete and Report, which
   * every thread has, are the screen's.
   */
  function action(actionId: string, key: string): void {
    const item = itemOf(key)
    if (!item || !actionsOf(item).some((button) => button.id === actionId)) return
    if (actionId !== 'delete' && actionId !== 'report') {
      opts.onAction?.(actionId, item)
      return
    }
    // A read's Host removes anybody's message, so the page may take Delete for its own words: it is asked first.
    if (opts.onAction?.(actionId, item)) return
    if (actionId === 'delete') {
      deleteRef.value = item
      deleteError.value = null
      deleteOpen.value = true
    } else {
      reportId.value = item.id
      reportOpen.value = true
    }
  }

  // ------------------------------------------------------------------ playing a voice message

  /** The whole press-to-play interaction, once for both threads (`composables/useVoicePress.ts`): what differs is handed in. */
  const { onPress } = useVoicePress({
    items: () => items.value,
    isOpen: adapter.isOpen,
    canLike: opts.canLike,
    likeEmoji: opts.likeEmoji,
    like: (id, emoji) => void react(id, emoji),
    notice: (message) => (notice.value = message),
    isPreview: (key) => !!adapter.previewOf(key),
    voiceUrl: (path) => adapter.voiceUrl(path),
    offlineWord: opts.offlineWord,
    failedWord: opts.failedWord,
    voicePlayer: opts.voicePlayer,
  })


  // ------------------------------------------------------------------ the shell

  const error = ref<ThreadError | null>(null)
  const status = computed<'loading' | 'ready' | 'error'>(() => {
    const paging = adapter.paging()
    if (error.value && !paging.loaded) return 'error'
    if (!paging.room) return 'loading'
    return paging.loaded ? 'ready' : 'loading'
  })

  /**
   * Whether this mount opened on a thread the store already held, read once: `adapter.paging()` is asked
   * synchronously here, in setup, before the open the watch below starts — so the first frame of a
   * re-entry is `ready`, and the page reveals what it drew instead of the skeleton (the reveal, and how it
   * is keyed, are the page's own: `pages/notes/[book]/[chapter].vue`).
   *
   * Only the mount counts. A thread that had to be read is false for good: its messages come in from
   * under the skeleton, with the motion of their own arrival, and a second animation over those would be
   * one too many.
   */
  const revealed = computed(() => held)
  const held = adapter.paging().loaded && !adapter.missing()

  /** Back to the page's own list when the history has nowhere to go (a link opened straight into the thread). */
  function back(): void {
    if (window.history.state?.back) useRouter().back()
    else void navigateTo(adapter.backTo())
  }

  async function refresh(): Promise<void> {
    if (!adapter.refresh) return
    error.value = await adapter.refresh()
  }

  async function load(): Promise<void> {
    error.value = await adapter.loadInitial()
  }

  /** The live channel is kept while this screen shows and let go when it goes (a buddy read has one; a Book's Notes has none). */
  let release: (() => void) | null = null
  let opened = false

  /** Nothing of a Chapter or a Section is read until it is open to her: the store says so, or she said "Show anyway". */
  async function openThread(): Promise<void> {
    // The address names no thread of this page (she is not in the read, the chapter is not this Book's): nothing is asked for it.
    if (opened || adapter.missing()) return
    opened = true
    const failed = await adapter.openThread()
    if (!failed) return
    opened = false
    adapter.closeThread()
    error.value = failed
  }

  /**
   * The shell of a thread screen, started once (a page calls it in its setup): the read (or the page) not read yet, the thread opening
   * when the veil lets her in, the live channel where the page has one, the connection coming back — which asks a refused open again —
   * the app coming back to the front where the page has no channel, and the heading's focus. Returns the teardown: the last screen lets
   * the channel and the thread go.
   *
   * It asks nothing of a component of its own (an SPA's setup runs before the first paint anyway), so a screen can be driven in Node:
   * `tests/thread-screen.test.ts` mounts it in an effect scope and stops it the way a page unmounting does.
   */
  function start(): () => void {
    let gone = false
    /** The document's listener, where the page has no channel (see below). */
    let onVisible: (() => void) | null = null
    const stop = () => {
      if (gone) return
      gone = true
      release?.()
      release = null
      if (opened) adapter.closeThread()
      opened = false
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
    }
    // The page's own effect scope goes when the page unmounts; this is the one place that hears it, a component or not.
    onScopeDispose(stop)

    if (adapter.retain) {
      // Never throws: a channel that cannot be had is the store's `liveStuck`, said above the thread, and asked for again by the store.
      void adapter.retain().then((letGo) => {
        if (gone) letGo()
        else release = letGo
      })
    }
    if (!adapter.paging().room && !adapter.missing()) void load()
    watch(() => adapter.isOpen(), (open) => open && void openThread(), { immediate: true })
    // Back online after a failure: asked again. Nothing is asked twice when nothing failed.
    watch(useOnline(), (now) => {
      if (!now) return
      if (!adapter.paging().room && !adapter.missing()) void load()
      else if (error.value && adapter.isOpen()) {
        error.value = null
        opened = false
        void openThread()
      }
    })
    // A page without a channel reads again when the app comes back to the front (its thread would otherwise show what it showed then).
    if (adapter.refresh) {
      onVisible = () => {
        if (document.visibilityState === 'visible' && isOnline()) void refresh()
      }
      document.addEventListener('visibilitychange', onVisible)
    }
    // The heading takes the focus once it is drawn (useFocusHeading: a pushed screen entered with Enter on a row).
    useFocusHeading(() => adapter.missing() || status.value === 'ready' || adapter.veiled())
    return stop
  }

  // ------------------------------------------------------------------ the veil

  const showOpen = ref(false)
  /** She said "Show anyway": once the thread is up, focus goes to the composer (the quiet screen she tapped on is gone; focus would be lost at the top of the page). */
  let focusComposerWhenReady = false
  function focusComposer() {
    if (!focusComposerWhenReady || status.value !== 'ready') return
    const field = document.querySelector<HTMLElement>(`[data-testid="${opts.composerTestid}.composer"] textarea, [data-testid="${opts.composerTestid}.composer"] input`)
    if (!field) return
    focusComposerWhenReady = false
    field.focus()
  }
  watch(status, () => void nextTick(focusComposer))
  async function showAnyway(): Promise<void> {
    focusComposerWhenReady = true
    adapter.peek()
    await nextTick()
    await nextTick()
    focusComposer()
  }

  return {
    items,
    error,
    status,
    revealed,
    hasMore,
    olderStatus,
    loadOlder,
    text,
    replyTo,
    notice,
    fresh,
    quoteFor,
    replyChip,
    send,
    sendVoice,
    retry,
    discard,
    answer,
    react,
    actionsOf,
    action,
    deleteRef,
    deleteText,
    deleteOpen,
    deleteBusy,
    deleteError,
    confirmDelete,
    reportId,
    reportOpen,
    report: adapter.report,
    onPress,
    showOpen,
    showAnyway,
    back,
    refresh,
    start,
  }
}

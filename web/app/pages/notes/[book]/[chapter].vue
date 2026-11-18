<script setup lang="ts">
// A chapter of a Book's Notes (docs/plans/book-notes.md parts 2.3, 2.5, 5; docs/parity.md, *Notes, a chapter*, *Notes, visibility*): the buddy read's thread screen, built from the same
// base components (`UiChatThread`, `UiBubble`, `UiComposer`, one reaction bar a bubble), filled with the notes of one chapter that she may see (stores/notes.ts): optimistic sends that wait
// in the queue, day separators, runs by author, earlier pages on scrolling up, a quote and a swipe to answer. What a note adds to a buddy read's message is its **audience**:
// - **marks**: a globe and "Everyone" in the bubble's sender line of a public note (others' and hers), a lock and "Only me" under her private one, nothing for Friends. While the owner's switch for
//   Everyone is off a public note counts as a friends' note: no globe, and her own says "Everyone · paused" in its action bar.
// - **the split send button** (`UiComposer` `sendOptions`, @fabkho/ui 0.13): the tab beside send opens the menu Only me · Friends · Everyone (two items without the switch; a reply's wider levels are off, with the reason), the
//   send button itself shows the chosen audience (glyph, tone and, for the marked ones, its word) before anything is sent, so nothing about it can fold away with the keyboard. A new note starts at the level the device
//   remembers (Only me or Friends); Everyone is for one note, the button returns to the remembered level after it is sent, and the one quiet line "Visible to all members of BetterReads, with your
//   name and photo. Just this note." stands over the capsule while it is on Everyone. A reply starts at the narrower of its parent's level and the remembered one and cannot be wider than the note it answers.
// - **the action bar**: the six reactions, Reply, Copy; on her note **Who can see this** and **Delete**; on another's **Report** (the sheet of the buddy read, to the owner) and **Block {name}**.
// - **quotes**: the server's word: the author and first words, "A note you can't see" for a note she may not read, "Note removed" for a tombstone, "Voice message" for a voice note.
// - **voice notes** (docs/parity.md, *Notes, a chapter*): the microphone is offered **only at Only me** (`voiceMaxMs`, gated by the audience: at Friends or Everyone it is gone, and the audience row is not
//   there while the microphone is live, so it cannot be changed under a recording; a recording that reaches `sendVoice` at another audience is never posted, it is dropped with a word). A recording is a
//   private note of its own, stored in the private bucket first and posted after (the same line, the same offline behaviour as a buddy read's voice message, stores/notes.ts); it is drawn by the base's
//   `UiVoiceBubble` with the lock and "Only me" like her other private notes. **Nothing is signed or fetched when the thread loads**: the play button's press is taken here first (`voicePress`, capture
//   phase) and asks the store for a URL of five minutes the first time; one voice at a time (the base's player); leaving the thread silences it. Nobody else can see a voice note, so this is only ever hers.
// **The veil** (the app's, as in a buddy read): a chapter that is not open to her (her chapter has not reached it and she has not opened it anyway) is not read at all: this page shows the quiet
// "hidden" screen with "Show anyway", and only her yes (a peek, kept on this device; her chapter does not move) asks the database for it. There are no spoiler marks on single notes (a chapter is opened to be read).
// Read when it opens, when the app comes back to the front and on Refresh: no Realtime (tests/notes-entry.test.ts).
import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import { isRetryableNoteError, NOTE_EMOJI, type NoteQuote } from '~/data/notes'
import type { ReportReason } from '~/data/buddyReads'
import { threadKey } from '#layers/chat/app/utils/thread'
import { isBookId, isChapterSegment, notesPath } from '~/utils/notesRoute'
import { chapterOfSegment, noteErrorKey, type NoteItem } from '~/utils/notes'
import { sameAuthorRun } from '~/utils/roomThread'
import { VOICE_MAX_MS, type PreparedVoice } from '~/data/buddyVoice'
import { clampToOffer, noteSendOptions, noteVoiceAllowed, settleLevel, startLevel, type NoteLevel } from '~/utils/noteVisibility'
import { useThreadScreen } from '~/composables/useThreadScreen'
import { notesThreadAdapter } from '~/utils/notesThreadAdapter'
import { useBookStore } from '~/stores/book'
import { useNotesStore } from '~/stores/notes'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'

definePageMeta({
  layout: 'tabs',
  screen: 'notes',
  pushed: true,
  // The tab bar steps away while the chat fills the screen (components/shell/TabBar.vue).
  immersive: true,
  // One page per thread: going from one chapter to another starts its own state (what she tapped, what she was writing).
  key: (route) => route.fullPath,
  validate: (route) => isBookId(route.params.book) && isChapterSegment(route.params.chapter),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useNotesStore()
const books = useBookStore()
const session = useSessionStore()
const social = useSocialStore()
const online = useOnline()

const bookId = computed(() => String(route.params.book))
const me = computed(() => session.member?.id ?? null)
const book = computed(() => books.page(bookId.value)?.book ?? null)
const room = computed(() => store.roomOf(bookId.value))
const chapter = computed(() => chapterOfSegment(room.value, route.params.chapter))
/** The veil's answer for this thread; null while the page is not loaded or the chapter is not part of it. */
const view = computed(() => (room.value && chapter.value ? store.view(room.value.id, chapter.value.id) : null))
const publicEnabled = computed(() => store.publicEnabled)

// ------------------------------------------------------------------ loading

const error = ref<NoteErrorCode | null>(null)
let opened = false

async function load() {
  error.value = await store.loadPage(bookId.value)
}
async function openThread() {
  if (opened || !room.value || !chapter.value) return
  opened = true
  const failed = await store.openThread(room.value.id, chapter.value.id)
  if (failed) {
    opened = false
    if (room.value && chapter.value) store.closeThread(room.value.id, chapter.value.id)
    error.value = failed
  }
}
async function refresh() {
  if (!chapter.value) return
  error.value = await store.refresh(bookId.value, chapter.value.id)
}
function onVisible() {
  if (document.visibilityState === 'visible' && online.value && opened) void refresh()
}

onMounted(async () => {
  void books.load(bookId.value)
  void store.loadConfig()
  document.addEventListener('visibilitychange', onVisible)
  if (!room.value) await load()
})
// Nothing of a chapter is read until it is open to her: the server says so (`open`), or she said "Show anyway".
watch(() => view.value?.open === true, (open) => open && void openThread(), { immediate: true })
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  if (opened && room.value && chapter.value) store.closeThread(room.value.id, chapter.value.id)
})
// Back online after a failure: asked again.
watch(online, (now) => {
  if (!now) return
  if (!room.value) void load()
  else if (error.value && view.value?.open) {
    error.value = null
    opened = false
    void openThread()
  }
})

const thread = computed(() => (room.value && chapter.value ? (store.threads[threadKey(room.value.id, chapter.value.id)] ?? null) : null))
const missing = computed(() => (!room.value && (error.value === 'not_found' || error.value === 'notes_unavailable')) || (!!room.value && !chapter.value))
const status = computed(() => {
  if (error.value && !thread.value?.loaded) return 'error'
  if (!room.value) return 'loading'
  return thread.value?.loaded ? 'ready' : 'loading'
})
useFocusHeading(() => missing.value || status.value === 'ready' || view.value?.veiled === true)

// ------------------------------------------------------------------ the thread screen

const quoteWords = computed(() => ({
  deleted: t('uiText.chat.reply.deleted'),
  someone: t('member.someone'),
  you: t('uiText.chat.reply.you'),
  hidden: t('notes.thread.hiddenQuote'),
  voice: t('notes.thread.voiceQuote'),
}))
const voicePlayer = useVoicePlayer()

/** A note and its own audience: what the server's quote of an answer needs (the chat layer never looks a note up later). */
function quoteOfNote(item: NoteItem | null): NoteQuote | null {
  if (!item || !item.id) return null
  return {
    kind: 'note',
    id: item.id,
    author: { id: item.authorId ?? '', name: item.author, photo: null },
    excerpt: item.voice ? '' : item.body.replace(/\s+/g, ' ').trim().slice(0, 140),
    voice: item.voice,
  }
}

/**
 * The half of this screen a buddy read's thread has too (`composables/useThreadScreen.ts`): the messages, the send queue's three
 * answers, the quotes, the action bar, the delete confirm, the veil's one way in, the load and the press on a voice note. The adapter
 * closes over this chapter (`notesThreadAdapter`); what is here is what only Notes has — the audience and its flow, the microphone's
 * gate, the edit flow, the Refresh and the visibility it is asked on.
 */
const screen = useThreadScreen(
  notesThreadAdapter({
    store,
    bookId: () => bookId.value,
    roomId: () => room.value?.id ?? '',
    chapterId: () => chapter.value?.id ?? '',
    hasRoom: () => !!room.value && !!chapter.value,
    me: () => me.value,
    isOpen: () => view.value?.open === true,
    errorWord: (code) => t(noteErrorKey(code as NoteErrorCode)),
    retryable: (code) => isRetryableNoteError(code as NoteErrorCode),
    level: () => level.value,
    voiceAllowed: () => noteVoiceAllowed(sendAs.value as NoteLevel, parentForVoice.value),
    backTo: () => notesPath(bookId.value),
  }),
  {
    emojis: NOTE_EMOJI,
    likeEmoji: NOTE_EMOJI[0]!,
    canLike: () => true,
    canWrite: () => true,
    quoteWords: () => quoteWords.value,
    barWords: () => ({ report: t('notes.thread.report'), delete: t('notes.thread.delete') }),
    extraActions: (item) => extraActions(item),
    onAction: (id, item) => takesAction(id, item),
    sendQuote: quoteOfNote,
    deleteText: () => t('notes.thread.deleteText'),
    offlineWord: () => t(noteErrorKey('offline')),
    failedWord: () => t('notes.thread.voicePlayFailed'),
    composerTestid: 'notesThread',
    voicePlayer,
  },
)

const { items, text, replyTo, notice, fresh, hasMore, olderStatus, loadOlder, quoteFor, replyChip, retry, discard, react, answer, actionsOf, action, deleteOpen, deleteBusy, deleteError, deleteText, confirmDelete, reportId, reportOpen, report, onPress: voicePress } = screen

const byKey = computed(() => new Map(items.value.map((i) => [i.key, i])))
const noteOf = (item: { key: string }): NoteItem => byKey.value.get(item.key)!

// ------------------------------------------------------------------ title

const isEnd = computed(() => chapter.value?.kind === 'end')
const title = computed(() => (!chapter.value ? '' : isEnd.value ? t('notes.wholeBook') : t('notes.chapter', { n: chapter.value.position })))
useHead({ title: () => `${title.value || t('notes.title')} · ${t('app.name')}` })

// ------------------------------------------------------------------ the audience, which no buddy read has

const chat = useTemplateRef<{ jumpTo: (id: string) => Promise<void>; toNewest: () => void }>('chat')

/** The audience of the note she is writing. */
const level = ref<NoteLevel>(clampToOffer(store.remembered, store.publicEnabled))
/** What a reply may not be wider than: the note it answers, as it shows to her. */
const parentLevel = computed<NoteLevel | null>(() => (replyTo.value ? replyTo.value.effectiveVisibility : null))
/** The menu of the split send button: what each audience means, and why a wider one is off while she answers a narrower note. */
const sendOptions = computed(() =>
  noteSendOptions(publicEnabled.value, parentLevel.value, {
    levels: {
      private: { label: t('notes.level.private'), hint: t('notes.level.privateHint') },
      friends: { label: t('notes.level.friends'), hint: t('notes.level.friendsHint') },
      public: { label: t('notes.level.public'), hint: t('notes.level.publicHint') },
    },
    heldBack: t('notes.level.heldBack'),
  }),
)
/** `v-model:send-as` of the composer: the audience of the note she is writing (a value the menu does not know is not taken). */
const sendAs = computed<string>({
  get: () => level.value,
  set: (next) => chooseLevel(next as NoteLevel),
})

function startAgain() {
  level.value = settleLevel(startLevel(store.remembered, parentLevel.value), store.publicEnabled, parentLevel.value)
}
watch(replyTo, startAgain)
// The owner's switch changed while she was writing: Everyone is gone from the control, and from her choice.
watch(publicEnabled, () => (level.value = settleLevel(level.value, store.publicEnabled, parentLevel.value)))
function chooseLevel(next: NoteLevel) {
  level.value = settleLevel(next, store.publicEnabled, parentLevel.value)
  // The device remembers a choice for the next note, except Everyone: that is one note's.
  store.remember(level.value)
}

/** The note she answers, as the microphone's gate reads it (`noteVoiceAllowed`): hers, private and live, or nothing. */
const parentForVoice = computed(() => (replyTo.value ? { mine: replyTo.value.mine, visibility: replyTo.value.visibility as NoteLevel, removed: replyTo.value.removed } : null))

/**
 * The microphone: only while the split send button is on **Only me**, and only when the note is new or answers her own live private note (`noteVoiceAllowed`, tested in
 * Node). At Friends or Everyone the field is not offered a recording, so the capsule shows Send; an option that is not Only me takes the microphone away.
 */
const voiceMaxMs = computed(() => (noteVoiceAllowed(sendAs.value as NoteLevel, parentForVoice.value) ? VOICE_MAX_MS : undefined))

/** The thread's own send, and then the two things only Notes does: the control back on what the device remembers, the thread at its newest. */
async function send() {
  const wrote = text.value
  await screen.send()
  if (!wrote.trim() || text.value) return
  level.value = clampToOffer(store.remembered, store.publicEnabled)
  chat.value?.toNewest()
}
/** A finished recording: the screen's send, and the thread scrolled to its newest when it went. */
async function sendVoice(voice: PreparedVoice) {
  const before = notice.value
  await screen.sendVoice(voice)
  if (before === notice.value) chat.value?.toNewest()
}

// ------------------------------------------------------------------ the action bar

/** What only a note's bar offers: Edit and its audience on hers, Block on somebody else's. */
function extraActions(item: NoteItem): BarAction[] {
  if (!item.mine) return [{ id: 'block', label: t('notes.thread.block', { name: item.author?.trim() || t('member.someone') }), icon: 'ban' }]
  const list: BarAction[] = []
  // Her own live text note: its words can be corrected. A voice note is a recording and a tombstone stays one, so neither is offered it.
  if (!item.voice && !item.removed) list.push({ id: 'edit', label: t('notes.thread.edit'), icon: 'pencil' })
  // While the owner's switch is off her public note counts as a friends' one: the bar says so where she would change it.
  list.push({ id: 'visibility', label: item.visibility === 'public' && !publicEnabled.value ? t('notes.level.paused') : t('notes.visibilitySheet.title'), icon: item.visibility === 'public' ? 'globe' : item.visibility === 'private' ? 'lock' : 'people' })
  return list
}

const levelNote = ref<NoteItem | null>(null)
const levelOpen = ref(false)
const blocking = ref<NoteItem | null>(null)
const blockOpen = ref(false)
const blockBusy = ref(false)
const blockError = ref<string | null>(null)

/** The bar buttons that open a sheet of this page's own (Delete and Report are the screen's). */
function takesAction(actionId: string, item: NoteItem): boolean {
  if (actionId === 'edit') {
    openEdit(item)
    return true
  }
  if (actionId === 'visibility') {
    levelNote.value = item
    levelOpen.value = true
    return true
  }
  if (actionId === 'block') {
    blocking.value = item
    blockError.value = null
    blockOpen.value = true
    return true
  }
  return false
}

// ------------------------------------------------------------------ editing a note

/**
 * The note whose words she is rewriting (`notes.thread.edit` in its bar). Its own composer reuse: the capsule over the thread becomes an edit
 * field holding her note, with Save and Cancel, and the thread's own composer steps aside while it is open (one line writes at a time).
 */
const editing = ref<NoteItem | null>(null)
const editText = ref('')
const editBusy = ref(false)
const editError = ref<NoteErrorCode | null>(null)

/** The capsule becomes the field of her note, holding what it says: `saveEdit` writes it, `cancelEdit` leaves it be. */
function openEdit(item: NoteItem) {
  if (!item.id || item.voice || item.removed) return
  editing.value = item
  editText.value = item.body
  editError.value = null
  notice.value = null
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="notesThread.edit"] textarea, [data-testid="notesThread.edit"] input')?.focus())
}
function cancelEdit() {
  editing.value = null
  editText.value = ''
  editError.value = null
}
/** The edit's answer, as `send`'s: a refusal is said above the thread and the field keeps her words. */
async function saveEdit() {
  const item = editing.value
  if (!item?.id || editBusy.value || !room.value || !chapter.value) return
  const body = editText.value
  if (!body.trim()) return
  editBusy.value = true
  editError.value = null
  const failed = await store.editNote(room.value.id, chapter.value.id, item.id, body)
  editBusy.value = false
  if (failed) {
    editError.value = failed
    notice.value = t(noteErrorKey(failed))
    return
  }
  cancelEdit()
}
// Sign-out, another chapter, a note that became a tombstone under her: the field does not outlive its note.
watch(items, (now) => {
  const open = editing.value
  if (!open) return
  const same = now.find((i) => i.key === open.key)
  if (!same || same.removed) cancelEdit()
})

const reportNote = screen.report

/** Blocks the author of a note: silent, both ways, everywhere (the People screens' own call); what was hers on this page is gone when it is read again. */
async function confirmBlock() {
  const item = blocking.value
  if (!item?.authorId || blockBusy.value) return
  blockBusy.value = true
  blockError.value = null
  const result = await social.block(item.authorId)
  if (result.error) {
    blockBusy.value = false
    blockError.value = result.error === 'offline' ? t('common.offline') : t('people.error')
    return
  }
  await refresh()
  blockBusy.value = false
  blockOpen.value = false
}

// ------------------------------------------------------------------ the veil

const showOpen = ref(false)
/** She said "Show anyway": once the thread is up, focus goes to the composer (the quiet screen she tapped on is gone; focus would be lost at the top of the page). */
let focusComposerWhenReady = false
function focusComposer() {
  if (!focusComposerWhenReady || status.value !== 'ready') return
  const field = document.querySelector<HTMLElement>('[data-testid="notesThread.composer"] textarea, [data-testid="notesThread.composer"] input')
  if (!field) return
  focusComposerWhenReady = false
  field.focus()
}
watch(status, () => void nextTick(focusComposer))
async function showAnyway() {
  if (!room.value || !chapter.value) return
  focusComposerWhenReady = true
  store.peek(room.value.id, chapter.value.id)
  await nextTick()
  await nextTick()
  focusComposer()
}

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo(notesPath(bookId.value))
}
</script>

<template>
  <!-- Not a chapter of this Book's notes (any more): one quiet answer. -->
  <div v-if="missing" class="relative min-h-dvh" data-testid="notes.thread.missing">
    <UiTopBar :back-label="t('notes.thread.back')" back-testid="notes.thread.back" @back="back" />
    <FriendsNote heading :title="t('notes.missingTitle')" :text="t('notes.missingText')">
      <UiButton tone="secondary" size="md" :to="notesPath(bookId)" data-testid="notes.thread.missingBook">{{ t('notes.toNotes') }}</UiButton>
    </FriendsNote>
  </div>

  <!-- A veiled chapter: nothing of it is read. The number, why, and the one way in. -->
  <div v-else-if="view?.veiled" class="relative min-h-dvh" data-testid="notes.thread.veiled">
    <UiTopBar :back-label="t('notes.thread.back')" back-testid="notes.thread.back" @back="back" />
    <FriendsNote heading :title="isEnd ? t('notes.thread.veiledEnd') : t('notes.thread.veiledTitle', { n: chapter?.position ?? '' })" :text="t('notes.thread.veiledText')">
      <UiButton tone="secondary" size="md" data-testid="notes.thread.showAnyway" @click="showOpen = true">{{ t('notes.showAnyway.action') }}</UiButton>
    </FriendsNote>
    <RoomShowAnyway v-model:open="showOpen" prefix="notes.showAnyway" :number="chapter?.position ?? ''" :end="isEnd" @show="showAnyway" />
  </div>

  <UiChatThread
    v-else
    ref="chat"
    :items="items"
    :status="status"
    :label="t('notes.thread.label', { title })"
    :offline="!online"
    :error="notice"
    :has-more="hasMore"
    :older-status="olderStatus"
    :load-older="loadOlder"
    :conversation-key="`${bookId}:${chapter?.id ?? ''}`"
    :head-shown="items.length === 0"
    :same-run="sameAuthorRun"
    class="notes-thread"
    testid="notesThread"
    landmark
    @click.capture="voicePress"
  >
    <template #top>
      <UiRoundButton class="pointer-events-auto" icon="back" :label="t('notes.thread.back')" data-testid="notes.thread.back" @click="back" />
      <h1
        class="absolute left-1/2 w-max -translate-x-1/2 text-center text-body font-medium wrap-anywhere"
        style="max-width: calc(100% - 2 * (var(--spacing-inset) + var(--size-touch) + var(--spacing-sm)))"
        data-testid="notes.thread.title"
      >
        {{ title }}<span v-if="book" class="figures block text-caption font-normal text-ink-muted" data-testid="notes.thread.book">{{ book.title }}</span>
      </h1>
      <UiRoundButton class="pointer-events-auto" icon="repeat" :label="t('notes.thread.refresh')" :disabled="!online" data-testid="notes.thread.refresh" @click="refresh" />
    </template>

    <template #head>
      <p class="mx-auto max-w-prose px-xl py-xl text-center text-subhead text-ink-muted" data-testid="notes.thread.empty">
        {{ isEnd ? t('notes.thread.emptyEnd') : t('notes.thread.empty', { n: chapter?.position ?? '' }) }}
      </p>
    </template>

    <template #message="{ item, signed, endsRun, reacting, placement, highlight, openReactions, closeReactions }">
      <p v-if="item.kind === 'system'" class="px-md py-xs text-center text-caption text-ink-faint italic" data-testid="notesThread.removed">
        {{ noteOf(item).moderated ? t('notes.thread.moderated') : t('notes.thread.removed') }}
      </p>
      <UiBubble
        v-else
        :item="item"
        :read="false"
        :fresh="fresh.has(item.key)"
        :signed="signed && !item.mine"
        :sender="noteOf(item).author"
        :author="noteOf(item).author"
        :ends-run="endsRun"
        :can-react="true"
        :emojis="NOTE_EMOJI"
        :quote="quoteFor(noteOf(item))"
        :highlight="highlight"
        :actions="actionsOf(noteOf(item))"
        :reacting="reacting"
        :placement="placement"
        testid="notesThread"
        @react-open="openReactions"
        @react-close="closeReactions"
        @react="react"
        @action="action"
        @reply="answer"
        @retry="retry"
        @quote-tap="(id: string) => chat?.jumpTo(id)"
      >
        <!-- Who wrote it, and a public note's globe: "Mira K. 🌐 Everyone" (hers: the mark alone, at her side). -->
        <template #sender="{ signed: named, sender }">
          <p
            v-if="(named && sender) || noteOf(item).effectiveVisibility === 'public'"
            class="flex items-center gap-xs px-xs pb-xs text-caption text-ink-faint"
            :class="item.mine && 'justify-end'"
            data-testid="notesThread.sender"
          >
            <span v-if="named && sender" data-testid="notesThread.name">{{ sender }}</span>
            <span v-if="noteOf(item).effectiveVisibility === 'public'" class="inline-flex items-center gap-xxs" data-testid="notesThread.public">
              <UiIcon name="globe" :size="14" /><span>{{ t('notes.level.public') }}</span>
            </span>
          </p>
        </template>
        <!-- A quote with an id is the base's. One without says what it is in the app's words: "A note you can't see" (no name, no jump), or the tombstone's. -->
        <template #quote="{ quote, mine, tap }">
          <UiQuote v-if="quote?.id" class="mb-xs not-italic" :quote="quote" :mine="mine" testid="notesThread" @tap="tap" />
          <span
            v-else-if="quote"
            class="quote mb-xs flex w-full min-w-0 items-center gap-sm rounded-sm px-sm py-xs"
            :class="mine ? 'bg-on-ink/10' : 'bg-fill'"
            data-deleted="true"
            data-testid="notesThread.quote"
          >
            <span class="w-(--stroke-focus) shrink-0 self-stretch rounded-pill bg-accent" aria-hidden="true" />
            <span class="text-caption italic" :class="mine ? 'text-on-ink opacity-70' : 'text-ink-muted'" data-testid="notesThread.quotePreview">{{ quote.preview }}</span>
          </span>
        </template>
        <template #face>
          <FriendsAvatar :card="{ id: item.authorId ?? '', name: noteOf(item).author, photo: noteOf(item).authorPhoto }" />
        </template>
        <!-- Her private note says so under the bubble; a note that was refused says why: "Try again" unless nothing can change it, and "Delete" for good. -->
        <template
          v-if="item.delivery === 'failed' || (item.mine && noteOf(item).visibility === 'private') || noteOf(item).editedAt"
          #meta="{ time, showTime }"
        >
          <time :datetime="item.createdAt" class="px-xs pt-xs text-caption text-ink-faint tabular-nums" :class="showTime ? '' : 'sr-only'">{{ time }}</time>
          <!-- Her note was rewritten (`editedAt`): the caption says so, for anybody who may read it. -->
          <p v-if="noteOf(item).editedAt" class="px-xs text-caption text-ink-faint" data-testid="notesThread.edited">{{ t('notes.thread.edited') }}</p>
          <p v-if="item.mine && noteOf(item).visibility === 'private'" class="flex items-center justify-end gap-xxs px-xs pt-xs text-caption text-ink-faint" data-testid="notesThread.private">
            <UiIcon name="lock" :size="14" /><span>{{ t('notes.level.private') }}</span>
          </p>
          <template v-if="item.delivery === 'failed'">
            <p class="max-w-[78%] px-xs pt-xs text-right text-caption text-error" role="status" data-testid="notesThread.failed">
              {{ item.error }} {{ item.permanent ? t('notes.thread.notSentFinal') : t('uiText.chat.retryHint') }}
            </p>
            <div class="flex justify-end gap-xs">
              <button
                v-if="!item.permanent"
                type="button"
                class="min-h-(--size-touch) px-xs text-caption text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
                data-testid="notesThread.retry"
                @click="retry(item.key)"
              >
                {{ t('notes.thread.retry') }}
              </button>
              <button
                type="button"
                class="min-h-(--size-touch) px-xs text-caption text-error focus-visible:outline-2 focus-visible:outline-accent"
                :aria-label="t('notes.thread.discardLabel')"
                data-testid="notesThread.discard"
                @click="discard(item.key)"
              >
                {{ t('notes.thread.discard') }}
              </button>
            </div>
          </template>
        </template>
      </UiBubble>
    </template>

    <template #composer>
      <!-- She is rewriting one of her notes: the capsule is that note's field, and the thread's own composer waits behind it. -->
      <div v-if="editing" class="edit-bar" data-testid="notesThread.edit">
        <p v-if="editError" class="mx-auto max-w-prose px-xl pb-xs text-center text-footnote text-error" role="status" data-testid="notesThread.editError">
          {{ t('notes.thread.editFailed') }} {{ t(noteErrorKey(editError)) }}
        </p>
        <UiComposer
          v-model="editText"
          compact
          :note="t('notes.thread.editTitle')"
          :note-label="t('notes.thread.edit')"
          :placeholder="t('notes.thread.editTitle')"
          :label="t('notes.thread.editTitle')"
          :max="2000"
          testid="notesThread.edit"
          @send="saveEdit"
          @dismiss-note="cancelEdit"
        />
        <div class="edit-actions">
          <button type="button" class="min-h-(--size-touch) px-sm text-caption text-ink-muted" data-testid="notesThread.editCancel" @click="cancelEdit">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="min-h-(--size-touch) px-sm text-caption text-accent-ink disabled:text-ink-faint"
            :disabled="editBusy || !editText.trim()"
            data-testid="notesThread.editSave"
            @click="saveEdit"
          >
            {{ editBusy ? t('notes.thread.editing') : t('notes.thread.editSave') }}
          </button>
        </div>
      </div>
      <template v-else>
      <!-- The line over the capsule while the note is on Everyone: it describes the state, it does not nag (no sheet, no dialog). -->
      <p v-if="level === 'public'" class="mx-auto max-w-prose px-xl pb-xs text-center text-footnote text-ink-muted" role="status" data-testid="notes.level.notice">{{ t('notes.level.publicNotice') }}</p>
      <UiComposer
        v-model="text"
        v-model:send-as="sendAs"
        :send-options="sendOptions"
        :placeholder="isEnd ? t('notes.thread.placeholderEnd') : t('notes.thread.placeholder', { n: chapter?.position ?? '' })"
        :label="t('notes.thread.composerLabel')"
        :max="2000"
        :quote="replyChip"
        :voice-max-ms="voiceMaxMs"
        testid="notesThread"
        @send="send"
        @voice="sendVoice"
        @voice-error="notice = $event"
        @cancel-quote="replyTo = null"
      />
      </template>
    </template>

    <UiConfirm
      v-model:open="deleteOpen"
      :title="t('notes.thread.deleteTitle')"
      :text="deleteText"
      :action="deleteBusy ? t('notes.thread.deleting') : t('notes.thread.delete')"
      :busy="deleteBusy"
      :error="deleteError ? t(noteErrorKey(deleteError)) : null"
      :offline="!online"
      testid="notes.thread.delete"
      @confirm="confirmDelete"
    />
    <UiConfirm
      v-model:open="blockOpen"
      :title="t('people.blockTitle', { name: blocking?.author?.trim() || t('member.someone') })"
      :text="t('people.blockText')"
      :action="t('people.blockConfirm')"
      :busy="blockBusy"
      :error="blockError"
      :offline="!online"
      testid="notes.thread.block"
      @confirm="confirmBlock"
    />
    <RoomReportSheet v-model:open="reportOpen" prefix="notes.report" :message-id="reportId" :send="reportNote" :error-key="(code) => noteErrorKey(code as NoteErrorCode)" />
    <NotesVisibilitySheet
      v-if="room && chapter"
      v-model:open="levelOpen"
      :room-id="room.id"
      :section-id="chapter.id"
      :note-id="levelNote?.id ?? null"
      :visibility="levelNote?.visibility ?? 'friends'"
      :voice="levelNote?.voice ?? false"
    />
  </UiChatThread>
</template>

<style scoped>
/* The bar (reactions, Reply, Copy, then Who can see this or Report and Block) is wider than a 360 px phone beside a face: it stops at the screen's edge and scrolls,
   its arrow keys and its focus bring a button into view, instead of running off the screen. */
.quote {
  min-height: calc(var(--text-caption--line-height) * 2);
}
/* The field of an edit and its two words: the capsule over the thread, its actions under it, never off the screen. */
.edit-bar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-xs);
  padding-inline: var(--spacing-md);
}
/* The capsule's own send arrow is not the edit's: its two actions are the named pair under it (and Enter saves from the field). */
.edit-bar :deep([data-testid='notesThread.edit.send']) {
  display: none;
}
.notes-thread :deep([data-testid$='.reactionBar']) {
  max-width: calc(100vw - var(--spacing-xxl) - var(--spacing-lg));
  overflow-x: auto;
  scrollbar-width: none;
}
</style>

<script setup lang="ts">
// A thread of a buddy read (docs/plans/buddy-read-shared.md part B, 4 and parts 5.4, 7; docs/parity.md, "Buddy read: a thread"): the room's
// ("Before we start", `/together/<id>/room`), a Section's or "The whole book"'s (`/together/<id>/<section id>`). The base's chat screen
// (`UiChatThread`, `UiBubble`, `UiComposer`, one reaction bar a bubble) filled with the store's messages (stores/buddyRead.ts): optimistic
// sends that wait in the queue, live arrivals, day separators, earlier pages on scrolling up, a quote and a swipe to answer, and in the
// reaction bar Copy, Delete (her own, or any as the host) and Report (somebody else's: one reason, an optional note, to the owner).
//
// **The veil** (part 5.4): a Section her marker has not reached, and she has not opened anyway, is not read at all: this page shows the
// quiet "hidden" screen with "Show anyway", and only her yes (a peek, kept on this device; her Section does not move) loads it. An open
// Section she reads ahead of her marker carries a banner that says so. There are no spoiler marks on single comments (a Section is opened to be read);
// a deleted one reads "Message removed". Archived: read-only, said in the composer's place.
//
// **The gestures** (the base's `UiBubble`, as Trappist's chat has them): a double tap (a double click) on another member's message puts the
// first reaction of the bar, ❤️, on it and takes it back the second time; a long press (a right click, or the bubble's own React button, which is
// the single-tap way) opens the bar with the reactions, Reply, Report and Delete; a swipe to the right, or Reply in the bar, answers it, and the
// quote over the answer jumps to the original on a tap. All of it works on a voice bubble too (e2e/buddy-voice.spec.ts, e2e/buddy-gestures.spec.ts).
//
// **Voice messages** (docs/parity.md, "Buddy read, a thread"): the composer's microphone (`voiceMaxMs`; the base's recorder: a tap starts, send or
// ✕ ends it) hands a finished recording to the store (`sendVoice`: a bubble at once, the sound stored in the private bucket, then posted through
// the same line as a text); a voice row is the base's `UiVoiceBubble` (play, waveform, time). **Nothing is signed or fetched when the thread
// loads**: the play button's press is taken here first (`voicePress`, in the capture phase) and asks the store for a URL of five minutes the first
// time she plays that message; the base's own press runs for her own recording (played from the device's copy), a failed send and the double tap
// on the card. One voice at a time (the base's player), and leaving the thread silences it.
//
// Accessibility: the base's thread is a labelled list with a polite status for a message that arrives (not for the first load, not for
// her own), which stands in for `role="log"` (a log with a status says everything twice); every long press has the bubble's own React
// button and every double tap its bar, so a reaction never needs more than a tap; the recorder's buttons, the play button and the bar are
// real buttons of 44 px with labels and announced states; Reduce Motion cuts the base's motion; the page reflows at 200 % text (the base's
// chat screen is fixed to the viewport).
import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import { durationToken, easingToken, prefersReducedMotion } from '#layers/ui/app/utils/motion'
import { threadKey } from '#layers/chat/app/utils/thread'
import { BUDDY_EMOJI, type BuddyErrorCode, type ReportReason } from '~/data/buddyReads'
import { VOICE_MAX_MS, type PreparedVoice } from '~/data/buddyVoice'
import { isReadId, isSectionSegment, roomPath, sectionOfSegment } from '~/utils/buddyRoute'
import { buddyErrorKey } from '~/utils/buddyRead'
import { sectionTitle } from '~/utils/buddySectionTitle'
import { isRetryableBuddyError } from '~/data/buddyReads'
import { sameAuthorRun, type ThreadItem } from '~/utils/roomThread'
import { useThreadScreen } from '~/composables/useThreadScreen'
import { revealThread } from '~/utils/threadReveal'
import { buddyThreadAdapter } from '~/utils/buddyThreadAdapter'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useSessionStore } from '~/stores/session'

definePageMeta({
  layout: 'tabs',
  screen: 'together',
  pushed: true,
  // The chat fills the screen: the tab bar steps away while it shows (components/shell/TabBar.vue).
  immersive: true,
  // One page per thread: going from one Section to another starts its own state (what she tapped, what she was writing).
  key: (route) => route.fullPath,
  validate: (route) => isReadId(route.params.id) && isSectionSegment(route.params.section),
})

const { t } = useI18n()
const route = useRoute()
const store = useBuddyReadStore()
const session = useSessionStore()
const online = useOnline()

const readId = computed(() => String(route.params.id))
/** The Section's id, or null for the room. */
const sectionId = computed(() => sectionOfSegment(route.params.section) ?? null)
const me = computed(() => session.member?.id ?? null)
const read = computed(() => store.reads[readId.value] ?? null)
const chapter = computed(() => (sectionId.value ? (read.value?.chapters.find((c) => c.id === sectionId.value) ?? null) : null))
/** The veil's answer for this thread; null while the read is not loaded or the Section is not part of it. */
const view = computed(() => (read.value ? store.view(readId.value, sectionId.value) : null))
const isHost = computed(() => read.value?.canManage ?? false)
const archived = computed(() => read.value?.status === 'archived')
/** Live updates are paused: the channel has not been live for a while and the device is online (offline says its own). */
const paused = computed(() => store.liveStuck && online.value)

// The address names no thread of this read: she is not in it any more, or the Section is not its own.
const missing = computed(() => (!read.value && (error.value === 'not_found' || store.forgotten[readId.value] === true)) || (!!read.value && !view.value))

// ------------------------------------------------------------------ the thread screen

const EMOJIS = BUDDY_EMOJI
const quoteWords = computed(() => ({ deleted: t('uiText.chat.reply.deleted'), someone: t('member.someone'), you: t('uiText.chat.reply.you'), voice: t('uiText.chat.reply.voice') }))
const voicePlayer = useVoicePlayer()

/**
 * The half of this screen a Book's chapter of Notes has too (`composables/useThreadScreen.ts`): the messages, the send queue's three
 * answers, the quotes, the action bar, the delete confirm, the veil's one way in, the load and the press on a voice message. The
 * adapter closes over this read and this Section (`buddyThreadAdapter`) and keeps the room's live channel; what is here is what only
 * a read has — archived, the Host, the banners.
 *
 * The action bar: the database's six (`react_to_buddy_message`: ❤️ 😂 😮 😢 🔥 📚; ❤️ is also what a double tap puts on a message), then
 * Reply, Copy (a text) and the app's own: Delete (her own message, or any as the host) and Report (somebody else's). The bar is as wide as
 * its buttons (44 px each): six reactions and Reply fit a 360 px phone, and what follows scrolls (the style below).
 */
const screen = useThreadScreen(
  buddyThreadAdapter({
    store,
    readId: () => readId.value,
    sectionId: () => sectionId.value,
    hasRoom: () => !!read.value && !!view.value,
    me: () => me.value,
    isOpen: () => view.value?.open === true,
    missing: () => missing.value,
    veiled: () => view.value?.veiled === true,
    nameOf: (memberId) => read.value?.members.find((m) => m.id === memberId)?.name?.trim() || null,
    errorWord: (code) => t(buddyErrorKey(code as BuddyErrorCode)),
    retryable: (code) => isRetryableBuddyError(code as BuddyErrorCode),
    backTo: () => roomPath(readId.value),
  }),
  {
    emojis: EMOJIS,
    likeEmoji: EMOJIS[0]!,
    canLike: () => !archived.value,
    canWrite: () => !archived.value,
    quoteWords: () => quoteWords.value,
    barWords: () => ({ report: t('together.thread.report'), delete: t('together.thread.delete') }),
    // The Host removes anybody's message; an archived read's composer is a line, so nothing is offered there either.
    extraActions: (item) => (!item.mine && isHost.value && !archived.value ? [{ id: 'delete', label: t('together.thread.delete'), icon: 'trash' }] : []),
    deleteText: (item) => {
      const host = !item.mine
      if (item.voice) return t(host ? 'together.thread.deleteTextVoiceHost' : 'together.thread.deleteTextVoice')
      return t(host ? 'together.thread.deleteTextHost' : 'together.thread.deleteText')
    },
    offlineWord: () => t(buddyErrorKey('offline')),
    failedWord: () => t('together.thread.voice.playFailed'),
    composerTestid: 'buddyThread',
    voicePlayer,
  },
)

const { items, text, replyTo, notice, fresh, hasMore, olderStatus, loadOlder, quoteFor, replyChip, send, sendVoice, retry, discard, react, answer, actionsOf, action, deleteOpen, deleteBusy, deleteError, deleteText, confirmDelete, reportId, reportOpen, onPress: voicePress, status, error, showOpen, showAnyway, back } = screen

/** The report sheet's call (components/room/ReportSheet.vue): the buddy store's, answered with the refusal's code. */
const reportMessage = screen.report

// The read, the Section opening when her marker lets her in, and the room's live channel kept while this screen shows.
screen.start()

const chat = useTemplateRef<{ scroller: HTMLElement | null; jumpTo: (id: string) => Promise<void>; toNewest: () => void }>('chat')

// The reveal (docs/MOTION.md, "A chapter's notes"; utils/threadReveal.ts): the same rule as a Book's chapter of
// Notes, since it is the same thread on the same screen. A thread the store already held is revealed in its
// first frame, one motion for the whole thread; one that had to be read keeps the motion its arrival plays.
onMounted(() => {
  if (!screen.revealed.value) return
  const reduced = prefersReducedMotion()
  // The scroller itself, never the list inside it: a `translateY` on the list would grow the scroller's own
  // content by that much and it would slide back at the end (utils/threadReveal.ts).
  revealThread(chat.value?.scroller ?? null, {
    duration: durationToken(reduced ? 'quick' : 'standard'),
    easing: easingToken('standard'),
    reduced,
  })
})

/** The screen's send, and then the thread is at its newest (hers is the message that arrived). */
async function sendMessage() {
  await send()
  chat.value?.toNewest()
}
async function sendVoiceMessage(voice: PreparedVoice) {
  await sendVoice(voice)
  chat.value?.toNewest()
}

// ------------------------------------------------------------------ title and banners

// A Section's name is the viewer's own words for what the host's tool wrote ("Section 3", "The whole book"): the host's language is not hers.
const title = computed(() => (sectionId.value === null ? t('together.room') : chapter.value ? sectionTitle(chapter.value, sectionWords) : ''))
const range = computed(() => (chapter.value?.pages ? t('together.pages', { from: chapter.value.pages[0], to: chapter.value.pages[1] }) : null))
useHead({ title: () => `${title.value || t('together.title')} · ${t('app.name')}` })

/** Her marker has reached this Section (her reading opened it, or she set it by hand): it is no longer "reading ahead". */
const reached = computed(() => {
  const r = read.value
  const c = chapter.value
  if (!r || !c) return true
  const parts = r.chapters.filter((x) => x.kind === 'chapter').length
  return c.kind === 'end' ? r.readThrough >= parts : c.position <= r.readThrough
})
/** She opened a Section her marker has not reached ("Show anyway"): said once above the thread; her own Section is where it was. */
const ahead = computed(() => view.value?.open === true && view.value.peeked && !reached.value)


</script>

<template>
  <!-- Not in it (any more), or not a Section of it: one quiet answer. -->
  <div v-if="missing" class="relative min-h-dvh" data-testid="together.thread.missing">
    <UiTopBar :back-label="t('together.thread.back')" back-testid="together.thread.back" @back="back" />
    <FriendsNote heading :title="t('together.missingTitle')" :text="t('together.missingText')">
      <UiButton tone="secondary" size="md" data-testid="together.thread.missingHome" @click="navigateTo('/')">{{ t('together.home') }}</UiButton>
    </FriendsNote>
  </div>

  <!-- A veiled Section: nothing of it is read. The number, why, and the one way in. -->
  <div v-else-if="view?.veiled" class="relative min-h-dvh" data-testid="together.thread.veiled">
    <UiTopBar :back-label="t('together.thread.back')" back-testid="together.thread.back" @back="back" />
    <FriendsNote heading :title="chapter?.kind === 'end' ? t('together.thread.veiledEnd') : t('together.thread.veiledTitle', { n: chapter?.position ?? '' })" :text="t('together.thread.veiledText')">
      <UiButton tone="secondary" size="md" data-testid="together.thread.showAnyway" @click="showOpen = true">{{ t('together.showAnyway.action') }}</UiButton>
    </FriendsNote>
    <RoomShowAnyway v-model:open="showOpen" :number="chapter?.position ?? ''" :end="chapter?.kind === 'end'" @show="showAnyway" />
  </div>

  <UiChatThread
    v-else
    ref="chat"
    :items="items"
    :status="status"
    :label="t('together.thread.label', { title })"
    :offline="!online"
    :error="notice"
    :notice="archived ? t('together.thread.archived') : null"
    :has-more="hasMore"
    :older-status="olderStatus"
    :load-older="loadOlder"
    :conversation-key="`${readId}:${sectionId ?? 'room'}`"
    :head-shown="items.length === 0"
    :same-run="sameAuthorRun"
    class="together-thread"
    testid="buddyThread"
    landmark
    @click.capture="voicePress"
  >
    <template #top>
      <UiRoundButton class="pointer-events-auto" icon="back" :label="t('together.thread.back')" data-testid="together.thread.back" @click="back" />
      <h1
        class="absolute left-1/2 w-max -translate-x-1/2 text-center text-body font-medium wrap-anywhere"
        style="max-width: calc(100% - 2 * (var(--spacing-inset) + var(--size-touch) + var(--spacing-sm)))"
        data-testid="together.thread.title"
      >
        {{ title }}<span v-if="range" class="figures block text-caption font-normal text-ink-muted" data-testid="together.thread.range">{{ range }}</span>
      </h1>
      <span />
    </template>

    <template v-if="ahead || paused" #banner>
      <p v-if="ahead" class="glass edge mx-auto w-fit max-w-full rounded-pill px-md py-xs text-center text-caption text-ink-muted" data-testid="together.thread.ahead">{{ t('together.thread.ahead') }}</p>
      <!-- The Free plan's connection limit says nothing: the channel just never goes live. Said quietly; the store reads what was missed every 25 s meanwhile. -->
      <p v-if="paused" class="glass edge mx-auto w-fit max-w-full rounded-pill px-md py-xs text-center text-caption text-ink-muted" role="status" data-testid="together.thread.paused">{{ t('together.thread.paused') }}</p>
    </template>

    <template #head>
      <p class="mx-auto max-w-prose px-xl py-xl text-center text-subhead text-ink-muted" data-testid="together.thread.empty">
        {{ sectionId === null ? t('together.thread.emptyRoom') : t('together.thread.empty') }}
      </p>
    </template>

    <template #message="{ item, signed, endsRun, reacting, placement, highlight, openReactions, closeReactions }">
      <p v-if="item.kind === 'system'" class="px-md py-xs text-center text-caption text-ink-faint italic" data-testid="buddyThread.removed">{{ t('together.thread.removed') }}</p>
      <UiBubble
        v-else
        :item="item"
        :read="false"
        :fresh="fresh.has(item.key)"
        :signed="signed && !item.mine"
        :sender="item.author"
        :author="item.author"
        :ends-run="endsRun"
        :can-react="!archived"
        :emojis="EMOJIS"
        :quote="quoteFor(item)"
        :highlight="highlight"
        :actions="actionsOf(item)"
        :reacting="reacting"
        :placement="placement"
        testid="buddyThread"
        @react-open="openReactions"
        @react-close="closeReactions"
        @react="react"
        @action="action"
        @reply="answer"
        @retry="retry"
        @quote-tap="(id: string) => chat?.jumpTo(id)"
      >
        <template #face>
          <FriendsAvatar :card="{ id: item.authorId ?? '', name: item.author, photo: read?.members.find((m) => m.id === item.authorId)?.photo ?? null }" />
        </template>
        <!-- A message that was refused: why, "Try again" unless nothing can change it (removed, blocked, archived, invalid), and "Delete" for good. -->
        <template v-if="item.delivery === 'failed'" #meta="{ time, showTime }">
          <time :datetime="item.createdAt" class="px-xs pt-xs text-caption text-ink-faint tabular-nums" :class="showTime ? '' : 'sr-only'">{{ time }}</time>
          <p class="max-w-[78%] px-xs pt-xs text-right text-caption text-error" role="status" data-testid="buddyThread.failed">
            {{ item.error }} {{ item.permanent ? t('together.thread.notSentFinal') : t('uiText.chat.retryHint') }}
          </p>
          <div class="flex justify-end gap-xs">
            <button
              v-if="!item.permanent"
              type="button"
              class="min-h-(--size-touch) px-xs text-caption text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
              data-testid="buddyThread.retry"
              @click="retry(item.key)"
            >
              {{ t('together.retry') }}
            </button>
            <button
              type="button"
              class="min-h-(--size-touch) px-xs text-caption text-error focus-visible:outline-2 focus-visible:outline-accent"
              :aria-label="t('together.thread.discardLabel')"
              data-testid="buddyThread.discard"
              @click="discard(item.key)"
            >
              {{ t('together.thread.discard') }}
            </button>
          </div>
        </template>
      </UiBubble>
    </template>

    <template #composer>
      <UiComposer
        v-model="text"
        :placeholder="sectionId === null ? t('together.thread.placeholderRoom') : t('together.thread.placeholder')"
        :label="t('together.thread.composerLabel')"
        :max="2000"
        :quote="replyChip"
        :voice-max-ms="VOICE_MAX_MS"
        testid="buddyThread"
        @send="sendMessage"
        @voice="sendVoiceMessage"
        @voice-error="notice = $event"
        @cancel-quote="replyTo = null"
      />
    </template>

    <UiConfirm
      v-model:open="deleteOpen"
      :title="t('together.thread.deleteTitle')"
      :text="deleteText"
      :action="deleteBusy ? t('together.thread.deleting') : t('together.thread.delete')"
      :busy="deleteBusy"
      :error="deleteError ? t(buddyErrorKey(deleteError)) : null"
      :offline="!online"
      testid="together.thread.delete"
      @confirm="confirmDelete"
    />
    <RoomReportSheet v-model:open="reportOpen" :message-id="reportId" :send="reportMessage" :error-key="(code) => buddyErrorKey(code as BuddyErrorCode)" />
  </UiChatThread>
</template>

<style scoped>
/* The host's bar (Reply, Copy, Report, Delete) is wider than a 360 px phone beside a face: it stops at the screen's edge and scrolls,
   its arrow keys and its focus bring a button into view, instead of running off the screen. */
.together-thread :deep([data-testid$='.reactionBar']) {
  max-width: calc(100vw - var(--spacing-xxl) - var(--spacing-lg));
  overflow-x: auto;
  scrollbar-width: none;
}
</style>

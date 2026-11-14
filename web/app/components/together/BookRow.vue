<script setup lang="ts">
// The buddy read row on a Book's page (docs/parity.md, *Buddy read, the Book page action*; V4, docs/plans/book-actions.md): **a section row of its
// own**, under the Notes rows and below the Book's About text, on every Book page, in her Library or not — not a button in the action area any more
// (the action area keeps the reading actions and nothing else). It reads her buddy list (`my_buddy_reads()`, once when the page opens, through the
// small store stores/buddyInvites.ts: no chat layer, no Realtime) and says one of three things:
// - she is in an active read of this Book: **Open the buddy read** (the whole row a link to its room), the unread count in a pill, and "N readers · Section 4"
//   as the row's one line of summary;
// - she is not: **Read together**, which opens the setup sheet (Sections, invitations, the link). The Book not in her Library is added as Currently
//   reading when she creates the read (the sheet says so), and nothing is added if she cancels. The row has no summary line until there is a read;
// - a Manual book (her own record: it has no work to read together): the row **disabled**, with the one line why under it.
// The setup sheet (and with it the big store and the chat layer) is built when she first presses the row, not with the page; the row has no caption
// (`together.entry.hint` and `together.entry.adds` are not drawn here).
//
// Props: `book` (the page's Book), `entry` (her Library entry of it, or null). Test ids: `book.together` (the section), `book.together.start`,
// `book.together.open`, `book.together.summary`, `book.together.unavailable`, and the sheet's own (`buddySetup`).
import type { Book, BookSnapshot } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { roomPath } from '~/utils/buddyRoute'
import { bookEntryAction, bookEntryRow, whereWords } from '~/utils/buddyEntry'
import { WITH_PARAM } from '~/utils/buddyPreselect'

const props = defineProps<{ book: Book | BookSnapshot; entry: LibraryEntry | null }>()

const { t } = useI18n()
const invites = useBuddyInvitesStore()
const route = useRoute()

const action = computed(() => bookEntryAction(props.book, !!props.entry, invites.reads))
/** What the row says and where it goes, for that state (utils/buddyEntry.ts, `bookEntryRow`). */
const row = computed(() => bookEntryRow(action.value))
const read = computed(() => (action.value?.kind === 'open' ? action.value.read : null))
const where = computed(() => (read.value ? whereWords(read.value.where) : null))
const readers = computed(() => (read.value ? t('together.count.readers', { count: read.value.memberCount }, read.value.memberCount) : ''))
const whereText = computed(() => (where.value ? t(where.value.key, where.value.values) : ''))

// The sheet is built open when she first presses the row (it initialises itself on mounting), and then kept.
const open = ref(false)
const asked = ref(false)
/** The friend a "Potential buddy reads" cover named (`?with=`), as the page's address says it when she presses the row; the sheet checks it (utils/buddyPreselect.ts) and ticks her. */
const friend = ref<unknown>(null)
function start() {
  friend.value = route.query[WITH_PARAM]
  asked.value = true
  open.value = true
}

// Once when the page opens, and again for another Book on the same page; the store reads it only when it is not fresh.
onMounted(() => void invites.load({ force: true }))
</script>

<template>
  <section class="relative px-ml pt-xl" data-testid="book.together">
    <!-- One row, in the same language as the Notes rows above it (components/notes/BookSection.vue): the icon, the label, one line of what it says,
         the chevron at the end. In a read it is a link to the room; not in one, a press that opens the setup sheet; a Manual book, a disabled row. -->
    <UiRowGroup>
      <NuxtLink
        v-if="row?.kind === 'open' && read"
        :to="roomPath(read.id)"
        class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-fill-strong"
        data-testid="book.together.open"
      >
        <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="chat" :size="22" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-body">{{ t('together.entry.openRoom') }}</span>
          <span class="block text-subhead text-ink-muted wrap-anywhere" data-testid="book.together.summary">
            {{ readers }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ whereText }}
          </span>
        </span>
        <TogetherUnreadBadge :count="read.unread" :label="t('together.entry.unread', { count: read.unread })" />
        <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
      </NuxtLink>
      <button
        v-else-if="row?.kind === 'start'"
        type="button"
        class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-fill-strong"
        aria-haspopup="dialog"
        data-testid="book.together.start"
        @click="start"
      >
        <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="chat" :size="22" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-body">{{ t('together.entry.start') }}</span>
        </span>
        <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
      </button>
      <button
        v-else-if="row?.kind === 'unavailable'"
        type="button"
        class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left"
        disabled
        aria-describedby="book-together-why"
        data-testid="book.together.start"
      >
        <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="chat" :size="22" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-body text-ink-faint">{{ t('together.entry.start') }}</span>
        </span>
      </button>
    </UiRowGroup>
    <p v-if="row?.kind === 'unavailable'" id="book-together-why" class="mt-xs text-caption text-ink-muted" data-testid="book.together.unavailable">{{ t('together.entry.unavailable') }}</p>
    <LazyTogetherSetupSheet v-if="asked" v-model:open="open" :entry="entry" :book="book" :friend="friend" />
  </section>
</template>

<script setup lang="ts">
// The buddy read action on a Book's page (docs/parity.md, *Buddy read, the Book page action*), in the Book's action area right under its one action, on every
// Book page, in her Library or not. It reads her buddy list (`my_buddy_reads()`, once when the page opens, through the small store stores/buddyInvites.ts:
// no chat layer, no Realtime) and says one of three things:
// - she is in an active read of this Book: **Open the buddy read** (to its room), the unread count in a pill, and "N readers · Section 4" under it;
// - she is not: **Read together**, which opens the setup sheet (Sections, invitations, the link). The Book not in her Library is added as Currently reading when she
//   creates the read, and the line under the action and the sheet say so; nothing is added if she cancels;
// - a Manual book (her own record: it has no work to read together): the action disabled, with the one line why.
// The setup sheet (and with it the big store and the chat layer) is built when she first presses the action, not with the page.
// *Notes* (components/notes/BookButton.vue) stands beside it in the same row: two quiet half-width buttons, and what each says under them is full width.
//
// Props: `book` (the page's Book), `entry` (her Library entry of it, or null). Test ids: `book.together` (the block), `book.together.start`, `book.together.open`,
// `book.together.summary`, `book.together.hint`, `book.together.adds`, `book.together.unavailable`, and the sheet's own (`buddySetup`).
import type { Book, BookSnapshot } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { roomPath } from '~/utils/buddyRoute'
import { bookEntryAction, whereWords } from '~/utils/buddyEntry'
import { WITH_PARAM } from '~/utils/buddyPreselect'

const props = defineProps<{ book: Book | BookSnapshot; entry: LibraryEntry | null }>()

const { t } = useI18n()
const invites = useBuddyInvitesStore()
const route = useRoute()

const action = computed(() => bookEntryAction(props.book, !!props.entry, invites.reads))
const read = computed(() => (action.value?.kind === 'open' ? action.value.read : null))
const where = computed(() => (read.value ? whereWords(read.value.where) : null))
const readers = computed(() => (read.value ? t('together.count.readers', { count: read.value.memberCount }, read.value.memberCount) : ''))
const whereText = computed(() => (where.value ? t(where.value.key, where.value.values) : ''))

// The sheet is built open when she first presses the action (it initialises itself on mounting), and then kept.
const open = ref(false)
const asked = ref(false)
/** The friend a "Potential buddy reads" cover named (`?with=`), as the page's address says it when she presses the action; the sheet checks it (utils/buddyPreselect.ts) and ticks her. */
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
  <div class="mt-sm" data-testid="book.together">
    <!-- *Notes* (components/notes/BookButton.vue) and *Read together* side by side, two quiet half-width buttons; what is said under them is full width. -->
    <div class="flex gap-sm">
      <NotesBookButton :book="book" />
      <UiButton v-if="action?.kind === 'open' && read" :to="roomPath(read.id)" tone="quiet" block class="flex-1" data-testid="book.together.open">
        <UiIcon name="chat" :size="18" />{{ t('together.entry.openRoom') }}
        <TogetherUnreadBadge :count="read.unread" :label="t('together.entry.unread', { count: read.unread })" />
      </UiButton>
      <UiButton v-else-if="action?.kind === 'start'" tone="quiet" block class="flex-1" aria-haspopup="dialog" data-testid="book.together.start" @click="start">
        <UiIcon name="chat" :size="18" />{{ t('together.entry.start') }}
      </UiButton>
      <UiButton v-else-if="action?.kind === 'unavailable'" tone="quiet" block class="flex-1" disabled aria-describedby="book-together-why" data-testid="book.together.start">
        <UiIcon name="chat" :size="18" />{{ t('together.entry.start') }}
      </UiButton>
    </div>
    <NotesBookButton :book="book" line />
    <template v-if="action?.kind === 'open' && read">
      <p class="mt-xs text-center text-caption text-ink-muted wrap-anywhere" data-testid="book.together.summary">
        {{ readers }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ whereText }}
      </p>
    </template>
    <template v-else-if="action?.kind === 'start'">
      <p v-if="action.adds" class="mt-xxs text-center text-caption text-ink-muted" data-testid="book.together.adds">{{ t('together.entry.adds') }}</p>
    </template>
    <p v-else-if="action?.kind === 'unavailable'" id="book-together-why" class="mt-xs text-center text-caption text-ink-muted" data-testid="book.together.unavailable">{{ t('together.entry.unavailable') }}</p>
    <LazyTogetherSetupSheet v-if="asked" v-model:open="open" :entry="entry" :book="book" :friend="friend" />
  </div>
</template>

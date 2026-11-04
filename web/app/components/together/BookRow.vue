<script setup lang="ts">
// The *Read together* row on a Book's page (docs/plans/buddy-read-shared.md W5), under the Book's actions: a row of the Book's own Library entry that
// starts a buddy read (it opens the setup sheet, W3) or, when she is already in an active read of this Book, goes into its room, with the Section
// she is in and how many comments are new. The page places it only for a Catalogue Book in her Library (`canReadTogether`: not a Manual book) and only
// with buddy reads on (`useBuddyReadsOn`: the build's flag and her switch); this component asks nothing otherwise because it is not there.
// `my_buddy_reads()` is read once when the page opens (the store's `loadMine`, no Realtime): until it answers, or offline, the row offers to start,
// and the sheet says so (`buddy_read_exists`, "Open your buddy read of this book") if she has one already.
//
// Props: `entry` (her Library entry of the page's Book). Test ids: `book.together` (the block), `book.together.start`, `book.together.open`, and
// the sheet's own (`buddySetup`).
import type { LibraryEntry } from '~/data/library'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { roomPath } from '~/utils/buddyRoute'
import { bookEntryAction, whereWords } from '~/utils/buddyEntry'

const props = defineProps<{ entry: LibraryEntry }>()

const { t } = useI18n()
const store = useBuddyReadStore()

const action = computed(() => bookEntryAction(store.mine?.reads, props.entry.book.id))
const read = computed(() => (action.value.kind === 'open' ? action.value.read : null))
const where = computed(() => (read.value ? whereWords(read.value.where) : null))
/** The open row's second line: "3 readers · Section 4". */
const readers = computed(() => (read.value ? t('together.count.readers', { count: read.value.memberCount }, read.value.memberCount) : ''))
const whereText = computed(() => (where.value ? t(where.value.key, where.value.values) : ''))

// The sheet is part of this row's chunk (the page loads the row lazily, only with buddy reads on), closed until she presses the row.
const open = ref(false)

// Once, when the page opens for this Book; her list follows the Book the page is on.
watch(() => props.entry.book.id, () => void store.loadMine(), { immediate: true })
</script>

<template>
  <section class="relative px-ml pt-md" :aria-label="t('together.title')" data-testid="book.together">
    <UiRowGroup>
      <!-- The open row is two lines (a UiRow's value is one truncated line, and "2 readers · Section 4" must not be cut): the same row, drawn here. -->
      <NuxtLink
        v-if="read"
        :to="roomPath(read.id)"
        class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-sm text-left text-body text-ink hover:bg-fill active:bg-fill-strong"
        data-testid="book.together.open"
      >
        <UiIcon name="chat" :size="18" class="shrink-0 text-ink-faint" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span>{{ t('together.entry.open') }}</span>
          <span class="text-caption text-ink-muted wrap-anywhere" data-testid="book.together.summary">
            {{ readers }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ whereText }}
          </span>
        </span>
        <TogetherUnreadBadge :count="read.unread" :label="t('together.entry.unread', { count: read.unread })" />
        <UiIcon name="chevron" :size="15" bold class="-mr-xs shrink-0 text-ink-ghost" />
      </NuxtLink>
      <UiRow v-else as="button" icon="chat" :label="t('together.entry.start')" chevron aria-haspopup="dialog" data-testid="book.together.start" @click="open = true" />
    </UiRowGroup>
    <p v-if="!read" class="mt-sm px-inset text-footnote text-ink-faint" data-testid="book.together.hint">{{ t('together.entry.hint') }}</p>
    <TogetherSetupSheet v-model:open="open" :entry="entry" />
  </section>
</template>

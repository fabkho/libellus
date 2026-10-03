<script setup lang="ts">
// One Library entry in a list (D's library-want and library-finished rows):
// small cover, serif title, author, and a mono meta line — when it was added
// (Want to read), or its Rating and the day it was finished (Finished; "Not
// rated" when there is none; no year, the list is grouped by it). Opens the book page from the touch-down
// (UiPressLink).
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t, locale } = useI18n()
const { formatDay } = useDays()
const books = useBookStore()
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const added = computed(() => t('common.dayMonth', dateParts(new Date(props.entry.addedAt), locale.value)))
const latest = computed(() => props.entry.latestSession)
</script>

<template>
  <UiPressLink
    :to="`/book/${entry.book.id}`"
    class="row flex items-center gap-inset py-sm active:bg-fill"
    data-testid="library.entry"
    @press="books.prefetch(entry.book.id)"
  >
    <UiCover
      :title="entry.book.title"
      :authors="entry.book.authors"
      :src="coverSrc(entry.book.coverUrl, 'sm')"
      :thumbhash="entry.book.coverThumbhash"
      :colors="entry.book.coverColors"
      size="sm"
      :eager="eager"
    />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span class="book-title truncate text-body-large" data-testid="library.entryTitle">{{ entry.book.title }}</span>
      <span class="truncate text-caption text-ink-muted">{{ authorLine }}</span>
      <span v-if="entry.status === 'finished'" class="figures mt-xxs flex items-center gap-sm text-meta text-ink-faint">
        <UiStars v-if="latest?.rating" :quarters="latest.rating" data-testid="library.entryRating" />
        <span v-else class="text-ink-ghost" data-testid="library.entryUnrated">{{ t('rating.none') }}</span>
        <template v-if="latest?.endedOn">
          <span class="dot" aria-hidden="true" /><span data-testid="library.entryEnded">{{ formatDay(latest.endedOn, { year: false }) }}</span>
        </template>
      </span>
      <span v-else class="figures mt-xxs text-meta text-ink-faint">{{ t('library.added', { date: added }) }}</span>
    </span>
  </UiPressLink>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}

.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>

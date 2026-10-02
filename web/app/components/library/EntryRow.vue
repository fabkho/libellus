<script setup lang="ts">
// One Library entry in a list (D's library-want row): small cover, serif
// title, author, when it was added in mono. Opens the book page from the
// touch-down (UiPressLink).
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t, locale } = useI18n()
const books = useBookStore()
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const added = computed(() => t('common.dayMonth', dateParts(new Date(props.entry.addedAt), locale.value)))
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
      <span class="figures mt-xxs text-meta text-ink-faint">{{ t('library.added', { date: added }) }}</span>
    </span>
  </UiPressLink>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

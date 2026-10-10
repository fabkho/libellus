<script setup lang="ts">
// One Book on the picker's list (pages/pick.vue, PROTOTYPE #259): its cover, title and author, and
// whether it is chosen. The whole row is one toggle (a checkbox to assistive tech); a Book that
// cannot be picked (read, or being read) says why and does nothing.
import type { Book, BookSnapshot } from '~/data/books'

const props = defineProps<{ book: Book | BookSnapshot; chosen: boolean; disabled?: boolean; note?: string; testid: string }>()
defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const authorLine = computed(() => formatAuthors(props.book.authors, t('common.etAl')))
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="chosen"
    :disabled="disabled"
    class="row flex w-full items-center gap-inset py-sm text-left disabled:opacity-50"
    :data-testid="testid"
    :data-chosen="chosen || undefined"
    @click="$emit('toggle')"
  >
    <UiCover
      decorative
      :title="book.title"
      :authors="book.authors"
      :src="coverSrc(book.coverUrl, 'sm')"
      :fallbacks="coverFallbacks(book, 'sm')"
      :thumbhash="book.coverThumbhash"
      :colors="book.coverColors"
      size="sm"
    />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span class="book-title line-clamp-2 text-body" :data-testid="`${testid}Title`">{{ book.title }}</span>
      <span class="truncate text-caption text-ink-muted">{{ authorLine }}</span>
      <span v-if="note" class="truncate text-meta text-ink-faint">{{ note }}</span>
    </span>
    <span
      class="tick flex shrink-0 items-center justify-center rounded-pill transition-colors duration-(--duration-quick) ease-standard"
      :class="chosen ? 'bg-ink text-on-ink' : 'edge text-transparent'"
      aria-hidden="true"
    >
      <UiIcon name="check" :size="14" bold />
    </span>
  </button>
</template>

<style scoped>
.tick {
  width: var(--spacing-lg);
  height: var(--spacing-lg);
}
</style>

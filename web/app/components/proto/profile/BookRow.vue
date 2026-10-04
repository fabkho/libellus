<script setup lang="ts">
// Design round #78: one read in a list (a month's books, a record): Library's
// row — small cover, serif title, author — with a mono meta line the caller
// fills (its stars, the day, how long it took), or a `label` on the left
// ("Longest") and the figure on the right.
import type { StubBook } from './model'

withDefaults(defineProps<{ book: StubBook; label?: string; figure?: string; dim?: boolean; again?: number }>(), { label: undefined, figure: undefined, dim: false, again: 0 })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-inset py-sm">
    <UiCover
      :title="book.title"
      :authors="book.authors"
      :src="coverSrc(book.cover, 'sm')"
      :thumbhash="book.thumbhash"
      :colors="book.colors"
      size="sm"
      :class="dim && 'dimmed'"
    />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span v-if="label" class="eyebrow">{{ label }}</span>
      <span class="book-title truncate text-callout" :class="dim && 'text-ink-muted'">{{ book.title }}</span>
      <span v-if="!label" class="flex min-w-0 items-center gap-sm text-caption text-ink-muted">
        <span class="truncate">{{ formatAuthors(book.authors, t('common.etAl')) }}</span>
        <span v-if="again > 1" class="figures flex shrink-0 items-center gap-xxs text-meta text-ink-faint" data-testid="proto.again"><UiIcon name="repeat" :size="11" />{{ again === 2 ? '2nd read' : `${again}th read` }}</span>
      </span>
      <span v-if="$slots.default" class="figures mt-xxs flex items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint"><slot /></span>
    </span>
    <span v-if="figure" class="figures shrink-0 text-caption text-ink-muted">{{ figure }}</span>
  </div>
</template>

<style scoped>
.dimmed {
  opacity: 0.45;
  filter: grayscale(0.6);
}
</style>

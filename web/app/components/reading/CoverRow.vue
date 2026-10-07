<script setup lang="ts">
// A row of covers on a reading page (issue #171): Currently reading, the
// Favourites (with their Ratings) and a member's shelf (smaller, covers only).
// It scrolls sideways under the finger and lets the page scroll on; each cover
// opens its Book card. With titles, the cover is decorative (the title is
// beside it); covers alone carry the title as their name.
import { bookCardPath, type PublicBook } from '~/data/readingPage'

const props = withDefaults(
  defineProps<{
    items: readonly { book: PublicBook; rating?: number | null }[]
    token: string
    testid: string
    /** Covers only, smaller: a shelf. */
    compact?: boolean
  }>(),
  { compact: false },
)

const { t } = useI18n()
const size = computed(() => (props.compact ? 'md' : 'lg'))
</script>

<template>
  <ul class="scrollbar-none -mx-screen flex snap-x gap-ms overflow-x-auto px-screen pb-xs" :data-testid="testid">
    <li v-for="item in items" :key="item.book.id" class="shrink-0 snap-start" :class="compact ? 'w-(--size-cover-md)' : 'w-(--size-cover-lg)'">
      <NuxtLink :to="bookCardPath(token, item.book.id)" class="cover-link flex flex-col gap-xs rounded-cover" :data-testid="`${testid}.book`">
        <UiCover
          :decorative="!compact"
          :title="item.book.title"
          :authors="item.book.authors"
          :src="coverSrc(item.book.coverUrl, size)"
          :thumbhash="item.book.coverThumbhash"
          :colors="item.book.coverColors"
          :size="size"
        />
        <template v-if="!compact">
          <span class="book-title line-clamp-2 text-caption">{{ item.book.title }}</span>
          <span class="truncate text-meta text-ink-muted">{{ formatAuthors(item.book.authors, t('common.etAl')) }}</span>
          <UiStars v-if="item.rating" :quarters="item.rating" :show-value="false" />
        </template>
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>

<script setup lang="ts">
// A row of covers on a reading page (issue #171): Currently reading, the
// Favourites (with their Ratings) and a member's shelf (smaller, covers only).
// It scrolls sideways under the finger and lets the page scroll on; each cover
// opens its Book card, the cover flying into the card's hero as a book's does in the
// app (UiPressLink, composables/useBookFlight.ts). With titles, the cover is decorative (the title is
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
const PressLink = resolveComponent('UiPressLink')
const shown = (book: PublicBook) => shownBook(book, t('book.outsideCatalogue'))
const size = computed(() => (props.compact ? 'md' : 'lg'))
</script>

<template>
  <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pb-xs" :data-testid="testid">
    <li v-for="item in items" :key="item.book.id" class="shrink-0 snap-start" :class="compact ? 'w-(--size-cover-md)' : 'w-(--size-cover-lg)'">
      <component :is="item.book.unverified ? 'span' : PressLink" :to="item.book.unverified ? undefined : bookCardPath(token, item.book.id)" class="cover-link flex flex-col gap-xs rounded-cover" :data-testid="`${testid}.book`">
        <UiCover
          :decorative="!compact"
          :title="shown(item.book).title"
          :authors="shown(item.book).authors"
          :src="coverSrc(shown(item.book).coverUrl, size)"
          :thumbhash="shown(item.book).coverThumbhash"
          :colors="shown(item.book).coverColors"
          :size="size"
        />
        <template v-if="!compact">
          <span class="book-title line-clamp-2 text-caption">{{ shown(item.book).title }}</span>
          <span v-if="shown(item.book).authors.length" class="truncate text-meta text-ink-muted">{{ formatAuthors(shown(item.book).authors, t('common.etAl')) }}</span>
          <UiStars v-if="item.rating" :quarters="item.rating" :show-value="false" />
        </template>
      </component>
    </li>
  </ul>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>

<script setup lang="ts">
// A row of covers on a reading page (issue #171): Currently reading, the
// Favourites (with their Ratings) and a member's shelf (smaller, covers only).
// It scrolls sideways under the finger and lets the page scroll on; each cover
// opens its Book card, the cover flying into the card's hero as a book's does in the
// app (UiPressLink, composables/useBookFlight.ts). With titles, the cover is decorative (the title is
// beside it); covers alone carry the title as their name. The year in review's five-star row
// (components/profile/Favourite.vue) reuses it inside the app: `linkTo` gives each Book's own page
// (or null, a Book that opens nothing) in place of the reading page's card under `token`.
import { bookCardPath, type PublicBook } from '~/data/readingPage'

type RowBook = Pick<PublicBook, 'id' | 'title' | 'authors' | 'coverUrl' | 'coverThumbhash' | 'coverColors'> & { unverified?: boolean }

const props = withDefaults(
  defineProps<{
    items: readonly { book: RowBook; rating?: number | null }[]
    token?: string
    testid: string
    /** Covers only, smaller: a shelf. */
    compact?: boolean
    /** Where a Book opens, instead of its card on the reading page: null opens nothing. */
    linkTo?: (book: RowBook) => string | null
  }>(),
  { compact: false, token: '', linkTo: undefined },
)
const emit = defineEmits<{ press: [id: string] }>()

const { t } = useI18n()
const PressLink = resolveComponent('UiPressLink')
const shown = (book: RowBook) => shownBook(book, t('book.outsideCatalogue'))
const target = (book: RowBook) => (props.linkTo ? props.linkTo(book) : book.unverified ? null : bookCardPath(props.token, book.id))
const size = computed(() => (props.compact ? 'md' : 'lg'))
</script>

<template>
  <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pb-xs" :data-testid="testid">
    <li v-for="item in items" :key="item.book.id" class="shrink-0 snap-start" :class="compact ? 'w-(--size-cover-md)' : 'w-(--size-cover-lg)'">
      <component :is="target(item.book) ? PressLink : 'span'" :to="target(item.book) ?? undefined" v-on="flightOf(target(item.book))" class="cover-link flex flex-col gap-xs rounded-cover" :data-testid="`${testid}.book`" @press="emit('press', item.book.id)">
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

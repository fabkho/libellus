<script setup lang="ts">
// A Book's genres (issue #168), the chips under the facts line on the Book page: up to three,
// hers where she chose them, else the computed ones (stores/genres.ts). Plain chips, not links;
// beside them one quiet word opens the sheet where she sets or corrects them (Add genres, or
// Edit). A Book of her Library always has the row, at the height of a chip, so the chips arriving
// (they are on the device already, usually) move nothing; a Book outside her Library shows
// the row only when it has genres, and opens its room (UiReveal) when they come. Nothing is said
// of where the genres came from.
import type { Book, BookSnapshot } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { useGenresStore } from '~/stores/genres'

const props = defineProps<{ book: Book | BookSnapshot; entry: LibraryEntry | null }>()

const { t } = useI18n()
const genres = useGenresStore()
const online = useOnline()

const bookId = computed(() => ('id' in props.book ? props.book.id : null))
watch(bookId, (id) => id && void genres.loadBook(id), { immediate: true })

const list = computed(() => (bookId.value ? genres.lookup(bookId.value) : undefined))
const shown = computed(() => Boolean(props.entry) || Boolean(list.value?.length))
const sheetOpen = ref(false)
// Another Book (a Change edition, the same page): the sheet is closed.
watch(bookId, () => (sheetOpen.value = false))
</script>

<template>
  <UiReveal :show="shown" class="w-full">
    <div class="flex min-h-(--size-button-sm) items-center justify-center pt-ms box-content" data-testid="book.genres">
      <ul v-if="list?.length || entry" class="flex flex-wrap items-center justify-center gap-xs" :aria-label="t('genre.book.label')">
        <li
          v-for="id in list ?? []"
          :key="id"
          class="chip edge rounded-pill px-md text-caption text-ink-muted"
          :data-genre="id"
          data-testid="book.genre"
        >
          {{ t(`genre.${id}`) }}
        </li>
        <!-- Not yet known (and the device is online): a chip's room, so the row does not grow when they come. -->
        <li v-if="entry && list === undefined && online" class="chip skeleton wave w-(--size-cover-xl) rounded-pill" aria-hidden="true" />
        <li v-if="entry && list !== undefined">
          <button
            type="button"
            class="link text-meta text-ink-faint"
            :aria-label="t('genre.book.editLabel')"
            data-testid="book.genresEdit"
            @click="sheetOpen = true"
          >
            {{ list.length ? t('genre.book.edit') : t('genre.book.add') }}
          </button>
        </li>
      </ul>
    </div>
    <BookGenreSheet v-if="entry" v-model:open="sheetOpen" :entry="entry" />
  </UiReveal>
</template>

<style scoped>
/* A chip is as high as the quiet pills (D's 32 px), the room the row keeps. */
.chip {
  display: inline-flex;
  align-items: center;
  height: var(--size-button-sm);
}

.link {
  position: relative;
  padding-inline: var(--spacing-sm);
  text-decoration: underline;
  text-decoration-color: var(--color-hairline-strong);
  text-underline-offset: var(--spacing-xxs);
}

/* The touch target is the size of a fingertip, not of the 11px word. */
.link::after {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  transform: translateY(-50%);
}
</style>

<script setup lang="ts">
// The shelf for assistive tech (#23): Regal draws the Books in 3D on a canvas, and what it
// exposes of them is a scroller and a tooltip, not the Books. Beside every row and the
// shelf page's Stack, this is the same Books as a plain list, visually hidden: a screen
// reader reads the shelf as titles, authors and the day each was read, newest first.
// Opening a Book from here is not offered: its page is not the Libellus page of the Book
// (the shelf is the published file, not the Library).
import type { ShelfBook } from '~/data/shelf'

defineProps<{ books: readonly ShelfBook[]; label: string }>()

const { t } = useI18n()
const { formatDay } = useDays()

const line = (book: ShelfBook) => {
  const authors = formatAuthors(book.authors, t('common.etAl'))
  const read = book.dateRead ? t('shelf.list.read', { date: formatDay(book.dateRead) }) : ''
  return [book.title, authors, read].filter(Boolean).join(t('common.listSeparator'))
}
</script>

<template>
  <ul v-if="books.length" class="sr-only" :aria-label="label">
    <li v-for="(book, i) in books" :key="`${i}-${book.title}`">{{ line(book) }}</li>
  </ul>
</template>

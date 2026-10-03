<script setup lang="ts">
// A Book being read, in the Library (D's library-reading card): few Books
// are open at once, so each gets room and its cover's light — cover, serif
// title, author, since when and which day of the read it is — and Finish
// right on the card. The card opens the book page from the touch-down.
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const books = useBookStore()
const reading = useReadingStore()
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const since = computed(() => {
  const startedOn = props.entry.latestSession?.startedOn
  return startedOn ? t('book.since', { date: formatDay(startedOn), day: dayOfRead(startedOn) }) : ''
})
</script>

<template>
  <article
    class="relative flex items-center gap-ms overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint"
    data-testid="library.readingCard"
  >
    <UiAmbient :colors="entry.book.coverColors" shape="card" />
    <UiPressLink
      :to="`/book/${entry.book.id}`"
      class="relative flex min-w-0 flex-1 items-center gap-inset"
      data-testid="library.entry"
      @press="books.prefetch(entry.book.id)"
    >
      <UiCover
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'md')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
        size="md"
        glow
        :eager="eager"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title line-clamp-2 text-callout" data-testid="library.entryTitle">{{ entry.book.title }}</span>
        <span class="truncate text-caption text-ink-muted">{{ authorLine }}</span>
        <span class="figures mt-xs text-meta text-ink-faint" data-testid="library.entrySince">{{ since }}</span>
      </span>
    </UiPressLink>
    <UiButton tone="quiet" size="sm" class="relative" data-testid="library.finish" @click="reading.openFinish(entry)">
      {{ t('book.finish') }}
    </UiButton>
  </article>
</template>

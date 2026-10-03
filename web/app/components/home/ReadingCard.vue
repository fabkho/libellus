<script setup lang="ts">
// A Book being read, on Home (D's home card): large, lit by its cover's light.
// Cover with its glow, serif title, author, since when and which day of the
// read it is, and a Finish shortcut that opens the Finish sheet right here.
// The cover and the title open the book page from the touch-down.
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const books = useBookStore()
const reading = useReadingStore()
// Finishing writes: offline the shortcut says so instead (#15).
const online = useOnline()
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const since = computed(() => {
  const startedOn = props.entry.latestSession?.startedOn
  return startedOn ? t('book.since', { date: formatDay(startedOn), day: dayOfRead(startedOn) }) : ''
})
</script>

<template>
  <article
    class="relative flex gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint"
    data-testid="home.readingCard"
  >
    <UiAmbient :colors="entry.book.coverColors" shape="card" />
    <UiPressLink :to="`/book/${entry.book.id}`" class="relative" tabindex="-1" aria-hidden="true" @press="books.prefetch(entry.book.id)">
      <UiCover
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'lg')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
        size="lg"
        glow
        :eager="eager"
      />
    </UiPressLink>
    <div class="relative flex min-w-0 flex-1 flex-col pt-xxs">
      <UiPressLink :to="`/book/${entry.book.id}`" class="flex flex-col gap-xs" data-testid="home.entry" @press="books.prefetch(entry.book.id)">
        <span class="book-title line-clamp-2 text-book-title" data-testid="home.entryTitle">{{ entry.book.title }}</span>
        <span class="truncate text-body text-ink-muted">{{ authorLine }}</span>
        <span class="figures mt-xs text-meta text-ink-faint" data-testid="home.entrySince">{{ since }}</span>
      </UiPressLink>
      <div class="mt-auto flex pt-ms">
        <UiButton tone="quiet" size="sm" :offline="!online" data-testid="home.finish" @click="reading.openFinish(entry)">
          <UiIcon name="check" :size="15" bold />
          {{ t('book.finish') }}
        </UiButton>
      </div>
    </div>
  </article>
</template>

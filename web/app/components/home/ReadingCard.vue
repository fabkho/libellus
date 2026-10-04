<script setup lang="ts">
// A Book being read, on Home (D's home card): large, lit by its cover's light.
// Cover with its glow, serif title, author, since when and which day of the
// read it is, a thin progress bar with how far (tapping the value opens the
// Update progress sheet, #39) and a Finish shortcut that opens the Finish sheet
// right here.
// The cover and the title open the book page from the touch-down.
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressFraction, progressOf } from '~/data/progress'
import { useBookStore } from '~/stores/book'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const books = useBookStore()
const reading = useReadingStore()
// Finishing writes: offline the shortcut says so instead (#15).
const online = useOnline()
const text = useProgressText()
const progress = computed(() => progressOf(props.entry.latestSession))
// The member's own total when she set one (#60), else the edition's.
const pageCount = computed(() => pageCountOf(props.entry))
const words = computed(() => text(progress.value, pageCount.value))
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
      <div class="mt-auto pt-md">
        <UiProgress
          :fraction="progressFraction(progress, pageCount)"
          :label="t('book.progress.label')"
          :value-text="words.value"
          data-testid="home.progressBar"
        />
      </div>
      <div class="flex items-center justify-between gap-ms pt-xs">
        <!-- The value is the way into the sheet; offline it stays, disabled. -->
        <button
          type="button"
          class="figures -ml-xs min-h-(--size-touch) min-w-(--size-touch) truncate px-xs text-left text-meta enabled:hover:text-ink disabled:opacity-50"
          :class="progress ? 'text-ink-muted' : 'text-ink-faint'"
          :disabled="!online"
          :aria-label="online ? `${t('book.progress.update')}: ${words.value}` : t('common.offline')"
          data-testid="home.progress"
          @click="reading.openProgress(entry)"
        >
          {{ progress ? words.value : t('home.progressAdd') }}
        </button>
        <UiButton tone="quiet" size="sm" :offline="!online" data-testid="home.finish" @click="reading.openFinish(entry)">
          <UiIcon name="check" :size="15" bold />
          {{ t('book.finish') }}
        </UiButton>
      </div>
    </div>
  </article>
</template>

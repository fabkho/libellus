<script setup lang="ts">
// A Book being read, on Home (D's home card): large, lit by its cover's light.
// Cover with its glow, serif title, author; the pace as a quiet line ("18 a day
// · 22 days", issue #68), or, until the read has a day of progress, since when
// and which day of the read it is (the two-week chart lives on the book page
// only); a thin progress bar with how far, and a quiet Update that opens the
// Update progress sheet (issue #68, design round #65 direction D): nothing on
// the card edits by itself. Right after a save the line says what changed
// ("+24") and Update gives way to Undo for 5 s. At the last page the line reads
// "The end." and Finish (lit) opens the Finish sheet right here.
// The cover and the title open the book page from the touch-down. A quiet mark
// beside the author when its ebook is on this device (#131, EbooksMark).
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressFraction, progressOf, progressReachedEnd } from '~/data/progress'
import { useBookStore } from '~/stores/book'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t, n } = useI18n()
const { formatDay, dayOfRead } = useDays()
const books = useBookStore()
const reading = useReadingStore()
// Updating and finishing work offline too: they wait to sync (#93).
const text = useProgressText()
const progress = computed(() => progressOf(props.entry.latestSession))
// The member's own total when she set one (#60), else the edition's.
const pageCount = computed(() => pageCountOf(props.entry))
const words = computed(() => text(progress.value, pageCount.value))
const atEnd = computed(() => progressReachedEnd(progress.value, pageCount.value))
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const readingDays = useReadingDays(() => props.entry)
const since = computed(() => {
  const startedOn = props.entry.latestSession?.startedOn
  return startedOn ? t('book.since', { date: formatDay(startedOn), day: dayOfRead(startedOn) }) : ''
})

// This card's last save, while Undo is on offer.
const undo = computed(() => (reading.progressUndo?.entryId === props.entry.id ? reading.progressUndo : null))
const gain = computed(() => {
  const by = undo.value?.gain
  if (!by) return null
  const key = by.amount > 0 ? (by.unit === 'page' ? 'gainPages' : 'gainPercent') : by.unit === 'page' ? 'lossPages' : 'lossPercent'
  return t(`book.progress.${key}`, { count: n(Math.abs(by.amount)) })
})

/** What the card's one button does now: Finish at the last page, Undo right after a save, else Update. */
const action = computed(() => (atEnd.value ? 'finish' : undo.value ? 'undo' : 'update'))
function act() {
  if (action.value === 'finish') reading.openFinish(props.entry)
  else if (action.value === 'undo') void reading.undoProgress()
  else reading.openProgress(props.entry)
}
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
        <span class="flex min-w-0 items-center gap-xs">
          <span class="truncate text-body text-ink-muted">{{ authorLine }}</span>
          <EbooksMark :entry="entry" testid="home.ebookMark" />
        </span>
        <span v-if="!readingDays.hasHistory.value" class="figures mt-xs text-meta text-ink-faint" data-testid="home.entrySince">{{ since }}</span>
      </UiPressLink>
      <div v-if="readingDays.hasHistory.value" class="mt-sm flex items-end gap-sm" data-testid="home.days">
        <span class="figures truncate text-meta text-ink-faint" data-testid="home.pace">{{ readingDays.paceLine.value ?? since }}</span>
      </div>
      <div class="mt-auto pt-md">
        <UiProgress
          :fraction="progressFraction(progress, pageCount)"
          :label="t('book.progress.label')"
          :value-text="words.value"
          data-testid="home.progressBar"
        />
      </div>
      <div class="flex items-center justify-between gap-ms pt-xs">
        <p class="min-w-0 truncate text-meta" data-testid="home.progress">
          <span v-if="atEnd" class="text-body text-ink" data-testid="home.theEnd">{{ t('book.progress.theEnd') }}</span>
          <template v-else>
            <span class="figures" :class="progress ? 'text-ink-muted' : 'text-ink-faint'" data-testid="home.progressValue">{{ words.value }}</span>
            <span v-if="gain" class="figures text-accent-ink" data-testid="home.progressGain"> · {{ gain }}</span>
          </template>
        </p>
        <!-- One button that turns into the next (Update, Undo, Finish) rather than three that take
             turns: the sheet gives focus back to Update when it closes, and the same element, now
             Undo, keeps it instead of focus falling to the page. -->
        <UiButton
          :tone="action === 'finish' ? 'primary' : action === 'undo' ? 'plain' : 'quiet'"
          size="sm"
          :class="action === 'undo' && '-mr-sm'"
          :disabled="action === 'undo' && reading.undoBusy"
          :aria-label="action === 'undo' && gain ? t('book.progress.undoLabel', { change: gain }) : undefined"
          :data-testid="`home.${action}`"
          @click="act"
        >
          <UiIcon v-if="action === 'finish'" name="check" :size="15" bold />
          {{ action === 'finish' ? t('book.finish') : action === 'undo' ? t('book.progress.undo') : t('book.progress.updateShort') }}
        </UiButton>
      </div>
      <!-- Said once a save lands, as a toast would show it: what changed, and that Undo is there. -->
      <span class="sr-only" role="status">{{ gain ? t('book.progress.saved', { change: gain }) : '' }}</span>
    </div>
  </article>
</template>

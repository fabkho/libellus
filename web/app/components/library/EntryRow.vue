<script setup lang="ts">
// One Library entry in a list (D's library-want and library-finished rows):
// small cover, serif title, author, and a mono meta line — when it was added
// (Want to read), or its Rating and the day it was finished (Finished; "Not
// rated" when there is none; no year, the list is grouped by it). A Book whose
// latest read was abandoned is dimmed (D's `dnf` row) and says "Not finished"
// with the day instead of a Rating (#10). Opens the book page from the
// touch-down (UiPressLink).
import { isNotFinished, type LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'

const props = defineProps<{ entry: LibraryEntry; eager?: boolean }>()

const { t, locale } = useI18n()
const { formatDay } = useDays()
const books = useBookStore()
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
const added = computed(() => t('common.dayMonth', dateParts(new Date(props.entry.addedAt), locale.value)))
const latest = computed(() => props.entry.latestSession)
const notFinished = computed(() => isNotFinished(props.entry))
</script>

<template>
  <UiPressLink
    :to="`/book/${entry.book.id}`"
    class="row flex items-center gap-inset py-sm"
    data-testid="library.entry"
    @press="books.prefetch(entry.book.id)"
  >
    <UiCover
      :title="entry.book.title"
      :authors="entry.book.authors"
      :src="coverSrc(entry.book.coverUrl, 'sm')"
      :thumbhash="entry.book.coverThumbhash"
      :colors="entry.book.coverColors"
      size="sm"
      :eager="eager"
      :class="notFinished && 'dimmed'"
    />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span class="book-title truncate text-body-large" :class="notFinished && 'text-ink-muted'" data-testid="library.entryTitle">{{ entry.book.title }}</span>
      <span class="truncate text-caption" :class="notFinished ? 'text-ink-faint' : 'text-ink-muted'">{{ authorLine }}</span>
      <span v-if="notFinished" class="figures mt-xxs flex items-center gap-xs text-meta text-ink-faint" data-testid="library.entryNotFinished">
        <UiIcon name="slash" :size="11" />
        {{ latest?.endedOn ? t('library.notFinishedOn', { date: formatDay(latest.endedOn, { year: false }) }) : t('status.notFinished') }}
      </span>
      <span v-else-if="entry.status === 'finished'" class="figures mt-xxs flex items-center gap-sm text-meta text-ink-faint">
        <UiStars v-if="latest?.rating" :quarters="latest.rating" data-testid="library.entryRating" />
        <span v-else class="text-ink-ghost" data-testid="library.entryUnrated">{{ t('rating.none') }}</span>
        <template v-if="latest?.endedOn">
          <span class="dot" aria-hidden="true" /><span data-testid="library.entryEnded">{{ formatDay(latest.endedOn, { year: false }) }}</span>
        </template>
      </span>
      <span v-else class="figures mt-xxs text-meta text-ink-faint">{{ t('library.added', { date: added }) }}</span>
    </span>
  </UiPressLink>
</template>

<style scoped>
/* An abandoned read: its cover fades back and its words go quiet. */
.dimmed {
  opacity: 0.45;
  filter: grayscale(0.6);
}

/* Pressed (and, with a mouse, hovered): a fill a little wider than the row,
   so the cover does not sit on its edge. Drawn behind the row's content. */
.row {
  position: relative;
  isolation: isolate;
}

.row::after {
  position: absolute;
  inset: 0 calc(-1 * var(--spacing-sm));
  z-index: -1;
  content: '';
  border-radius: var(--radius-md);
}

.row:active::after {
  background: var(--color-fill-strong);
}

@media (hover: hover) {
  .row:hover:not(:active)::after {
    background: var(--color-fill);
  }
}

.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}

.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>

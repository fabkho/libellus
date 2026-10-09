<script setup lang="ts">
// The Book page's series line (#167), right under the author: "Book 2 of 9 ·
// The Expanse" (the most specific series the Book is in: City Watch before
// Discworld), or "Book 2.5 · …" for a novella between two, or the series'
// name alone where it gives no place. A tap opens the series sheet with its
// neighbours and her statuses, from which she can correct it. Asked for once
// the page shows and kept on the device, so it is there at once (offline too)
// the next time; the first time it opens its room when the answer comes, like
// Goodreads' line. Nothing for a Book in no series. Owns its sheets, so the
// page only places this line.
import type { LibraryEntry } from '~/data/library'
import { useSeriesStore } from '~/stores/series'

const props = defineProps<{ bookId: string | null; entry: LibraryEntry | null }>()

const { t } = useI18n()
const series = useSeriesStore()

onMounted(() =>
  watch(
    () => props.bookId,
    (id) => id && void series.loadForBook(id),
    { immediate: true },
  ),
)

const place = computed(() => (props.bookId ? series.ofBook(props.bookId)?.series[0] : undefined))
// What arrives late waits for the cover's flight (useAfterMotion): the line is there in the first frame when the device has it.
const line = useAfterMotion(() => seriesLine(place.value))
const where = computed(() => {
  const l = line.value
  if (!l?.position) return null
  return l.count ? t('series.bookOf', { n: l.position, count: l.count }) : t('series.book', { n: l.position })
})

function open() {
  if (place.value && props.bookId) series.openSheet(place.value.id, props.bookId)
}
</script>

<template>
  <UiReveal :show="Boolean(line)" class="w-full">
    <p v-if="line" class="mt-xs flex justify-center">
      <button
        type="button"
        class="series -my-xs inline-flex max-w-full py-xs min-w-0 items-center gap-xs text-caption text-ink-muted"
        data-testid="book.series"
        @click="open"
      >
        <span class="truncate">
          <span v-if="where" data-testid="book.seriesPlace">{{ where }}</span>
          <template v-if="where">{{ ' · ' }}</template>
          <span data-testid="book.seriesName">{{ line.name }}</span>
        </span>
        <UiIcon name="chevron" :size="12" class="shrink-0 text-ink-faint" />
      </button>
    </p>
  </UiReveal>
  <SeriesSheet :entry="entry" />
  <SeriesEditSheet />
</template>

<style scoped>
/* One line of small text, padded past the 24 px a target must be (the margins take it back); its touch
   target stays 44 px without moving what is around it. */
.series {
  position: relative;
}
.series::after {
  position: absolute;
  inset: calc((var(--text-caption--line-height) + 2 * var(--spacing-xs) - var(--size-touch)) / 2) 0;
  content: '';
}
</style>

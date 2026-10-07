<script setup lang="ts">
// The series sheet (#167), from the Book page's series line: the series in
// reading order, each work with its place ("Book 3"), year and her status or
// "+ Want to read", the Book it was opened from marked as this one and
// scrolled into view; the series it belongs to above ("Part of Discworld").
// A work opens its Book's page (the sheet closes with the navigation). For a
// Book in her Library, "Correct series" under the list opens the edit sheet;
// a series she set herself says so.
import type { LibraryEntry } from '~/data/library'
import { useSeriesStore } from '~/stores/series'

const props = defineProps<{ entry: LibraryEntry | null }>()

const { t } = useI18n()
const route = useRoute()
const series = useSeriesStore()

const open = computed({
  get: () => series.sheet !== null,
  set: (value) => {
    if (!value) series.sheet = null
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const shown = ref(series.sheet)
watch(
  () => series.sheet,
  (value) => {
    if (value) shown.value = value
  },
)
const info = computed(() => (shown.value ? series.info(shown.value.seriesId) : undefined))
const place = computed(() => (shown.value ? series.ofBook(shown.value.bookId)?.series.find((s) => s.id === shown.value!.seriesId) : undefined))
const mine = computed(() => place.value?.membership === 'member')
/** The work the sheet was opened from: her Book's, else the one at the Book's place. */
const currentIndex = computed(() => {
  const works = info.value?.works ?? []
  const byBook = works.findIndex((w) => w.entry?.bookId && w.entry.bookId === shown.value?.bookId)
  if (byBook >= 0) return byBook
  const at = place.value?.position
  return at === null || at === undefined ? -1 : works.findIndex((w) => w.position === at)
})
const placeOf = (position: number | undefined) => {
  const n = positionText(position)
  return n ? t('series.book', { n }) : null
}

// A Book opened from the list: the sheet goes with the page it was on.
watch(
  () => route.fullPath,
  () => (series.sheet = null),
)

// The Book it was opened from, in view.
const list = useTemplateRef<HTMLElement>('list')
watch(open, (now) => {
  if (!now) return
  void nextTick(() => {
    const row = list.value?.querySelector<HTMLElement>('[data-current]')
    let scroller = row?.parentElement ?? null
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!row || !scroller) return
    // Only the sheet's own list scrolls (never the page under it), and only when the row is out of view.
    const at = row.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    if (at.bottom > box.bottom) scroller.scrollTop += at.top - box.top - (box.height - at.height) / 2
  })
})

function correct() {
  const target = shown.value
  if (!props.entry || !target) return
  series.sheet = null
  series.openEdit(props.entry.id, target.bookId)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="info?.name ?? ''" testid="series">
    <div v-if="info" class="pt-xs pb-sm">
      <p class="figures mb-xs flex items-center justify-center gap-sm text-meta text-ink-faint">
        <span v-if="info.parentName" data-testid="series.parent">{{ t('series.partOf', { name: info.parentName }) }}</span>
        <span v-if="info.parentName" class="dot" aria-hidden="true" />
        <span data-testid="series.count">{{ t('series.count', { count: info.works.length }, info.works.length) }}</span>
      </p>
      <ol ref="list" :aria-label="info.name">
        <AuthorWorkRow
          v-for="(work, index) in info.works"
          :key="work.workId ?? work.entry?.entryId ?? `${work.title}-${index}`"
          :work="work"
          :place="placeOf(work.position)"
          :current="index === currentIndex"
          testid="series.work"
        />
      </ol>
      <template v-if="entry">
        <p v-if="mine" class="mt-md px-xs text-caption text-ink-muted" data-testid="series.mine">{{ t('series.mine') }}</p>
        <UiRowGroup class="mt-md">
          <UiRow as="button" icon="pencil" :label="t('series.correct')" data-testid="series.correct" @click="correct" />
        </UiRowGroup>
      </template>
    </div>
  </UiSheet>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>

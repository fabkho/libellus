<script setup lang="ts">
// A year's four figures (issue #78, A's grid): Books (with the re-reads and
// the DNF under it), Pages (with the reads without a count, or the pages a
// book), the Average Rating (with the ones not rated yet) and the Days a book
// (the median from start to finish). Between hairlines, two by two. The reads
// without a count are a button where a page can open their sheet (the Profile
// and a year in review; `still` on a reading page, #171, whose visitor has
// none). While the reading record loads (`figures` null) the grid stands as it
// will be, its labels in place and a placeholder in the wave where each figure
// goes; the figures arrive into it (docs/MOTION.md, Loading).
import type { YearFigures } from '~/data/stats'

const props = withDefaults(
  defineProps<{
    figures: YearFigures | null
    /** Only the figures, nothing to open (a reading page, #171): the line stays plain text. */
    still?: boolean
  }>(),
  { still: false },
)
defineEmits<{ pagesMissing: [] }>()
const { t } = useI18n()
const { count, large, stars } = useFigures()
const arriving = useArrival(() => !props.figures)

const booksLine = computed(() => {
  const f = props.figures
  if (!f) return ''
  const parts = [f.rereads ? t('profile.figures.rereads', { count: count(f.rereads) }) : null, f.abandoned ? t('profile.figures.dnf', { count: count(f.abandoned) }) : null]
  return parts.filter(Boolean).join(' · ')
})
/** The reads without a count, and whether the line can open them (nothing to open on a reading page). */
const pagesMissing = computed(() => props.figures?.pagesMissing ?? 0)
const pagesMissingOpens = computed(() => !props.still && pagesMissing.value > 0)
const pagesLine = computed(() => {
  const f = props.figures
  if (!f) return ''
  if (pagesMissing.value) return t('profile.figures.pagesMissing', { count: count(pagesMissing.value) })
  return f.books ? t('profile.figures.pagesPerBook', { count: count(Math.round(f.pages / f.books)) }) : ''
})
const averageLine = computed(() => {
  const f = props.figures
  if (!f) return ''
  if (f.unrated) return t('profile.figures.unrated', { count: count(f.unrated) })
  return f.rated ? t('profile.figures.rated', { count: count(f.rated) }) : ''
})

const cells = computed(() => {
  const f = props.figures
  return [
    { key: 'books', label: t('profile.figures.books'), value: f && count(f.books), line: booksLine.value, lineTestid: 'profile.booksLine', edge: 'border-r-(length:--stroke-hairline) border-b-(length:--stroke-hairline) pr-md' },
    { key: 'pages', label: t('profile.figures.pages'), value: f && large(f.pages), line: pagesLine.value, edge: 'border-b-(length:--stroke-hairline) pl-md' },
    { key: 'average', label: t('profile.figures.average'), value: f && stars(f.average), line: averageLine.value, edge: 'border-r-(length:--stroke-hairline) pr-md' },
    {
      key: 'daysABook',
      label: t('profile.figures.daysABook'),
      value: f && (f.medianDays === null ? '–' : count(f.medianDays)),
      line: f ? t('profile.figures.usually') : '',
      edge: 'pl-md',
    },
  ]
})
</script>

<template>
  <!-- A description list: each figure is a term (Books) with its value and line, so assistive tech
       reads them in pairs rather than as one run of words and numbers. -->
  <dl class="grid grid-cols-2 border-y-(length:--stroke-hairline) border-hairline-strong" data-testid="profile.figures">
    <div v-for="(cell, i) in cells" :key="cell.key" class="cell flex min-w-0 flex-col gap-xs border-hairline py-md" :class="cell.edge">
      <dt class="eyebrow">{{ cell.label }}</dt>
      <dd v-if="cell.value === null" class="value flex items-center" aria-hidden="true">
        <span class="bar skeleton wave" :style="{ '--wave': i * 0.12 }" />
      </dd>
      <dd v-else class="value text-figure tabular-nums" :class="{ arrive: arriving }" :style="{ '--chars': String(cell.value).length }" :data-testid="`profile.${cell.key}`">{{ cell.value }}</dd>
      <dd class="figures truncate text-meta text-ink-faint" :class="{ arrive: arriving }" :data-testid="cell.lineTestid">
        <!-- The reads without a count open their sheet; a page without one (a reading page, #171) keeps the plain line. -->
        <button
          v-if="cell.key === 'pages' && pagesMissingOpens"
          type="button"
          class="line -mx-xs flex max-w-full items-center gap-xxs rounded-sm px-xs"
          :aria-label="t('profile.figures.pagesMissingOpen', { count: count(pagesMissing) })"
          data-testid="profile.pagesMissing"
          @click="$emit('pagesMissing')"
        >
          <span class="min-w-0 truncate">{{ cell.line }}</span>
          <UiIcon name="chevron" :size="13" />
        </button>
        <template v-else>{{ cell.line }}</template>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
/* The cell is the container the figure measures itself against (below). */
.cell {
  container-type: inline-size;
}
/* A line with nothing to say keeps its height, so the four cells line up. */
.cell > :last-child {
  min-height: var(--text-meta--line-height);
}
/* The Pages line where it opens a sheet: the quiet press of a tappable figure (Ratings.vue, Columns.vue). */
.line:active {
  background: var(--color-fill);
}
@media (hover: hover) {
  .line:hover {
    background: var(--color-fill);
  }
}
/* The figure's line, held by its placeholder too: nothing moves when it lands. */
.value {
  height: var(--text-figure--line-height);
}
/* A figure never outgrows its cell: at the size the design gives it unless the cell is too narrow
   for its characters (a "29.2K" at 200 % text), when it takes the size that fits, at about 0.62 em
   a character (three at least, so a lone "7" keeps its size). */
.cell .value.text-figure {
  display: flex;
  align-items: center;
  font-size: min(var(--text-figure), calc(100cqi / (max(var(--chars, 3), 3) * 0.62)));
}
/* About the size of a two- or three-digit figure, its digits' height. */
.bar {
  width: var(--spacing-xxxl);
  height: calc(var(--text-figure--line-height) * 0.62);
}
</style>

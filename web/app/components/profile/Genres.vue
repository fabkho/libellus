<script setup lang="ts">
// What the member reads, by genre (issue #168: "Your year: 40 % sci-fi"): one row per genre, most
// read first, up to `limit`: the name, a bar on a hairline that fills to its share, the share in
// mono. A Book counts in each of its (up to three) genres, so the shares of a year can add up to
// more than a whole: each bar is its own share of the books that have a genre
// (data/enrich/genreFigures.ts). A row is a button: it opens the Library, Finished, filtered by
// that genre (and by the year in view). While the reading record loads (`figures` null), `limit`
// rows stand with their empty bars in the loading wave (docs/MOTION.md, Loading).
import type { GenreFigures } from '~/data/enrich/genreFigures'
import type { GenreId } from '~/data/enrich/genres'

const props = withDefaults(defineProps<{ figures: GenreFigures | null; limit?: number }>(), { limit: 5 })
defineEmits<{ pick: [genre: GenreId] }>()
const { t } = useI18n()
const { count, percent } = useFigures()
const loading = computed(() => !props.figures)
const arriving = useArrival(() => loading.value)
const rows = computed(() => props.figures?.genres.slice(0, props.limit) ?? [])
</script>

<template>
  <section id="genres" class="flex flex-col gap-xs" data-testid="profile.genres">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow">{{ t('genre.stats.title') }}</h2>
      <span v-if="figures" class="figures text-meta text-ink-faint" :class="{ arrive: arriving }" data-testid="profile.genresPlaced">
        {{ t('genre.stats.placed', { count: count(figures.placed) }, figures.placed) }}<template v-if="figures.without"> · {{ t('genre.stats.without', { count: count(figures.without) }) }}</template>
      </span>
      <span v-else class="summary flex items-center" aria-hidden="true"><span class="skeleton wave" /></span>
    </div>
    <div class="-mx-sm flex flex-col">
      <template v-if="figures">
        <button
          v-for="row in rows"
          :key="row.genre"
          type="button"
          class="row grid h-(--size-touch) grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] items-center gap-ms rounded-sm px-sm text-left"
          :class="{ arrive: arriving }"
          :aria-label="t('genre.stats.row', { genre: t(`genre.${row.genre}`), count: count(row.count), percent: percent(row.share) }, row.count)"
          :data-testid="`profile.genre.${row.genre}`"
          @click="$emit('pick', row.genre)"
        >
          <span class="truncate text-body" aria-hidden="true">{{ t(`genre.${row.genre}`) }}</span>
          <span class="relative h-(--stroke-focus) rounded-pill bg-hairline-strong" aria-hidden="true">
            <span class="fill absolute inset-y-0 left-0 rounded-pill bg-accent" :style="{ '--w': row.share }" />
          </span>
          <span class="figures w-(--size-button-sm) text-right text-meta text-ink-muted" aria-hidden="true">{{ percent(row.share) }}</span>
        </button>
      </template>
      <template v-else>
        <span v-for="i in limit" :key="i" class="row grid h-(--size-touch) grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] items-center gap-ms px-sm" aria-hidden="true">
          <span class="label skeleton wave" :style="{ '--wave': (i - 1) * 0.15 }" />
          <span class="relative h-(--stroke-focus) rounded-pill bg-hairline-strong wave" :style="{ '--wave': (i - 1) * 0.15 }" />
          <span class="w-(--size-button-sm)" />
        </span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.fill {
  width: calc(var(--w) * 100%);
  /* Filling to its share when the figures come (and when another year is picked). */
  transition: width var(--duration-standard) var(--ease-standard);
}
.summary {
  height: var(--text-meta--line-height);
}
.summary > * {
  width: calc(var(--spacing-xxxl) + var(--spacing-xl));
  height: 62%;
}
.label {
  height: 62%;
  width: 60%;
}
button.row:active {
  background: var(--color-fill);
}
@media (hover: hover) {
  button.row:hover {
    background: var(--color-fill);
  }
}
</style>

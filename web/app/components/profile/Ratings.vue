<script setup lang="ts">
// How the Ratings fall (issue #78): one row per whole star, 5 down to 1 (a
// 4.75 counts as four), the stars, a bar in the star colour on a hairline, the
// count. A row with books is a button: it opens the books rated so.
import type { YearFigures } from '~/data/stats'

const props = defineProps<{ figures: YearFigures }>()
defineEmits<{ pick: [star: number] }>()
const { t } = useI18n()
const { count } = useFigures()
const top = computed(() => Math.max(...props.figures.byStar.map((b) => b.count), 1))
</script>

<template>
  <section id="ratings" class="flex flex-col gap-xs" data-testid="profile.ratings">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow">{{ t('profile.ratings.title') }}</h2>
      <span class="figures text-meta text-ink-faint">
        {{ t('profile.ratings.rated', { count: count(figures.rated) }) }}<template v-if="figures.unrated"> · {{ t('profile.ratings.notYet', { count: count(figures.unrated) }) }}</template>
      </span>
    </div>
    <div class="-mx-sm flex flex-col">
      <button
        v-for="row in figures.byStar"
        :key="row.star"
        type="button"
        class="row flex h-(--size-touch) items-center gap-ms rounded-sm px-sm text-left"
        :disabled="!row.count"
        :aria-label="t('profile.ratings.row', { star: row.star, count: count(row.count) }, row.star)"
        :data-testid="`profile.stars.${row.star}`"
        @click="$emit('pick', row.star)"
      >
        <UiStars :quarters="row.star * 4" :show-value="false" />
        <span class="relative h-(--stroke-focus) flex-1 rounded-pill bg-hairline-strong">
          <span class="fill absolute inset-y-0 left-0 rounded-pill bg-star" :style="{ '--w': row.count / top }" />
        </span>
        <span class="figures w-(--size-button-sm) text-right text-meta" :class="row.count ? 'text-ink-muted' : 'text-ink-ghost'">{{ count(row.count) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.fill {
  width: calc(var(--w) * 100%);
}
.row:not(:disabled):active {
  background: var(--color-fill);
}
@media (hover: hover) {
  .row:not(:disabled):hover {
    background: var(--color-fill);
  }
}
</style>

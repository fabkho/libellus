<script setup lang="ts">
// Design round #78: how the ratings fall, one row per whole star (5 down to
// 1; a 4.75 counts as four): the stars, a bar on a hairline, the count. With
// `pickable` a row is a button (D: it opens the books rated so).
import type { Stats } from './model'

const props = withDefaults(defineProps<{ stats: Stats; pickable?: boolean }>(), { pickable: false })
defineEmits<{ pick: [star: number] }>()
const top = computed(() => Math.max(...props.stats.byStar.map((b) => b.count), 1))
</script>

<template>
  <div class="flex flex-col" :class="pickable ? '-mx-sm' : 'gap-sm'" data-testid="proto.starBars">
    <component
      :is="pickable ? 'button' : 'div'"
      v-for="row in stats.byStar"
      :key="row.star"
      :type="pickable ? 'button' : undefined"
      :disabled="pickable && !row.count ? true : undefined"
      class="flex items-center gap-ms text-left"
      :class="pickable && 'row h-(--size-button-sm) rounded-sm px-sm'"
      :aria-label="pickable ? `${row.star} stars: ${row.count}` : undefined"
      :data-testid="`proto.stars.${row.star}`"
      @click="pickable && row.count && $emit('pick', row.star)"
    >
      <UiStars :quarters="row.star * 4" :show-value="false" />
      <span class="track relative h-(--stroke-focus) flex-1 rounded-pill bg-hairline-strong">
        <span class="fill absolute inset-y-0 left-0 rounded-pill bg-star" :style="{ '--w': row.count / top }" />
      </span>
      <span class="figures w-(--size-button-sm) text-right text-meta" :class="row.count ? 'text-ink-muted' : 'text-ink-ghost'">{{ row.count }}</span>
    </component>
  </div>
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

<script setup lang="ts">
// Design round #78: how the ratings fall, one row per whole star (5 down to
// 1; a 4.75 counts as four): the stars, a bar on a hairline, the count.
import type { Stats } from './model'

const props = defineProps<{ stats: Stats }>()
const top = computed(() => Math.max(...props.stats.byStar.map((b) => b.count), 1))
</script>

<template>
  <div class="flex flex-col gap-sm" data-testid="proto.starBars">
    <div v-for="row in stats.byStar" :key="row.star" class="flex items-center gap-ms">
      <UiStars :quarters="row.star * 4" :show-value="false" />
      <span class="track relative h-(--stroke-focus) flex-1 rounded-pill bg-hairline-strong">
        <span class="fill absolute inset-y-0 left-0 rounded-pill bg-star" :style="{ '--w': row.count / top }" />
      </span>
      <span class="figures w-(--size-button-sm) text-right text-meta" :class="row.count ? 'text-ink-muted' : 'text-ink-ghost'">{{ row.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.fill {
  width: calc(var(--w) * 100%);
}
</style>

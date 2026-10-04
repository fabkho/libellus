<script setup lang="ts">
// Design round #78: a small column chart — books per month, or per year. One
// column per value, the count over it when there is one, its label under it.
// The `lit` column (this month, the year in view) is the lamp; the others are
// ink, quiet. Columns are buttons when `pickable` (a month opens its books).
const props = withDefaults(
  defineProps<{ values: readonly number[]; labels: readonly string[]; lit?: number | null; pickable?: boolean; tall?: boolean; testid?: string }>(),
  { lit: null, pickable: false, tall: false, testid: 'proto.bars' },
)
defineEmits<{ pick: [index: number] }>()
const top = computed(() => Math.max(...props.values, 1))
</script>

<template>
  <div class="bars" :class="tall && 'tall'" :data-testid="testid">
    <component
      :is="pickable ? 'button' : 'div'"
      v-for="(value, i) in values"
      :key="i"
      :type="pickable ? 'button' : undefined"
      class="col"
      :class="pickable && value && 'pick'"
      :disabled="pickable && !value ? true : undefined"
      :aria-label="`${labels[i]}: ${value}`"
      :data-testid="`${testid}.${i}`"
      @click="pickable && value && $emit('pick', i)"
    >
      <span class="figures text-meta" :class="i === lit ? 'text-accent' : value ? 'text-ink-muted' : 'text-ink-ghost'">{{ value || '' }}</span>
      <span class="bar" :class="{ lit: i === lit, none: !value }" :style="{ '--h': value / top }" />
      <span class="figures text-meta" :class="i === lit ? 'text-accent' : 'text-ink-faint'">{{ labels[i] }}</span>
    </component>
  </div>
</template>

<style scoped>
.bars {
  --bars-h: var(--spacing-xxl);
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-xs);
}
.tall {
  --bars-h: calc(var(--spacing-xxxl) + var(--spacing-md));
}
.col {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
  border-radius: var(--radius-sm);
  padding-block: var(--spacing-xxs);
}
.pick:active {
  background: var(--color-fill);
}
.bar {
  width: 100%;
  max-width: var(--spacing-ml);
  height: calc(var(--h) * var(--bars-h));
  min-height: var(--stroke-focus);
  border-radius: var(--radius-cover-sm);
  background: var(--color-ink-ghost);
  transition: height var(--duration-standard) var(--ease-standard);
}
.pick .bar {
  background: var(--color-ink-faint);
}
.bar.none {
  width: var(--stroke-focus);
  height: var(--stroke-focus);
  border-radius: var(--radius-pill);
}
.bar.lit {
  background: var(--color-accent);
}
</style>

<script setup lang="ts">
// A small column chart (issue #78): books per month of a year, or per year.
// One column per value, its count over it, its label under it; the `lit`
// column (this month, this year) in the lamp colour, the others ink, quiet.
// A column with books is a button (a month opens its books, a year its
// review); an empty one is a dot on the line.
const props = withDefaults(
  defineProps<{ columns: readonly { key: number; count: number; label: string; name: string }[]; lit?: number | null; testid: string }>(),
  { lit: null },
)
defineEmits<{ pick: [key: number] }>()
const { t } = useI18n()
const { count } = useFigures()
const top = computed(() => Math.max(...props.columns.map((c) => c.count), 1))
</script>

<template>
  <div class="columns flex items-end gap-xs" :data-testid="testid">
    <button
      v-for="column in columns"
      :key="column.key"
      type="button"
      class="column flex min-w-0 flex-1 flex-col items-center justify-end gap-xs rounded-sm py-xxs"
      :disabled="!column.count"
      :aria-label="t('profile.columnLabel', { label: column.name, count: count(column.count) })"
      :data-testid="`${testid}.${column.key}`"
      @click="$emit('pick', column.key)"
    >
      <span class="figures text-meta" :class="column.key === lit ? 'text-accent' : column.count ? 'text-ink-muted' : 'text-ink-ghost'">{{ column.count || '' }}</span>
      <span class="bar" :class="{ lit: column.key === lit, none: !column.count }" :style="{ '--h': column.count / top }" />
      <span class="figures text-meta" :class="column.key === lit ? 'text-accent' : 'text-ink-faint'" aria-hidden="true">{{ column.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.columns {
  --columns-h: calc(var(--spacing-xxxl) + var(--spacing-md));
}
.column:not(:disabled):active {
  background: var(--color-fill);
}
.bar {
  width: 100%;
  max-width: var(--spacing-ml);
  height: calc(var(--h) * var(--columns-h));
  min-height: var(--stroke-focus);
  border-radius: var(--radius-cover-sm);
  background: var(--color-ink-faint);
  transition: height var(--duration-standard) var(--ease-standard);
}
.bar.none {
  width: var(--stroke-focus);
  height: var(--stroke-focus);
  border-radius: var(--radius-pill);
  background: var(--color-ink-ghost);
}
.bar.lit {
  background: var(--color-accent);
}
@media (prefers-reduced-motion: reduce) {
  .bar {
    transition: none;
  }
}
</style>

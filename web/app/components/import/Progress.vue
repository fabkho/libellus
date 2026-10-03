<script setup lang="ts">
// How far a long step has come (the import's lookups, then its writes): the
// count in words, a hairline track lit in the accent as far as it got, and a
// quiet line saying what happens meanwhile. `testid` names the bar.
const props = defineProps<{ label: string; hint: string; done: number; total: number; testid: string }>()

const share = computed(() => (props.total ? Math.min(1, props.done / props.total) : 0))
</script>

<template>
  <section class="flex flex-col gap-sm">
    <p class="figures text-caption text-ink" :data-testid="`${testid}.label`">{{ label }}</p>
    <div
      class="track h-(--stroke-focus) overflow-hidden rounded-pill bg-fill-strong"
      role="progressbar"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="total"
      :aria-valuenow="done"
      :data-testid="testid"
    >
      <span class="fill block h-full rounded-pill bg-accent" :style="{ transform: `scaleX(${share})` }" />
    </div>
    <p class="text-footnote text-ink-faint">{{ hint }}</p>
  </section>
</template>

<style scoped>
.fill {
  transform-origin: left center;
  transition: transform var(--duration-standard) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>

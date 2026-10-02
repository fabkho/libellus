<script setup lang="ts">
// A paper luggage tag: Collections on a book, filters. The punched hole makes
// it a tag rather than a button; `dashed` is the "add" variant.
defineProps<{ selected?: boolean; dashed?: boolean; hole?: boolean }>()
</script>

<template>
  <span class="chip" :class="{ selected, dashed, hole }">
    <span v-if="hole" class="punch" />
    <slot />
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--c1-card);
  color: var(--c1-ink);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 0 0 1px var(--c1-line-strong);
}

.hole {
  padding-left: 11px;
}

.punch {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c1-paper);
  box-shadow: inset 0 0 0 1px var(--c1-line-strong);
}

.selected {
  background: var(--c1-ink);
  color: var(--c1-paper);
  box-shadow: none;
}

.dashed {
  background: transparent;
  color: var(--c1-ink-soft);
  box-shadow: none;
  outline: 1px dashed var(--c1-line-strong);
  outline-offset: -1px;
}
</style>

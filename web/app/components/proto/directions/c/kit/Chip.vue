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
  height: 36px;
  padding: 0 14px;
  border-radius: 12px;
  background: var(--c-card);
  color: var(--c-ink);
  font-size: 14.5px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 0 0 1.5px var(--c-line-strong);
}

.hole {
  padding-left: 10px;
  border-radius: 6px 12px 12px 6px;
}

.punch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-paper);
  box-shadow: inset 0 0 0 1.5px var(--c-line-strong);
}

.selected {
  background: var(--c-ink);
  color: var(--c-paper);
  box-shadow: none;
}

.dashed {
  background: transparent;
  color: var(--c-ink-soft);
  box-shadow: none;
  outline: 1.5px dashed var(--c-line-strong);
  outline-offset: -1.5px;
}
</style>

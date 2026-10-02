<script setup lang="ts">
// The Status segments: a quiet track, the selected one a lifted card.
defineProps<{ options: { value: string; label: string; count?: number }[]; value: string }>()
</script>

<template>
  <div class="seg">
    <span v-for="option in options" :key="option.value" class="opt" :class="{ on: option.value === value }">
      {{ option.label }}
      <span v-if="option.count != null" class="count">{{ option.count }}</span>
    </span>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: var(--c1-paper-deep);
}

.opt {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 36px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  color: var(--c1-ink-soft);
  white-space: nowrap;
}

.on {
  background: var(--c1-card);
  color: var(--c1-ink);
  font-weight: 600;
  box-shadow:
    0 0 0 0.5px rgb(var(--c1-shadow) / 0.08),
    0 2px 6px -2px rgb(var(--c1-shadow) / 0.18);
}

.count {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c1-muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.on .count {
  color: var(--c1-accent);
}
</style>

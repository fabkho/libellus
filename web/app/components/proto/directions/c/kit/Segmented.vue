<script setup lang="ts">
// The Status segments: a chunky track, the selected one a raised paper key.
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
  border-radius: 18px;
  background: var(--c-paper-deep);
  box-shadow: inset 0 1px 2px rgb(var(--c-shadow) / 0.08);
}

.opt {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 40px;
  border-radius: 14px;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--c-ink-soft);
  white-space: nowrap;
}

.on {
  background: var(--c-card);
  color: var(--c-ink);
  font-weight: 800;
  box-shadow:
    0 2px 0 var(--c-line-strong),
    0 4px 10px -4px rgb(var(--c-shadow) / 0.25);
}

.count {
  min-width: 20px;
  padding: 1px 5px;
  border-radius: 7px;
  background: rgb(var(--c-shadow) / 0.07);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.on .count {
  background: var(--c-accent);
  color: var(--c-accent-ink);
}
</style>

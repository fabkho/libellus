<script setup lang="ts">
// The Status switch of the Library: a sunk track with a raised white thumb.
// Each segment carries its count.
defineProps<{ options: { value: string; label: string; count?: number }[]; value: string }>()
</script>

<template>
  <div class="track" role="tablist">
    <span
      v-for="option in options"
      :key="option.value"
      class="segment"
      :class="{ on: option.value === value }"
      role="tab"
      :aria-selected="option.value === value"
    >
      {{ option.label }}
      <span v-if="option.count != null" class="count ad-num">{{ option.count }}</span>
    </span>
  </div>
</template>

<style scoped>
.track {
  display: flex;
  height: 40px;
  padding: 3px;
  border-radius: 999px;
  background: rgb(var(--ad-tint) / 0.065);
}

.segment {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 999px;
  color: var(--ad-ink-2);
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
}

.on {
  background: var(--ad-card);
  box-shadow:
    0 0 0 0.5px rgb(0 0 0 / 0.04),
    0 2px 6px rgb(var(--ad-shade) / 0.1);
  color: var(--ad-ink);
  font-weight: 600;
}

.count {
  color: var(--ad-ink-3);
  font-weight: 500;
}

.on .count {
  color: var(--ad-accent);
  font-weight: 600;
}
</style>

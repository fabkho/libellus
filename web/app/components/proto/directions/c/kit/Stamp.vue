<script setup lang="ts">
// A rubber date stamp, the library kind: a double-ruled box, a small label
// over a typewritten date, slightly crooked, ink uneven when texture is on.
withDefaults(
  defineProps<{
    label?: string
    date: string
    tone?: 'red' | 'blue' | 'ink'
    rotate?: number
    size?: number
    round?: boolean
  }>(),
  { label: '', tone: 'red', rotate: -6, size: 1, round: false },
)
</script>

<template>
  <span
    class="stamp c-ink-grain"
    :class="[tone, { round }]"
    :style="{ transform: `rotate(${rotate}deg) scale(${size})` }"
  >
    <span v-if="label" class="label">{{ label }}</span>
    <span class="date">{{ date }}</span>
  </span>
</template>

<style scoped>
.stamp {
  --ink: var(--c-stamp);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 9px 4px;
  border: 2px solid var(--ink);
  border-radius: 6px;
  outline: 1px solid var(--ink);
  outline-offset: 2px;
  color: var(--ink);
  font-family: var(--c-mono);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  transform-origin: center;
  opacity: 0.92;
}

.blue {
  --ink: var(--c-stamp-blue);
}

.ink {
  --ink: var(--c-ink-soft);
}

.round {
  border-radius: 999px;
  padding: 5px 12px;
}

.label {
  font-family: var(--c-sans);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.date {
  font-size: 15px;
  letter-spacing: 0.04em;
}
</style>

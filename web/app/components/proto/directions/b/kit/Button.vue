<script setup lang="ts">
// Buttons, printed rather than glossy: `solid` is a flat block of the accent,
// `outline` a hairline ink box, `quiet` text with an underline. Square corners
// (2 px), 48 pt tall, the label in the text face.
withDefaults(defineProps<{ tone?: 'solid' | 'outline' | 'quiet'; small?: boolean; compact?: boolean }>(), { tone: 'solid' })
</script>

<template>
  <span class="button" :class="[`tone-${tone}`, { small, compact }]">
    <slot />
  </span>
</template>

<style scoped>
.button {
  display: inline-flex;
  width: 100%;
  height: 48px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 2px;
  font-family: var(--b-text);
  font-size: 17px;
  font-weight: 500;
  line-height: 24px;
  letter-spacing: 0.005em;
  white-space: nowrap;
}

.small {
  height: 44px;
  font-size: 16px;
}

/* 36 pt drawn, 44 pt to the finger: the hit area reaches 4 pt past each edge. */
.compact {
  position: relative;
  height: 36px;
  font-size: 16px;
}

.compact::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}

.tone-solid {
  background: var(--b-accent);
  color: var(--b-on-accent);
}

.tone-outline {
  border: 1px solid var(--b-ink);
  color: var(--b-ink);
}

.tone-quiet {
  width: auto;
  padding: 0 4px;
  color: var(--b-accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}
</style>

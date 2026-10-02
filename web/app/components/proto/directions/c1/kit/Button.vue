<script setup lang="ts">
// Pill buttons, A/D style: flat fill, a soft lift on the primary only.
// primary = accent, dark = ink, secondary = card with a hairline, soft =
// tinted, plain = text only. Full width unless `inline`.
withDefaults(
  defineProps<{ tone?: 'primary' | 'dark' | 'secondary' | 'soft' | 'plain'; inline?: boolean; small?: boolean }>(),
  { tone: 'primary' },
)
</script>

<template>
  <span class="btn" :class="[tone, { inline, small }]"><slot /></span>
</template>

<style scoped>
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 52px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 16.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap;
}

.inline {
  display: inline-flex;
}

.small {
  height: 40px;
  padding: 0 16px;
  font-size: 15px;
}

.primary {
  background: var(--c1-accent);
  color: var(--c1-accent-ink);
  box-shadow: 0 6px 16px -8px color-mix(in srgb, var(--c1-accent) 70%, transparent);
}

.dark {
  background: var(--c1-ink);
  color: var(--c1-paper);
}

.secondary {
  background: var(--c1-card);
  color: var(--c1-ink);
  box-shadow: 0 0 0 1px var(--c1-line-strong);
}

.soft {
  background: var(--c1-accent-soft);
  color: var(--c1-accent-deep);
}

.plain {
  color: var(--c1-ink-soft);
}
</style>

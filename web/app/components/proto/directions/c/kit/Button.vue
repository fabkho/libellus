<script setup lang="ts">
// Chunky pill buttons with a pressed-edge underneath, like a key you can push.
// primary = accent, dark = ink, secondary = card with an edge, soft = tinted,
// plain = text only. Full width unless `inline`.
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
  height: 54px;
  padding: 0 22px;
  border-radius: 18px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.005em;
  white-space: nowrap;
}

.inline {
  display: inline-flex;
}

.small {
  height: 44px;
  padding: 0 16px;
  border-radius: 15px;
  font-size: 15px;
}

.primary {
  background: var(--c-accent);
  color: var(--c-accent-ink);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.25),
    0 3px 0 var(--c-accent-deep),
    0 8px 16px -6px rgb(var(--c-shadow) / 0.35);
}

.dark {
  background: var(--c-ink);
  color: var(--c-paper);
  box-shadow:
    0 3px 0 rgb(0 0 0 / 0.35),
    0 8px 16px -6px rgb(var(--c-shadow) / 0.35);
}

.secondary {
  background: var(--c-card);
  color: var(--c-ink);
  box-shadow:
    0 0 0 1.5px var(--c-line-strong),
    0 3px 0 1.5px var(--c-line-strong);
}

.soft {
  background: var(--c-mustard-soft);
  color: var(--c-ink);
  box-shadow: 0 3px 0 color-mix(in srgb, var(--c-mustard) 55%, var(--c-mustard-soft));
}

.plain {
  color: var(--c-ink-soft);
}
</style>

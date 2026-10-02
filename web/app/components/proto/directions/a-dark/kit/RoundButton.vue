<script setup lang="ts">
// A floating toolbar control: a frosted 44 px circle with one icon (back, more,
// add, close), or a frosted capsule when it has a label. `accent` fills it with
// the accent colour (a sheet's confirm button).
import type { IconName } from './Icon.vue'
import Icon from './Icon.vue'

withDefaults(defineProps<{ icon?: IconName; label?: string; accent?: boolean; size?: number }>(), {
  size: 44,
})
</script>

<template>
  <span
    class="round"
    :class="[accent ? 'accent' : 'ad-glass', { labelled: label }]"
    :style="{ height: `${size}px`, minWidth: `${size}px` }"
    role="button"
    :aria-label="label ?? icon"
  >
    <Icon v-if="icon" :name="icon" :size="Math.round(size * 0.5)" :stroke="1.9" />
    <span v-if="label" class="text">{{ label }}</span>
  </span>
</template>

<style scoped>
.round {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 999px;
  color: var(--ad-ink);
}

.round > * {
  position: relative;
  z-index: 1;
}

.labelled {
  padding: 0 16px 0 12px;
}

.text {
  font-size: 15px;
  font-weight: 600;
}

.accent {
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  box-shadow:
    0 6px 16px -6px color-mix(in oklab, var(--ad-accent) 70%, transparent),
    inset 0 1px 0 rgb(255 255 255 / 0.22);
}
</style>

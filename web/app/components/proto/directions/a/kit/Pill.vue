<script setup lang="ts">
// A button. `accent` is the one prominent action of a screen; `soft` a quiet
// second choice; `plain` text only. Always at least 44 px tall.
import type { IconName } from './Icon.vue'
import Icon from './Icon.vue'

withDefaults(
  defineProps<{ tone?: 'accent' | 'soft' | 'plain' | 'ink'; size?: 'lg' | 'md' | 'sm'; icon?: IconName; block?: boolean }>(),
  { tone: 'accent', size: 'lg', block: false },
)
</script>

<template>
  <span class="pill a-squircle" :class="[`tone-${tone}`, `size-${size}`, { block }]" role="button">
    <Icon v-if="icon" :name="icon" :size="size === 'sm' ? 16 : 19" :stroke="2" />
    <span><slot /></span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 999px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.block {
  display: flex;
  width: 100%;
}

.size-lg {
  height: 52px;
  padding: 0 26px;
  font-size: 17px;
}

.size-md {
  height: 44px;
  padding: 0 20px;
  font-size: 15.5px;
}

/* Small pills draw 34 px but take a 44 px touch target. */
.size-sm {
  position: relative;
  height: 34px;
  padding: 0 14px;
  font-size: 14px;
}

.size-sm::after {
  content: '';
  position: absolute;
  inset: -5px 0;
}

.tone-accent {
  background: var(--a-accent);
  color: var(--a-on-accent);
  box-shadow:
    0 8px 20px -8px color-mix(in oklab, var(--a-accent) 75%, transparent),
    inset 0 1px 0 rgb(255 255 255 / 0.2);
}

.tone-ink {
  background: var(--a-ink);
  color: var(--a-paper);
}

.tone-soft {
  background: var(--a-fill);
  color: var(--a-ink);
}

.tone-plain {
  padding-inline: 8px;
  color: var(--a-accent);
}
</style>

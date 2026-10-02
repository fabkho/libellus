<script setup lang="ts">
// D's pill. `primary` is the lit one (ink on the room, one per screen),
// `secondary` a hairline outline, `quiet` a translucent fill (actions on cards),
// `plain` text only (the third choice, links in a sentence), `danger`
// destructive. Three sizes; the touch target never shrinks below 44 px,
// whatever the drawn size. With `to` it is a link, otherwise a <button>.
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    tone?: 'primary' | 'secondary' | 'quiet' | 'plain' | 'danger'
    size?: 'lg' | 'md' | 'sm'
    block?: boolean
    to?: RouteLocationRaw
    type?: 'button' | 'submit'
  }>(),
  { tone: 'primary', size: 'lg', block: false, to: undefined, type: 'button' },
)

const TONES = {
  primary: 'bg-ink text-on-ink shadow-button',
  secondary: 'border border-hairline-strong text-ink',
  quiet: 'bg-fill-strong text-ink',
  plain: 'text-ink-muted',
  danger: 'border border-hairline-strong text-error',
} as const

const SIZES = {
  lg: 'h-(--size-button) px-lg text-body-large',
  md: 'h-(--size-button-md) px-md text-subhead',
  sm: 'h-(--size-button-sm) px-ms text-caption',
} as const

const classes = computed(() => [
  TONES[props.tone],
  SIZES[props.size],
  props.block ? 'flex w-full' : 'inline-flex',
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" class="ui-button" :class="classes"><slot /></NuxtLink>
  <button v-else :type="type" class="ui-button" :class="classes"><slot /></button>
</template>

<style scoped>
.ui-button {
  position: relative;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  border-radius: var(--radius-pill);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  user-select: none;
  transition:
    transform var(--duration-instant) var(--ease-standard),
    opacity var(--duration-quick) var(--ease-standard);
}

/* The 44 px target, centred on the drawn pill. */
.ui-button::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  min-width: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}

.ui-button:active:not(:disabled) {
  transform: scale(0.97);
}

.ui-button:disabled {
  opacity: 0.5;
}
</style>

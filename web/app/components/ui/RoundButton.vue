<script setup lang="ts">
// A round glass button for chrome that floats over content (TopBar, the
// reader's capsule). The icon is the face, or the default slot where a face is
// not an icon (the reader's Aa); `label` is what assistive tech says.
import type { IconName } from './Icon.vue'

defineProps<{ icon?: IconName; label: string }>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="relative flex size-(--size-touch) items-center justify-center text-ink disabled:opacity-50"
  >
    <span class="round flex size-(--size-button-md) items-center justify-center rounded-pill edge">
      <slot><UiIcon v-if="icon" :name="icon" :size="20" /></slot>
    </span>
  </button>
</template>

<style scoped>
.round {
  background-color: color-mix(in srgb, var(--color-surface-sheet) var(--glass-solid, 0%), var(--color-glass));
  -webkit-backdrop-filter: blur(calc(var(--blur-chrome) * var(--glass-scale, 1)));
  backdrop-filter: blur(calc(var(--blur-chrome) * var(--glass-scale, 1)));
}
</style>

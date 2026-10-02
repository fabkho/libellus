<script setup lang="ts">
// A round glass button for chrome that floats over content (TopBar). The icon
// is the face; `label` is what assistive tech and the tooltip say.
import type { IconName } from './Icon.vue'

defineProps<{ icon: IconName; label: string }>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="relative flex size-(--size-touch) items-center justify-center text-ink"
  >
    <span class="round flex size-(--size-button-md) items-center justify-center rounded-pill edge">
      <UiIcon :name="icon" :size="20" />
    </span>
  </button>
</template>

<style scoped>
.round {
  background-color: var(--color-glass);
  -webkit-backdrop-filter: blur(var(--blur-chrome));
  backdrop-filter: blur(var(--blur-chrome));
}
</style>

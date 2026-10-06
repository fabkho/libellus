<script setup lang="ts">
// UiRoundButton with any face: a glass round button, 44 px target, 40 px disc.
// For the reader's own icons (contents) and the Aa glyph.
defineProps<{ label: string }>()
</script>

<template>
  <button type="button" :aria-label="label" class="relative flex size-(--size-touch) items-center justify-center text-ink">
    <span class="round flex size-(--size-button-md) items-center justify-center rounded-pill edge">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.round {
  background-color: var(--color-glass);
  -webkit-backdrop-filter: blur(var(--blur-chrome));
  backdrop-filter: blur(var(--blur-chrome));
}
.aa {
  font-family: var(--font-serif);
}
</style>

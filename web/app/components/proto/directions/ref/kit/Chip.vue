<script setup lang="ts">
defineProps<{ selected?: boolean }>()
</script>

<template>
  <span
    class="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px]"
    :class="selected ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 text-neutral-700'"
  >
    <slot />
  </span>
</template>

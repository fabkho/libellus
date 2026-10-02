<script setup lang="ts">
// Primary = filled, secondary = outlined, plain = text only. Full width by default.
defineProps<{ tone?: 'primary' | 'secondary' | 'plain'; inline?: boolean }>()
</script>

<template>
  <span
    class="flex h-12 items-center justify-center gap-2 rounded-lg px-4 text-[16px] font-semibold"
    :class="[
      inline ? 'inline-flex' : 'w-full',
      tone === 'secondary'
        ? 'border border-neutral-400 text-neutral-800'
        : tone === 'plain'
          ? 'text-neutral-600'
          : 'bg-neutral-800 text-white',
    ]"
  >
    <slot />
  </span>
</template>

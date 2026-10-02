<script setup lang="ts">
// A titled block of a screen; the trailing slot holds "See all" and similar.
defineProps<{ title: string }>()
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between">
      <h2 class="text-[13px] font-semibold tracking-wide text-neutral-500 uppercase">{{ title }}</h2>
      <slot name="trailing" />
    </div>
    <slot />
  </section>
</template>

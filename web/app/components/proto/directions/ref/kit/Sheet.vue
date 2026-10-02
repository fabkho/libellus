<script setup lang="ts">
// A bottom sheet over the screen it is placed after: scrim, grabber, title row
// (Cancel · title · trailing action), then the content.
defineProps<{ title: string; action?: string }>()
</script>

<template>
  <div class="absolute inset-0 z-20 bg-black/40" />
  <section
    class="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[14px] bg-white px-5 pb-[calc(var(--safe-bottom)+12px)]"
  >
    <span class="mx-auto mt-2 h-[5px] w-9 rounded-full bg-neutral-300" />
    <div class="flex h-12 items-center justify-between text-[16px]">
      <span class="text-neutral-500">Cancel</span>
      <span class="font-semibold">{{ title }}</span>
      <span class="font-semibold" :class="action ? 'text-neutral-900' : 'invisible'">{{ action ?? 'Done' }}</span>
    </div>
    <slot />
  </section>
</template>

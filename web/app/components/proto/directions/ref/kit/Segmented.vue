<script setup lang="ts">
// A row of mutually exclusive options; `value` is the selected one.
defineProps<{ options: { value: string; label: string; count?: number }[]; value: string }>()
</script>

<template>
  <div class="flex rounded-lg bg-neutral-200 p-[3px]">
    <span
      v-for="option in options"
      :key="option.value"
      class="flex h-8 flex-1 items-center justify-center gap-1 rounded-md text-[13px] whitespace-nowrap"
      :class="option.value === value ? 'bg-white font-semibold shadow-sm' : 'text-neutral-600'"
    >
      {{ option.label }}
      <span v-if="option.count != null" class="text-neutral-400">{{ option.count }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
// The three tabs. Pinned to the bottom of the phone, above the home indicator.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'library', label: 'Library' },
  { key: 'search', label: 'Search' },
] as const
</script>

<template>
  <nav class="absolute inset-x-0 bottom-0 z-10 flex border-t border-neutral-300 bg-white pb-[var(--safe-bottom)]">
    <span
      v-for="tab in tabs"
      :key="tab.key"
      class="flex flex-1 flex-col items-center gap-[2px] pt-2 text-[11px]"
      :class="tab.key === active ? 'font-semibold text-neutral-900' : 'text-neutral-400'"
    >
      <Icon :name="tab.key" :size="24" />
      {{ tab.label }}
    </span>
  </nav>
</template>

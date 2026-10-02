<script setup lang="ts">
// A handful of outline icons, 24 px grid, stroke = currentColor.
defineProps<{
  name: 'home' | 'library' | 'search' | 'back' | 'plus' | 'more' | 'close' | 'check' | 'drag' | 'chevron' | 'calendar'
  size?: number
}>()
</script>

<template>
  <svg
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'home'"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" /></template>
    <template v-else-if="name === 'library'"
      ><path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-.8 2.6 15.3-3.5.8z"
    /></template>
    <template v-else-if="name === 'search'"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></template>
    <template v-else-if="name === 'back'"><path d="M15 5 8 12l7 7" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'more'"
      ><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2"
    /></template>
    <template v-else-if="name === 'close'"><path d="M6 6l12 12M18 6 6 18" /></template>
    <template v-else-if="name === 'check'"><path d="m5 12.5 4.5 4.5L19 7" /></template>
    <template v-else-if="name === 'drag'"><path d="M5 9h14M5 15h14" /></template>
    <template v-else-if="name === 'chevron'"><path d="m9 5 7 7-7 7" /></template>
    <template v-else-if="name === 'calendar'"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></template>
  </svg>
</template>

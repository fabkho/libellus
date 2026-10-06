<script setup lang="ts">
// The reader's icons, drawn on UiIcon's grid (24 units, hairline round
// strokes, currentColor). In production they join UiIcon: read (an open book),
// contents, and the type sheet's small diagrams.
export type ProtoIconName =
  | 'read'
  | 'contents'
  | 'leading0'
  | 'leading1'
  | 'leading2'
  | 'leading3'
  | 'margins0'
  | 'margins1'
  | 'margins2'
  | 'margins3'
  | 'minus'
  | 'plus'
  | 'awake'
  | 'justify'
  | 'translate'
  | 'define'
  | 'copy'
  | 'search'
  | 'pages'
  | 'scroll'

withDefaults(defineProps<{ name: ProtoIconName; size?: number }>(), { size: 22 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'read'">
      <path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.75v13.5c3.6-.15 6.2.45 8 1.75 1.8-1.3 4.4-1.9 8-1.75V4.75c-3.6-.15-6.2.45-8 1.75Z" />
      <path d="M12 6.5V20" />
    </template>
    <template v-else-if="name === 'contents'">
      <path d="M9 7h11M9 12h11M9 17h11" />
      <circle cx="4.75" cy="7" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="17" r=".9" fill="currentColor" stroke="none" />
    </template>
    <path v-else-if="name === 'leading0'" d="M5 8.5h14M5 11h14M5 13.5h14M5 16h9" />
    <path v-else-if="name === 'leading1'" d="M5 7h14M5 10.5h14M5 14h14M5 17.5h9" />
    <path v-else-if="name === 'leading2'" d="M5 5.5h14M5 10h14M5 14.5h14M5 19h9" />
    <path v-else-if="name === 'leading3'" d="M5 4h14M5 9.5h14M5 15h14M5 20.5h9" />
    <template v-else-if="name.startsWith('margins')">
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path v-if="name === 'margins0'" d="M5.5 7h13M5.5 10h13M5.5 13h13M5.5 16h13M5.5 19h8" />
      <path v-else-if="name === 'margins1'" d="M7 8h10M7 11h10M7 14h10M7 17h6" />
      <path v-else-if="name === 'margins2'" d="M8.5 8h7M8.5 11h7M8.5 14h7M8.5 17h4" />
      <path v-else d="M10 8h4M10 11h4M10 14h4M10 17h2.5" />
    </template>
    <path v-else-if="name === 'minus'" d="M6 12h12" />
    <path v-else-if="name === 'plus'" d="M12 6v12M6 12h12" />
    <template v-else-if="name === 'awake'">
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M12 8.5v3l2 1.5" />
    </template>
    <path v-else-if="name === 'justify'" d="M5 7h14M5 11h14M5 15h14M5 19h14" />
    <template v-else-if="name === 'translate'">
      <path d="M3.5 5.5h9M8 4v1.5M10.5 5.5c-.6 3.4-3 6.3-6.5 7.8M6 8.6c1 1.9 2.7 3.5 4.8 4.4" />
      <path d="M12.5 20l3.75-9 3.75 9M13.9 16.8h4.7" />
    </template>
    <template v-else-if="name === 'define'">
      <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
      <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18M9 8.5h5" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </template>
    <template v-else-if="name === 'pages'">
      <path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.75v13.5c3.6-.15 6.2.45 8 1.75 1.8-1.3 4.4-1.9 8-1.75V4.75c-3.6-.15-6.2.45-8 1.75Z" />
      <path d="M12 6.5V20" />
    </template>
    <template v-else-if="name === 'scroll'">
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9 8h6M9 11h6M9 14h6M9 17h3.5" />
    </template>
  </svg>
</template>

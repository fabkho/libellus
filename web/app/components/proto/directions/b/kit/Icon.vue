<script setup lang="ts">
// Direction b's icons: fine engraved-looking strokes on a 24 px grid, square
// caps, no fills, so they sit next to a text serif like printer's marks.
import type { IconName } from './type'

withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), { size: 22, stroke: 1.4 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
    class="b-icon"
  >
    <!-- Home: a folded broadsheet. -->
    <template v-if="name === 'home'">
      <path d="M4.5 5.5h12v13.5h-12z" />
      <path d="M16.5 8.5h3V17a2 2 0 0 1-2 2h-1" />
      <path d="M7 9h7M7 12h7M7 15h4.5" />
    </template>
    <!-- Library: three spines and a leaning fourth. -->
    <template v-else-if="name === 'library'">
      <path d="M4.5 4.5h3.5v15H4.5zM8 6.5h3.5v13H8z" />
      <path d="m13.2 6.9 3.4-.9 3.7 13.6-3.4.9z" />
      <path d="M4.5 7.5h3.5M8 9h3.5" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </template>
    <template v-else-if="name === 'back'"><path d="M14.5 5.5 8 12l6.5 6.5" /></template>
    <template v-else-if="name === 'chevron'"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></template>
    <template v-else-if="name === 'arrow'"><path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'more'">
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'close'"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></template>
    <template v-else-if="name === 'check'"><path d="m5.5 12.5 4 4 9-9.5" /></template>
    <template v-else-if="name === 'drag'"><path d="M5 8.5h14M5 12h14M5 15.5h14" /></template>
    <template v-else-if="name === 'calendar'">
      <path d="M4.5 6h15v13.5h-15zM4.5 10h15M8.5 3.5V7M15.5 3.5V7" />
    </template>
    <template v-else-if="name === 'lock'">
      <path d="M6 11h12v8.5H6z" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </template>
    <template v-else-if="name === 'pen'"><path d="m14.5 5.5 4 4L9 19H5v-4z" /></template>
    <template v-else-if="name === 'trash'">
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 10.5v6M13.5 10.5v6" />
    </template>
    <template v-else-if="name === 'mail'">
      <path d="M4 6.5h16v11H4z" />
      <path d="m4 6.5 8 6.5 8-6.5" />
    </template>
  </svg>
</template>

<style scoped>
.b-icon {
  flex-shrink: 0;
  display: block;
}
</style>

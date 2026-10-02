<script setup lang="ts">
// One icon set for the whole direction: 24 px grid, 1.7 stroke, round caps,
// drawn to sit next to Inter. `filled` gives the solid variant a selected tab
// uses (home, library, search only).
export type IconName =
  | 'home'
  | 'library'
  | 'search'
  | 'back'
  | 'plus'
  | 'more'
  | 'close'
  | 'check'
  | 'grip'
  | 'chevron'
  | 'calendar'
  | 'share'
  | 'stack'
  | 'pencil'
  | 'trash'
  | 'reorder'
  | 'again'
  | 'flag'
  | 'mail'
  | 'bookmark'
  | 'lock'
  | 'globe'
  | 'mic'
  | 'shift'
  | 'delete'
  | 'clear'
  | 'book'
  | 'spark'

withDefaults(defineProps<{ name: IconName; size?: number; filled?: boolean; stroke?: number }>(), {
  size: 22,
  filled: false,
  stroke: 1.7,
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="a-icon"
  >
    <template v-if="name === 'home'">
      <path
        d="M4.5 10.4 11.1 4.6a1.4 1.4 0 0 1 1.8 0l6.6 5.8c.3.3.5.7.5 1.1v7.2a1.3 1.3 0 0 1-1.3 1.3h-3.4v-5.2a1 1 0 0 0-1-1h-4.6a1 1 0 0 0-1 1V20H5.3A1.3 1.3 0 0 1 4 18.7v-7.2c0-.4.2-.8.5-1.1Z"
        :fill="filled ? 'currentColor' : 'none'"
      />
    </template>
    <template v-else-if="name === 'library'">
      <rect x="3.6" y="4" width="4.4" height="16" rx="1.2" :fill="filled ? 'currentColor' : 'none'" />
      <rect x="9.6" y="6.5" width="4.4" height="13.5" rx="1.2" :fill="filled ? 'currentColor' : 'none'" />
      <rect
        x="15"
        y="5.6"
        width="4.4"
        height="14.4"
        rx="1.2"
        transform="rotate(12 17.2 20)"
        :fill="filled ? 'currentColor' : 'none'"
      />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="6.3" :stroke-width="filled ? stroke + 0.6 : stroke" />
      <path d="m15.6 15.6 4.6 4.6" :stroke-width="filled ? stroke + 0.6 : stroke" />
    </template>
    <template v-else-if="name === 'back'"><path d="M14.8 5.2 8 12l6.8 6.8" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5.2v13.6M5.2 12h13.6" /></template>
    <template v-else-if="name === 'more'">
      <circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'close'"><path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" /></template>
    <template v-else-if="name === 'check'"><path d="m5.4 12.6 4.2 4.2 9-9.6" /></template>
    <template v-else-if="name === 'grip'"><path d="M5 8.5h14M5 12h14M5 15.5h14" /></template>
    <template v-else-if="name === 'chevron'"><path d="m9.5 5.8 6.2 6.2-6.2 6.2" /></template>
    <template v-else-if="name === 'calendar'">
      <rect x="4" y="5.2" width="16" height="14.8" rx="3" />
      <path d="M4 9.8h16M8.6 3.4v3.4M15.4 3.4v3.4" />
    </template>
    <template v-else-if="name === 'share'">
      <path d="M12 3.6v11M8.2 7.2 12 3.4l3.8 3.8" />
      <path d="M8 10.4H6.8a1.8 1.8 0 0 0-1.8 1.8v6.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.2a1.8 1.8 0 0 0-1.8-1.8H16" />
    </template>
    <template v-else-if="name === 'stack'">
      <rect x="7.6" y="3.6" width="12" height="13" rx="2.2" />
      <path d="M4.4 7.4v10.2a2.8 2.8 0 0 0 2.8 2.8h9.4" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path d="M14.6 5.6 18.4 9.4M4.8 19.2l.9-4 10.2-10.2a1.9 1.9 0 0 1 2.7 0l.6.6a1.9 1.9 0 0 1 0 2.7L9 18.5l-4.2.7Z" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4.6 6.6h14.8M9.6 6.4V5a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v1.4" />
      <path d="m6.4 6.8.9 11.6a1.8 1.8 0 0 0 1.8 1.6h5.8a1.8 1.8 0 0 0 1.8-1.6l.9-11.6M10.2 10.6v5.6M13.8 10.6v5.6" />
    </template>
    <template v-else-if="name === 'reorder'">
      <path d="M8 19V5M4.6 8.4 8 5l3.4 3.4M16 5v14M12.6 15.6 16 19l3.4-3.4" />
    </template>
    <template v-else-if="name === 'again'">
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.6 4.4v4.2h-4.2" />
    </template>
    <template v-else-if="name === 'flag'">
      <path d="M5.6 20.4V4.4M5.6 4.8c3.6-1.8 6.2 1.8 12.4 0v8.6c-6.2 1.8-8.8-1.8-12.4 0" />
    </template>
    <template v-else-if="name === 'mail'">
      <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="3" />
      <path d="m4.4 7.4 6.6 5a1.7 1.7 0 0 0 2 0l6.6-5" />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M6.8 4.4h10.4a.8.8 0 0 1 .8.8v15l-6-4-6 4v-15a.8.8 0 0 1 .8-.8Z" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10.4" width="14" height="9.8" rx="2.6" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.4 2.4 3.4 5.2 3.4 8.2s-1 5.8-3.4 8.2c-2.4-2.4-3.4-5.2-3.4-8.2s1-5.8 3.4-8.2Z" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="3.4" width="6" height="11" rx="3" />
      <path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6v3" />
    </template>
    <template v-else-if="name === 'shift'">
      <path d="M12 4.6 4.6 12.4h4v6.4h6.8v-6.4h4Z" />
    </template>
    <template v-else-if="name === 'delete'">
      <path d="M9 5.6h10a1.6 1.6 0 0 1 1.6 1.6v9.6a1.6 1.6 0 0 1-1.6 1.6H9L3.4 12Z" />
      <path d="m11.4 9.6 4.8 4.8M16.2 9.6l-4.8 4.8" />
    </template>
    <template v-else-if="name === 'clear'">
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="m9 9 6 6M15 9l-6 6" stroke="var(--a-clear-x, #fff)" stroke-width="1.8" />
    </template>
    <template v-else-if="name === 'book'">
      <path d="M12 6.6c-1.8-1.5-4.4-2.2-7.8-2.2v13.8c3.4 0 6 .7 7.8 2.2 1.8-1.5 4.4-2.2 7.8-2.2V4.4c-3.4 0-6 .7-7.8 2.2Z" />
      <path d="M12 6.6v13.8" />
    </template>
    <template v-else-if="name === 'spark'">
      <path d="M12 3.6c.5 4.4 4 7.9 8.4 8.4-4.4.5-7.9 4-8.4 8.4-.5-4.4-4-7.9-8.4-8.4 4.4-.5 7.9-4 8.4-8.4Z" />
    </template>
  </svg>
</template>

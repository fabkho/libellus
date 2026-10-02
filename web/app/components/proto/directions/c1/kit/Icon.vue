<script setup lang="ts">
// Shelf icon set, calmer: 1.75px strokes, round joins, 24px grid, drawn for this
// direction. `filled` gives the solid variant (active tab).
defineProps<{
  name:
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
    | 'bookmark'
    | 'stamp'
    | 'lock'
    | 'mail'
    | 'open-book'
    | 'pencil'
    | 'tag'
    | 'flag'
    | 'repeat'
    | 'globe'
    | 'mic'
    | 'shift'
    | 'delete'
  size?: number
  filled?: boolean
}>()
</script>

<template>
  <svg
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'home'">
      <path
        d="M4 10.6 11 4.7a1.6 1.6 0 0 1 2 0l7 5.9V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.2H5.5A1.5 1.5 0 0 1 4 19z"
        :fill="filled ? 'currentColor' : 'none'"
      />
    </template>
    <template v-else-if="name === 'library'">
      <rect x="3.5" y="4" width="4.5" height="16" rx="1.2" :fill="filled ? 'currentColor' : 'none'" />
      <rect x="9.5" y="6.5" width="4" height="13.5" rx="1.2" :fill="filled ? 'currentColor' : 'none'" />
      <rect
        x="15.2"
        y="5.6"
        width="4"
        height="14.6"
        rx="1.2"
        transform="rotate(-14 17.2 12.9)"
        :fill="filled ? 'currentColor' : 'none'"
      />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="6.3" :fill="filled ? 'currentColor' : 'none'" :fill-opacity="filled ? 0.18 : 0" />
      <path d="m15.6 15.6 4.6 4.6" :stroke-width="filled ? 2.6 : 2" />
    </template>
    <template v-else-if="name === 'back'"><path d="M14.5 5.5 8 12l6.5 6.5" stroke-width="2.4" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5.5v13M5.5 12h13" stroke-width="2.4" /></template>
    <template v-else-if="name === 'more'">
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'close'"><path d="M7 7l10 10M17 7 7 17" stroke-width="2.4" /></template>
    <template v-else-if="name === 'check'"><path d="m5.5 12.5 4 4L18.5 7.5" stroke-width="2.6" /></template>
    <template v-else-if="name === 'grip'">
      <circle cx="9" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'chevron'"><path d="m9.5 6 6 6-6 6" stroke-width="2.4" /></template>
    <template v-else-if="name === 'calendar'">
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
      <circle cx="9" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4.2-6 4.2v-16a1 1 0 0 1 1-1z" :fill="filled ? 'currentColor' : 'none'" />
    </template>
    <template v-else-if="name === 'stamp'">
      <path d="M9.5 3.8h5a1 1 0 0 1 1 1.2l-.9 5.3h-5.2L8.5 5a1 1 0 0 1 1-1.2z" :fill="filled ? 'currentColor' : 'none'" />
      <path d="M5 13.3a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2.2H5zM5.5 19.5h13" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10.5" width="14" height="10" rx="2.6" :fill="filled ? 'currentColor' : 'none'" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </template>
    <template v-else-if="name === 'mail'">
      <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
      <path d="m4.5 7.5 6.3 4.8a2 2 0 0 0 2.4 0l6.3-4.8" />
    </template>
    <template v-else-if="name === 'open-book'">
      <path d="M12 7.2C10 5.6 7.4 5 4 5.2v12.6c3.4-.2 6 .4 8 2 2-1.6 4.6-2.2 8-2V5.2c-3.4-.2-6 .4-8 2z" />
      <path d="M12 7.2v12.6" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path d="M15.2 5.3a2 2 0 0 1 2.9 0l.6.6a2 2 0 0 1 0 2.9L9 18.5l-4 1 1-4z" />
      <path d="m13.5 7 3.5 3.5" />
    </template>
    <template v-else-if="name === 'tag'">
      <path d="M4 5.5v5.2a2 2 0 0 0 .6 1.4l7.3 7.3a2 2 0 0 0 2.8 0l5-5a2 2 0 0 0 0-2.8L12.4 4.3A2 2 0 0 0 11 3.7H5.8A1.8 1.8 0 0 0 4 5.5z" />
      <circle cx="8.3" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'flag'">
      <path d="M6 20.5V4.5M6 5h10.5l-2.3 3.7 2.3 3.8H6" />
    </template>
    <template v-else-if="name === 'repeat'">
      <path d="M17.5 9.5A6 6 0 0 0 6.2 9M6.5 14.5a6 6 0 0 0 11.3.5" />
      <path d="M17.8 5.5v4h-4M6.2 18.5v-4h4" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="8" stroke-width="1.6" />
      <path d="M4 12h16M12 4c2.4 2.4 2.4 13.6 0 16M12 4c-2.4 2.4-2.4 13.6 0 16" stroke-width="1.6" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="3.5" width="6" height="11" rx="3" stroke-width="1.6" />
      <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" stroke-width="1.6" />
    </template>
    <template v-else-if="name === 'shift'">
      <path d="M12 4.5 4.5 12.5H9v6.5h6v-6.5h4.5z" stroke-width="1.6" />
    </template>
    <template v-else-if="name === 'delete'">
      <path d="M9 6h10.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-6-6z" stroke-width="1.6" />
      <path d="m12 9.5 5 5M17 9.5l-5 5" stroke-width="1.6" />
    </template>
  </svg>
</template>

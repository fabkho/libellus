<script lang="ts">
/** Every icon Libellus draws (docs/DESIGN.md, Icons). */
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
  | 'down'
  | 'calendar'
  | 'lock'
  | 'mail'
  | 'repeat'
  | 'slash'
  | 'stack'
  | 'globe'
  | 'pencil'
  | 'flag'
  | 'arrow'
  | 'sun'
  | 'moon'
  | 'signOut'
</script>

<script setup lang="ts">
// The icon set: a 24-unit grid, hairline strokes with round caps, stroke =
// currentColor, so an icon takes the colour of its text. Decorative: the
// control around it carries the label. `bold` is the active tab's weight.
withDefaults(defineProps<{ name: IconName; size?: number; bold?: boolean }>(), { size: 22, bold: false })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
    :style="{ strokeWidth: bold ? 'var(--stroke-icon-bold)' : 'var(--stroke-icon)' }"
  >
    <template v-if="name === 'home'">
      <path d="M4.5 10.2 12 4l7.5 6.2V19a1 1 0 0 1-1 1h-4v-5.5h-5V20h-4a1 1 0 0 1-1-1z" />
    </template>
    <template v-else-if="name === 'library'">
      <path d="M5 4.5h3.2v15H5zM10.2 4.5h3.2v15h-3.2z" />
      <path d="m15.4 6.1 3.1-.8 3 13.6-3.1.8z" />
    </template>
    <template v-else-if="name === 'search'"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.5 4.5" /></template>
    <template v-else-if="name === 'back'"><path d="M14.5 5.5 8 12l6.5 6.5" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5.5v13M5.5 12h13" /></template>
    <template v-else-if="name === 'more'">
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'close'"><path d="m7 7 10 10M17 7 7 17" /></template>
    <template v-else-if="name === 'check'"><path d="m5.5 12.5 4 4L18.5 7.5" /></template>
    <template v-else-if="name === 'grip'"><path d="M6 9h12M6 12h12M6 15h12" /></template>
    <template v-else-if="name === 'chevron'"><path d="m9.5 6 6 6-6 6" /></template>
    <template v-else-if="name === 'down'"><path d="m7 10 5 5 5-5" /></template>
    <template v-else-if="name === 'calendar'">
      <rect x="4.5" y="5.5" width="15" height="14" rx="2" /><path d="M4.5 10h15M9 3.5v4M15 3.5v4" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </template>
    <template v-else-if="name === 'mail'">
      <rect x="3.5" y="6" width="17" height="12.5" rx="2" /><path d="m4.5 7.5 7.5 6 7.5-6" />
    </template>
    <template v-else-if="name === 'repeat'">
      <path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18m-2.5-2.5L18 7l-2.5 2.5" />
      <path d="M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6m2.5 2.5L6 17l2.5-2.5" />
    </template>
    <template v-else-if="name === 'slash'"><circle cx="12" cy="12" r="7.5" /><path d="m6.8 17.2 10.4-10.4" /></template>
    <template v-else-if="name === 'stack'">
      <rect x="4" y="7" width="10" height="13" rx="1.2" /><path d="M8 4.5h8.8A1.2 1.2 0 0 1 18 5.7V17" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.3 2.4 3.3 5 3.3 8s-1 5.6-3.3 8c-2.3-2.4-3.3-5-3.3-8s1-5.6 3.3-8z" />
    </template>
    <template v-else-if="name === 'pencil'"><path d="M15 5.5 18.5 9 9 18.5H5.5V15z" /></template>
    <template v-else-if="name === 'flag'"><path d="M6 20.5V4.5M6 5h11l-2.5 4 2.5 4H6" /></template>
    <template v-else-if="name === 'arrow'"><path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" /></template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M6 18l1.3-1.3M16.7 7.3 18 6" />
    </template>
    <template v-else-if="name === 'moon'"><path d="M19 14.6A7.5 7.5 0 0 1 9.4 5 7.5 7.5 0 1 0 19 14.6z" /></template>
    <template v-else-if="name === 'signOut'">
      <path d="M13.5 4.5h-7a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h7" /><path d="M10.5 12h9m-3-3 3 3-3 3" />
    </template>
  </svg>
</template>

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
  | 'trash'
  | 'offline'
  | 'sync'
  | 'import'
  | 'camera'
  | 'torch'
  | 'ebook'
  | 'read'
  | 'contents'
  | 'translate'
  | 'define'
  | 'copy'
  | 'leading0'
  | 'leading1'
  | 'leading2'
  | 'leading3'
  | 'margins0'
  | 'margins1'
  | 'margins2'
  | 'margins3'
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
    <template v-else-if="name === 'offline'">
      <path d="M7 18h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.8 10.03 4 4 0 0 0 7 18z" /><path d="m4.5 4.5 15 15" />
    </template>
    <template v-else-if="name === 'sync'">
      <path d="M7 18h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.8 10.03 4 4 0 0 0 7 18z" /><path d="M12 15.5v-5m-2 2 2-2 2 2" />
    </template>
    <template v-else-if="name === 'import'">
      <path d="M12 4.5v10m-3.5-3.5 3.5 3.5 3.5-3.5" /><path d="M5 14.5v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
    </template>
    <template v-else-if="name === 'camera'">
      <path d="M4.5 8.5A1.5 1.5 0 0 1 6 7h2l1.3-2h5.4L16 7h2a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 18 18.5H6A1.5 1.5 0 0 1 4.5 17z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </template>
    <template v-else-if="name === 'torch'"><path d="M13.2 3.5 6.5 13.2h4.8l-.5 7.3 6.7-9.7h-4.8z" /></template>
    <template v-else-if="name === 'trash'">
      <path d="M5 7h14M9.5 7V5.2a.7.7 0 0 1 .7-.7h3.6a.7.7 0 0 1 .7.7V7" /><path d="M6.8 7l.7 11.3a1.2 1.2 0 0 0 1.2 1.2h6.6a1.2 1.2 0 0 0 1.2-1.2L17.2 7M10 10.5v5.5M14 10.5v5.5" />
    </template>
    <!-- An ebook on the device (#131): a reader's screen with a page of lines. -->
    <template v-else-if="name === 'ebook'">
      <rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M9 8h6M9 11h6M9 14h3.5" />
    </template>
    <!-- The reader (#131 phase 2). An open book: Read now, the pages layout. -->
    <template v-else-if="name === 'read'">
      <path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.75v13.5c3.6-.15 6.2.45 8 1.75 1.8-1.3 4.4-1.9 8-1.75V4.75c-3.6-.15-6.2.45-8 1.75Z" /><path d="M12 6.5V20" />
    </template>
    <!-- Contents: a list with its bullets. -->
    <template v-else-if="name === 'contents'">
      <path d="M9 7h11M9 12h11M9 17h11" />
      <circle cx="4.75" cy="7" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="17" r=".9" fill="currentColor" stroke="none" />
    </template>
    <!-- Translate: a character and a letter A. -->
    <template v-else-if="name === 'translate'">
      <path d="M3.5 5.5h9M8 4v1.5M10.5 5.5c-.6 3.4-3 6.3-6.5 7.8M6 8.6c1 1.9 2.7 3.5 4.8 4.4" /><path d="M12.5 20l3.75-9 3.75 9M13.9 16.8h4.7" />
    </template>
    <!-- Define: a dictionary. -->
    <template v-else-if="name === 'define'">
      <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" /><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18M9 8.5h5" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </template>
    <!-- Line spacing, tight to airy: four lines of text set closer or further apart. -->
    <path v-else-if="name === 'leading0'" d="M5 8.5h14M5 11h14M5 13.5h14M5 16h9" />
    <path v-else-if="name === 'leading1'" d="M5 7h14M5 10.5h14M5 14h14M5 17.5h9" />
    <path v-else-if="name === 'leading2'" d="M5 5.5h14M5 10h14M5 14.5h14M5 19h9" />
    <path v-else-if="name === 'leading3'" d="M5 4h14M5 9.5h14M5 15h14M5 20.5h9" />
    <!-- Margins, edge to edge to wide: a page with its text set wider or narrower. -->
    <template v-else-if="name.startsWith('margins')">
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path v-if="name === 'margins0'" d="M5.5 7h13M5.5 10h13M5.5 13h13M5.5 16h13M5.5 19h8" />
      <path v-else-if="name === 'margins1'" d="M7 8h10M7 11h10M7 14h10M7 17h6" />
      <path v-else-if="name === 'margins2'" d="M8.5 8h7M8.5 11h7M8.5 14h7M8.5 17h4" />
      <path v-else d="M10 8h4M10 11h4M10 14h4M10 17h2.5" />
    </template>
    <template v-else-if="name === 'signOut'">
      <path d="M13.5 4.5h-7a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h7" /><path d="M10.5 12h9m-3-3 3 3-3 3" />
    </template>
  </svg>
</template>

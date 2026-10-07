<script setup lang="ts">
// The layout of a public reading page and its Book cards (issue #171): no tab bar, no sheets, no
// chrome, only the layers a cover flies in (components/shell/BookFlight.vue). A cover tapped on the
// page flies into its card's hero and back on Back, the way a book's cover does in the app
// (composables/useBookFlight.ts, docs/MOTION.md, Push to a book). The layers live here, not in the two
// pages, so they stay installed while one page replaces the other.
</script>

<template>
  <div>
    <slot />
    <ShellBookFlight />
  </div>
</template>

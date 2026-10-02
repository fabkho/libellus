<script setup lang="ts">
// Inset grouped rows, iOS style: a quiet fill with a hairline edge; the rows
// inside draw their own inset dividers (Row.vue). Forms in sheets, the avatar
// menu, settings-like lists.
</script>

<template>
  <div class="overflow-hidden rounded-md bg-fill edge-faint">
    <slot />
  </div>
</template>

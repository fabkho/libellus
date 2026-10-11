<script setup lang="ts">
// The one quiet message of the social pages (social v1.1): a centred title and/or line and, in the slot,
// the one way on (Try again, Home). People's empty lists and load errors, a member's page and her year
// page when she is missing or could not be read, and a follow link that is dead all say it here, so
// they are spaced alike. Copy is the caller's. `heading`: the note names the page, so its title (else its
// line) is the page's h1; the other pages have theirs already and this draws a plain paragraph.
// Attributes (`data-testid`, `role`) land on the root.
const props = defineProps<{ title?: string; text?: string; heading?: boolean }>()
const titleIsHeading = computed(() => props.heading && !!props.title)
</script>

<template>
  <div class="relative flex flex-col items-center gap-xs px-xl py-xl text-center">
    <component :is="titleIsHeading ? 'h1' : 'p'" v-if="title" class="book-title text-callout">{{ title }}</component>
    <component :is="heading && !title ? 'h1' : 'p'" v-if="text" class="text-subhead font-normal text-ink-muted">{{ text }}</component>
    <div v-if="$slots.default" class="mt-ms flex flex-col items-center empty:hidden">
      <slot />
    </div>
  </div>
</template>

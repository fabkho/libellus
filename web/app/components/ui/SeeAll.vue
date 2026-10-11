<script setup lang="ts">
// The control at the right of a section's head that opens the rest of it: "See all 11 ›", "2026 in review ›". One
// look for the whole app (the pill of Home's Next in your series was the reference): a hairline-edged pill,
// `buttonSm` high, footnote text in the muted ink, the chevron after the text, 44 px to touch (an invisible box
// as wide and tall as `--size-touch` at least, centred on it, as every control smaller than a finger).
// A button, which opens a sheet (`dialog`: it says so to a screen reader, `aria-haspopup="dialog"`), or, with `to`,
// a link to a page. The label is the slot (a count is part of it, in the same type as the words: the pill does not
// set numbers in mono); a longer name for a screen reader is the `aria-label` attribute, and `data-testid`, `@click`
// and the rest go to the element. For a section head only: not a list row, and not the end card of a sideways row.
// Props: `to` (a page), `dialog` (opens a sheet).
import type { RouteLocationRaw } from 'vue-router'

withDefaults(defineProps<{ to?: RouteLocationRaw; dialog?: boolean }>(), { to: undefined, dialog: false })
</script>

<template>
  <NuxtLink v-if="to" :to="to" class="see-all relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xxs rounded-pill pr-sm pl-md text-footnote whitespace-nowrap text-ink-muted edge hover:bg-fill">
    <slot /><UiIcon name="chevron" :size="13" />
  </NuxtLink>
  <button
    v-else
    type="button"
    class="see-all relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xxs rounded-pill pr-sm pl-md text-footnote whitespace-nowrap text-ink-muted edge hover:bg-fill"
    :aria-haspopup="dialog ? 'dialog' : undefined"
  >
    <slot /><UiIcon name="chevron" :size="13" />
  </button>
</template>

<style scoped>
/* The 44 px target: an invisible box as wide and tall as --size-touch at least, centred on the pill. */
.see-all::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max(100%, var(--size-touch));
  height: var(--size-touch);
  content: '';
  transform: translate(-50%, -50%);
}
</style>

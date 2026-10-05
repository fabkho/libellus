<script setup lang="ts">
// The top of a pushed screen (book detail, a collection): round glass buttons
// that float over the cover's light — back on the left, actions on the right
// (slot `trailing`, use UiRoundButton) — and an optional small centred title.
// The bar is pinned under the status bar (`bar-top`: at least `barTop` off the
// top edge in a browser tab) while the page scrolls under it (an
// installed app has no edge swipe back, so back must stay in reach), centred on
// the column on a wide screen; the root keeps its place in the page, so content
// starts below it. Only the buttons take taps: the page under the rest of the
// row stays reachable.
defineProps<{ title?: string; backLabel: string; backTestid: string }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <div class="bar-top">
    <div class="h-(--size-touch)" />
    <header class="bar-top safe-x pointer-events-none fixed inset-x-0 top-0 z-30 mx-auto max-w-(--size-max-content)" data-top-bar>
      <div class="relative flex h-(--size-touch) items-center justify-between px-inset">
        <UiRoundButton class="pointer-events-auto" icon="back" :label="backLabel" :data-testid="backTestid" @click="$emit('back')" />
        <span v-if="title" class="absolute left-1/2 -translate-x-1/2 truncate text-body font-medium">{{ title }}</span>
        <span class="pointer-events-auto flex gap-sm"><slot name="trailing" /></span>
      </div>
    </header>
  </div>
</template>

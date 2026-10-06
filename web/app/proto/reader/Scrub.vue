<script setup lang="ts">
// The progress line, as a control: D's hairline (UiProgress: the lamp for what
// is read, a faint rule for the rest), 44 px of touch around it. Drag along it
// and a mono bubble says the page; let go to jump there. A small tick marks the
// page saved in Libellus. A native range input underneath, so the keyboard and
// assistive tech get a slider for free.
const props = defineProps<{ fraction: number; pages: number; saved: number | null }>()
const emit = defineEmits<{ scrub: [fraction: number] }>()

import { stepTick } from '~/utils/haptics'

const STEPS = 1000
let lastPage: number | null = null
const dragging = ref<number | null>(null)
const shown = computed(() => dragging.value ?? props.fraction)
const pageOf = (f: number) => Math.max(1, Math.round(f * props.pages))

function onInput(event: Event) {
  dragging.value = Number((event.target as HTMLInputElement).value) / STEPS
  // A light tick per page passed, as the capsule's slider (Android; iOS stays silent while dragging).
  const page = pageOf(dragging.value)
  if (lastPage !== null && page !== lastPage) stepTick(event.timeStamp)
  lastPage = page
}
function onChange(event: Event) {
  const value = Number((event.target as HTMLInputElement).value) / STEPS
  dragging.value = null
  lastPage = null
  emit('scrub', value)
}
</script>

<template>
  <div class="scrub relative h-(--size-touch) w-full" :style="{ '--f': shown, '--s': saved ?? -1 }">
    <span class="track pointer-events-none absolute inset-x-0 top-1/2 rounded-pill bg-hairline-strong" aria-hidden="true">
      <span class="fill absolute inset-y-0 left-0 rounded-pill bg-accent" />
      <span v-if="saved !== null" class="tick absolute top-1/2 bg-ink-faint" />
    </span>
    <span class="thumb pointer-events-none absolute top-1/2 rounded-pill bg-accent" :class="dragging !== null && 'on'" aria-hidden="true" />
    <span v-if="dragging !== null" class="bubble figures pointer-events-none absolute rounded-pill bg-ink px-sm text-meta text-on-ink">p. {{ pageOf(dragging) }}</span>
    <input
      type="range"
      class="absolute inset-0 size-full cursor-pointer opacity-0"
      :min="0"
      :max="STEPS"
      :value="Math.round(shown * STEPS)"
      :aria-valuetext="`Page ${pageOf(shown)} of ${pages}`"
      aria-label="Go to a place in the book"
      data-testid="reader.scrub"
      @input="onInput"
      @change="onChange"
    />
  </div>
</template>

<style scoped>
.track {
  height: var(--stroke-focus);
  transform: translateY(-50%);
}
.fill {
  width: calc(var(--f) * 100%);
}
.tick {
  left: calc(var(--s) * 100%);
  width: var(--stroke-focus);
  height: var(--spacing-sm);
  transform: translate(-50%, -50%);
  border-radius: var(--radius-pill);
}
.thumb {
  left: calc(var(--f) * 100%);
  width: var(--spacing-ms);
  height: var(--spacing-ms);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 var(--spacing-sm) color-mix(in srgb, var(--color-accent) 45%, transparent);
  transition: transform var(--duration-quick) var(--ease-standard);
}
.thumb.on {
  transform: translate(-50%, -50%) scale(1.35);
}
.bubble {
  left: calc(var(--f) * 100%);
  bottom: calc(100% - var(--spacing-xs));
  transform: translateX(-50%);
  line-height: var(--size-button-sm);
  white-space: nowrap;
}
</style>

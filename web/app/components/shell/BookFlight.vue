<script setup lang="ts">
// The layers the cover flies in when a book page is pushed and popped
// (docs/MOTION.md, Push to a book; composables/useBookFlight.ts). Mounted once
// in the tabs layout. Both are empty, fixed and take no taps; they are filled
// only while a flight runs.
// - `under`: the page being left, as a still copy, fading out over the page
//   coming in and under the chrome (scroll edge, tab bar, search);
// - `over`: the flying cover, over everything but a sheet.
const under = useTemplateRef<HTMLElement>('under')
const over = useTemplateRef<HTMLElement>('over')
const router = useRouter()

let uninstall: (() => void) | null = null
onMounted(() => {
  if (under.value && over.value) uninstall = installBookFlight(router, { under: under.value, over: over.value })
})
onUnmounted(() => uninstall?.())
</script>

<template>
  <div ref="under" class="flight-layer pointer-events-none fixed inset-0 z-5" data-flight-layer aria-hidden="true" inert data-testid="shell.flightPage" />
  <div ref="over" class="flight-layer pointer-events-none fixed inset-0 z-45" data-flight-layer aria-hidden="true" inert data-testid="shell.flight" />
</template>

<style>
/* Unscoped: the flight marks covers of other components and fills its layers by hand. */
.flight-layer {
  contain: layout paint;
}

.flight-layer:empty {
  display: none;
}

/* A flight about to start: the copy of the page being left stands in for the
   live page, which is hidden under it until the flight's own animations take
   over (in the same frame). Important, so a flight turned around in its
   place does not show the new page at the opacity it paused at. */
html[data-flight-pose] [data-flight='page'] {
  opacity: 0 !important;
}

/* A cover whose copy is in the air: it holds its place, unseen, until the copy lands on it. */
[data-flight-hidden] {
  visibility: hidden;
}

.flight-cover {
  position: fixed;
  transform-origin: 0 0;
  will-change: transform, opacity;
}

.flight-held {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.flight-copy {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>

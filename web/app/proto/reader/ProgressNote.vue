<script setup lang="ts">
// The reader wrote progress (forward only, after a rest on a page): one quiet
// line says so and goes again. a and b: the lamp dot and "p. 34 saved" in the
// bottom margin, mono and faint. c: a bookmark ribbon in the lamp colour drops
// in at the page's top edge with the page beside it, and lifts out again —
// the printed book's way of keeping a place.
const props = defineProps<{ note: { page: number; at: number } | null; variant: 'a' | 'b' | 'c'; chrome: boolean }>()

const shown = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.note?.at,
  (at) => {
    if (!at) return
    shown.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (shown.value = false), 2600)
  },
)
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <Transition :name="variant === 'c' ? 'ribbon' : 'line'">
    <div v-if="shown && variant === 'c'" class="ribbon-wrap pointer-events-none fixed z-20 flex items-start gap-sm" role="status" data-testid="reader.saved">
      <span class="figures pt-xs text-meta text-ink-faint">p. {{ note?.page }} saved</span>
      <span class="ribbon bg-accent" aria-hidden="true" />
    </div>
    <p
      v-else-if="shown && !chrome"
      class="line figures pointer-events-none fixed inset-x-0 z-20 flex items-center justify-center gap-sm text-meta text-ink-faint"
      role="status"
      data-testid="reader.saved"
    >
      <span class="lamp" aria-hidden="true" />p. {{ note?.page }} saved
    </p>
  </Transition>
</template>

<style scoped>
.line {
  bottom: calc(var(--safe-area-bottom) + var(--spacing-ms));
}
.lamp {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 45%, transparent);
}
.ribbon-wrap {
  top: 0;
  right: calc(var(--safe-area-right) + var(--spacing-xl));
}
.ribbon {
  width: var(--spacing-ms);
  height: calc(var(--safe-area-top) + var(--spacing-xl));
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - var(--spacing-xs)), 0 100%);
  box-shadow: var(--elevation-button);
}
.ribbon-wrap span:first-child {
  padding-top: calc(var(--safe-area-top) + var(--spacing-sm));
}
.line-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.line-leave-active {
  transition: opacity var(--duration-sheet-exit) var(--ease-exit);
}
.line-enter-from,
.line-leave-to {
  opacity: 0;
}
.ribbon-enter-active {
  transition:
    transform var(--duration-sheet) var(--ease-sheet),
    opacity var(--duration-standard) var(--ease-standard);
}
.ribbon-leave-active {
  transition:
    transform var(--duration-sheet-exit) var(--ease-exit),
    opacity var(--duration-sheet-exit) var(--ease-exit);
}
.ribbon-enter-from,
.ribbon-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--spacing-xl)));
}
</style>

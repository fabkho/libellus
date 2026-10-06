<script setup lang="ts">
// The switch's picture: a pill track (the lamp when on, `fillStrong` when off)
// and a knob that slides over `quick`. Presentational: the control that owns
// the state carries `role="switch"` and `aria-checked` (UiSwitchRow, or a row
// of one's own). The knob's lift is a hairline and a tight contact shadow that
// stays inside the 24 px track (the button shadow spread outside it on paper).
defineProps<{ on: boolean }>()
</script>

<template>
  <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="on ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
    <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised" :class="on && 'on'" />
  </span>
</template>

<style scoped>
.switch {
  transition: background-color var(--duration-quick) var(--ease-standard);
}
.knob {
  box-shadow:
    0 0 0 var(--stroke-hairline) color-mix(in srgb, var(--color-ink) 10%, transparent),
    0 var(--stroke-rule) var(--spacing-xxs) color-mix(in srgb, var(--color-ink) 18%, transparent);
  transition: transform var(--duration-quick) var(--ease-standard);
}
.knob.on {
  transform: translateX(calc(var(--size-switch) - var(--size-switch-thumb) - 2 * var(--spacing-xxs)));
}
</style>

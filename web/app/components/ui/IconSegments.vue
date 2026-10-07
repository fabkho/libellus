<script setup lang="ts" generic="T extends string">
// A choice of a few as one row of icon segments, in the reader's Margins / Line
// spacing style (variant D of the design round): the chosen segment unfolds its
// name beside the icon, the others stay icons. None is lit while `value` is
// null. A radiogroup named by the label element `labelledby` points at: each
// segment is a radio named by its full label, arrow keys move the choice. A tap
// says it is that one; what that does is the host's. `testid` names the group;
// each segment is `<testid>.<value>`. Used by the format of an edition
// (BookFormatChoice) and by Read as (BookReadAs).
import type { IconName } from './Icon.vue'

export interface IconSegment<V> {
  value: V
  /** What assistive tech says, and the name that unfolds beside the icon. */
  label: string
  icon: IconName
}

const props = defineProps<{
  options: readonly IconSegment<T>[]
  value: T | null
  labelledby: string
  testid: string
  required?: boolean
  invalid?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ choose: [value: T] }>()

const segments = useTemplateRef<HTMLButtonElement[]>('segments')

function choose(value: T) {
  if (!props.disabled) emit('choose', value)
}

function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step || props.disabled) return
  event.preventDefault()
  const at = Math.max(0, props.options.findIndex((o) => o.value === props.value))
  const next = (at + step + props.options.length) % props.options.length
  emit('choose', props.options[next]!.value)
  segments.value?.[next]?.focus()
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-labelledby="labelledby"
    :aria-required="required ? true : undefined"
    :aria-invalid="invalid ? true : undefined"
    :aria-disabled="disabled || undefined"
    class="flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint"
    :class="disabled && 'pointer-events-none opacity-50'"
    :data-testid="testid"
    @keydown="onKeydown"
  >
    <button
      v-for="(option, i) in options"
      :key="option.value"
      ref="segments"
      type="button"
      role="radio"
      :aria-checked="value === option.value"
      :aria-label="option.label"
      :tabindex="value === option.value || (!value && i === 0) ? 0 : -1"
      :disabled="disabled"
      class="segment flex min-w-0 items-center justify-center text-caption"
      :class="value === option.value ? 'on text-ink' : 'text-ink-muted'"
      :data-testid="`${testid}.${option.value}`"
      @click="choose(option.value)"
    >
      <UiIcon :name="option.icon" :size="20" />
      <span class="name grid" aria-hidden="true">
        <span class="min-w-0 overflow-hidden whitespace-nowrap"><span class="gap">{{ option.label }}</span></span>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* The chosen segment grows to make room and its name unfolds beside the icon (a
   grid column 0fr -> 1fr, so the width animates without measuring) while it fades
   in; the raised surface is each segment's own, fading with the growth. Corners
   concentric with the group: md less the xxs gap. Reduce Motion: main.css. */
.segment {
  flex: 1 1 0;
  border-radius: calc(var(--radius-md) - var(--spacing-xxs));
  background: transparent;
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard),
    box-shadow var(--duration-standard) var(--ease-standard),
    color var(--duration-quick) var(--ease-standard);
}
.segment.on {
  flex-grow: 2.3;
  background: var(--color-surface-raised);
  box-shadow:
    0 0 0 var(--stroke-hairline) var(--color-hairline),
    0 var(--stroke-rule) var(--spacing-xxs) color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.segment:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(-1 * var(--stroke-focus));
}
.name {
  grid-template-columns: 0fr;
  opacity: 0;
  transition:
    grid-template-columns var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.gap {
  display: block;
  padding-left: var(--spacing-xs);
}
.segment.on .name {
  grid-template-columns: 1fr;
  opacity: 1;
}
</style>

<script setup lang="ts" generic="T extends string | number">
// A choice of a few (Pages | Scroll, the margins, the line spacing): one group
// on a quiet fill with a hairline edge, the options side by side at equal
// widths, and the chosen one lit by a raised surface that slides from option
// to option over `standard` (positioned absolutely, moved by `transform` only;
// Reduce Motion: it is simply there). Its corners are concentric with the
// group's: the group's `md` less the `xxs` gap around it.
//
// A radiogroup: each option is a radio, arrow keys move the choice (and the
// focus) as the platform's own segmented controls do. Each option's face comes
// from the `option` slot ({ option, selected }); without it, its label.
// `testid` names the group; each option is `<testid>.<value>`.
export interface SegmentedOption<V> {
  value: V
  /** What assistive tech says, and the face without a slot. */
  label: string
}

const model = defineModel<T>({ required: true })
const props = defineProps<{ options: readonly SegmentedOption<T>[]; label: string; testid?: string }>()
defineSlots<{ option?: (props: { option: SegmentedOption<T>; selected: boolean }) => unknown }>()

const index = computed(() => Math.max(0, props.options.findIndex((o) => o.value === model.value)))
const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')

function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const next = (index.value + step + props.options.length) % props.options.length
  model.value = props.options[next]!.value
  buttons.value?.[next]?.focus()
}
</script>

<template>
  <div
    class="segmented relative flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint"
    role="radiogroup"
    :aria-label="label"
    :data-testid="testid"
    :style="{ '--count': options.length, '--index': index }"
    @keydown="onKeydown"
  >
    <span class="indicator pointer-events-none absolute" aria-hidden="true" />
    <button
      v-for="(option, i) in options"
      :key="String(option.value)"
      ref="buttons"
      type="button"
      role="radio"
      :aria-checked="i === index"
      :aria-label="$slots.option ? option.label : undefined"
      :tabindex="i === index ? 0 : -1"
      class="option relative flex flex-1 items-center justify-center gap-sm text-caption"
      :class="i === index ? 'text-ink' : 'text-ink-muted'"
      :data-testid="testid ? `${testid}.${option.value}` : undefined"
      @click="model = option.value"
    >
      <slot name="option" :option="option" :selected="i === index">{{ option.label }}</slot>
    </button>
  </div>
</template>

<style scoped>
/* Concentric with the group: md (14) less the xxs (2) gap around it. */
.option,
.indicator {
  border-radius: calc(var(--radius-md) - var(--spacing-xxs));
}
.option {
  transition: color var(--duration-quick) var(--ease-standard);
}
.option:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(-1 * var(--stroke-focus));
}
/* The lit surface: one option wide, moved to the chosen one by transform alone. */
.indicator {
  top: var(--spacing-xxs);
  bottom: var(--spacing-xxs);
  left: var(--spacing-xxs);
  width: calc((100% - 2 * var(--spacing-xxs)) / var(--count));
  transform: translateX(calc(var(--index) * 100%));
  background: var(--color-surface-raised);
  box-shadow:
    0 0 0 var(--stroke-hairline) var(--color-hairline),
    0 var(--stroke-rule) var(--spacing-xxs) color-mix(in srgb, var(--color-ink) 12%, transparent);
  transition: transform var(--duration-standard) var(--ease-standard);
}
</style>

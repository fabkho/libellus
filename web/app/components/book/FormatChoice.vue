<script setup lang="ts">
// An edition's format — hardcover, paperback, ebook, audiobook — as one row of
// icon segments under a small label (Change edition, "My edition isn't listed"),
// in the reader's Margins / Line spacing style. The chosen segment unfolds its
// name beside the icon; the others stay icons. None is lit while nobody knows
// the edition's format. A radiogroup: each segment is a radio named by its
// format, arrow keys move the choice. A tap says it is that format; what that
// does is the host's. `testid` names the group; each segment is `<testid>.<format>`.
import { BOOK_FORMATS, type BookFormat } from '~/data/books'

const props = defineProps<{
  value: BookFormat | null
  label: string
  testid: string
  /** Her own edition must have one: the label carries the lamp's asterisk. */
  required?: boolean
  /** Marked in the error colour (her own edition without one). */
  invalid?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ choose: [format: BookFormat] }>()

const { t } = useI18n()
const labelId = useId()
const segments = useTemplateRef<HTMLButtonElement[]>('segments')

/** An ebook is drawn as a reader with a home bar; the Reader's own `ebook` icon is a page of text. */
const icon = (format: BookFormat) => (format === 'ebook' ? 'tablet' : format)

function choose(format: BookFormat) {
  if (!props.disabled) emit('choose', format)
}

function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step || props.disabled) return
  event.preventDefault()
  const at = Math.max(0, BOOK_FORMATS.findIndex((f) => f === props.value))
  const next = (at + step + BOOK_FORMATS.length) % BOOK_FORMATS.length
  emit('choose', BOOK_FORMATS[next]!)
  segments.value?.[next]?.focus()
}
</script>

<template>
  <div>
    <p :id="labelId" class="eyebrow mx-xs mb-ms" :class="invalid && 'text-error'">
      {{ label }}<span v-if="required" class="ml-xxs text-accent-ink" aria-hidden="true">*</span>
    </p>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-required="required ? true : undefined"
      :aria-invalid="invalid ? true : undefined"
      :aria-disabled="disabled || undefined"
      class="flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint"
      :class="disabled && 'pointer-events-none opacity-50'"
      :data-testid="testid"
      @keydown="onKeydown"
    >
      <button
        v-for="format in BOOK_FORMATS"
        :key="format"
        ref="segments"
        type="button"
        role="radio"
        :aria-checked="value === format"
        :aria-label="t(`book.format.${format}`)"
        :tabindex="value === format || (!value && format === BOOK_FORMATS[0]) ? 0 : -1"
        :disabled="disabled"
        class="segment flex min-w-0 items-center justify-center text-caption"
        :class="value === format ? 'on text-ink' : 'text-ink-muted'"
        :data-testid="`${testid}.${format}`"
        @click="choose(format)"
      >
        <UiIcon :name="icon(format)" :size="20" />
        <span class="name grid" aria-hidden="true">
          <span class="min-w-0 overflow-hidden whitespace-nowrap"><span class="gap">{{ t(`book.format.${format}`) }}</span></span>
        </span>
      </button>
    </div>
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

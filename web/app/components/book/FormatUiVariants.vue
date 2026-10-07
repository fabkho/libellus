<script setup lang="ts">
// DESIGN ROUND (proto/format-pills), dev only: three one-row looks for the format choice.
//   a  icon segments (the reader's Margins row), the chosen format's name as a caption
//   b  text segments (Hardcover · Paperback · Ebook · Audio)
//   d  a, but the chosen segment opens to show its name beside the icon; the others stay icons
//   c  a compact "Format  ▭ Paperback ⌄" row that opens a small menu
// Same contract as FormatChoice: a radio group, a tap says `choose`, `testid.<format>` per option.
import { BOOK_FORMATS, type BookFormat } from '~/data/books'
import type { FormatUi } from '~/composables/useFormatUi'

const props = defineProps<{
  variant: Exclude<FormatUi, 'pills'>
  value: BookFormat | null
  label: string
  testid: string
  required?: boolean
  invalid?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ choose: [format: BookFormat] }>()

const { t } = useI18n()
const labelId = useId()
/** An ebook is drawn as a tablet: the reader's own `ebook` icon is a page of text. */
const icon = (format: BookFormat) => (format === 'ebook' ? 'tablet' : format)

const options = computed(() => BOOK_FORMATS.map((format) => ({ value: format, label: t(`book.format.${format}`) })))
/** Segmented's model: '' while nobody knows the format (nothing lit). */
const model = computed({
  get: () => props.value ?? '',
  set: (format: BookFormat | '') => {
    if (format && !props.disabled) emit('choose', format)
  },
})
const segments = computed(() => options.value as { value: BookFormat | ''; label: string }[])
const name = computed(() => (props.value ? t(`book.format.${props.value}`) : t('book.edition.formatNone')))

// d: the row of icons, the chosen one carrying its name
const stops = useTemplateRef<HTMLButtonElement[]>('stops')
function onStopKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step || props.disabled) return
  event.preventDefault()
  const at = Math.max(0, BOOK_FORMATS.findIndex((f) => f === props.value))
  const next = (at + step + BOOK_FORMATS.length) % BOOK_FORMATS.length
  emit('choose', BOOK_FORMATS[next]!)
  stops.value?.[next]?.focus()
}

// c: the menu
const menuOpen = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const items = useTemplateRef<HTMLButtonElement[]>('items')

function openMenu() {
  if (props.disabled) return
  menuOpen.value = true
  void nextTick(() => {
    const at = Math.max(0, BOOK_FORMATS.findIndex((f) => f === props.value))
    items.value?.[at]?.focus()
  })
}
function closeMenu(refocus = true) {
  menuOpen.value = false
  if (refocus) trigger.value?.focus()
}
function pick(format: BookFormat) {
  emit('choose', format)
  closeMenu()
}
function onMenuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeMenu()
    return
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const list = items.value ?? []
  const at = list.findIndex((el) => el === document.activeElement)
  list[(at + step + list.length) % list.length]?.focus()
}
function onOutside(event: Event) {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) closeMenu(false)
}
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <!-- a, b -->
  <div v-if="variant === 'a' || variant === 'b'" :class="disabled && 'pointer-events-none opacity-50'" :aria-disabled="disabled || undefined">
    <p :id="labelId" class="eyebrow mx-xs mb-ms" :class="invalid && 'text-error'">
      {{ label }}<span v-if="required" class="ml-xxs text-accent-ink" aria-hidden="true">*</span>
    </p>
    <UiSegmented v-model="model" :options="segments" :label="label" :testid="testid">
      <template #option="{ option }">
        <UiIcon v-if="variant === 'a'" :name="icon(option.value as BookFormat)" :size="20" />
        <template v-else>{{ t(`book.formatShort.${option.value}`) }}</template>
      </template>
    </UiSegmented>
    <p
      v-if="variant === 'a'"
      class="mx-xs mt-xs text-center text-caption"
      :class="value ? 'text-ink-muted' : 'text-ink-faint'"
      aria-live="polite"
      data-testid="formatUi.caption"
    >
      {{ name }}
    </p>
  </div>

  <!-- d -->
  <div v-else-if="variant === 'd'" :class="disabled && 'pointer-events-none opacity-50'" :aria-disabled="disabled || undefined">
    <p :id="labelId" class="eyebrow mx-xs mb-ms" :class="invalid && 'text-error'">
      {{ label }}<span v-if="required" class="ml-xxs text-accent-ink" aria-hidden="true">*</span>
    </p>
    <div class="unfold flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint" role="radiogroup" :aria-labelledby="labelId" :aria-required="required ? true : undefined" :aria-invalid="invalid ? true : undefined" :data-testid="testid" @keydown="onStopKey">
      <button
        v-for="option in options"
        :key="option.value"
        ref="stops"
        type="button"
        role="radio"
        :aria-checked="value === option.value"
        :aria-label="option.label"
        :tabindex="value === option.value || (!value && option.value === BOOK_FORMATS[0]) ? 0 : -1"
        class="stop flex min-w-0 items-center justify-center text-caption"
        :class="value === option.value ? 'on text-ink' : 'text-ink-muted'"
        :data-testid="`${testid}.${option.value}`"
        @click="emit('choose', option.value)"
      >
        <UiIcon :name="icon(option.value)" :size="20" />
        <span class="name grid" aria-hidden="true"><span class="min-w-0 overflow-hidden whitespace-nowrap"><span class="gap">{{ option.label }}</span></span></span>
      </button>
    </div>
  </div>

  <!-- c -->
  <div v-else ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      class="trigger flex h-(--size-row) w-full items-center gap-sm rounded-md bg-fill px-inset text-left edge-faint disabled:opacity-50"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :aria-label="`${label}: ${name}`"
      :disabled="disabled"
      :data-testid="testid"
      @click="menuOpen ? closeMenu() : openMenu()"
    >
      <span class="text-caption" :class="invalid ? 'text-error' : 'text-ink-muted'" aria-hidden="true">
        {{ label }}<span v-if="required" class="ml-xxs text-accent-ink">*</span>
      </span>
      <span class="ml-auto flex items-center gap-xs text-callout" :class="value ? 'text-ink' : 'text-ink-faint'" aria-hidden="true">
        <UiIcon v-if="value" :name="icon(value)" :size="20" />{{ value ? name : t('book.edition.formatChoose') }}
      </span>
      <UiIcon name="down" :size="18" class="text-ink-faint transition-transform duration-(--duration-quick) ease-standard" :class="menuOpen && 'rotate-180'" />
    </button>
    <div
      v-if="menuOpen"
      class="absolute inset-x-0 top-full z-10 mt-xxs rounded-md bg-surface-raised p-xxs shadow-float edge"
      role="menu"
      :aria-label="label"
      :data-testid="`${testid}.menu`"
      @keydown="onMenuKey"
    >
      <button
        v-for="option in options"
        :key="option.value"
        ref="items"
        type="button"
        role="menuitemradio"
        :aria-checked="value === option.value"
        class="item flex h-(--size-touch) w-full items-center gap-sm rounded-sm px-ms text-left text-callout"
        :class="value === option.value ? 'text-accent-ink' : 'text-ink'"
        :data-testid="`${testid}.${option.value}`"
        @click="pick(option.value)"
      >
        <UiIcon :name="icon(option.value)" :size="20" />
        <span class="flex-1">{{ option.label }}</span>
        <UiIcon v-if="value === option.value" name="check" :size="16" bold />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* d: the chosen stop grows to make room, its name unfolds beside the icon (a grid column 0fr -> 1fr,
   so the width is animated without measuring) and fades in; the raised surface is each stop's own,
   fading with the growth. Concentric with the group: md less the xxs gap. */
.stop {
  flex: 1 1 0;
  border-radius: calc(var(--radius-md) - var(--spacing-xxs));
  background: transparent;
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard),
    box-shadow var(--duration-standard) var(--ease-standard),
    color var(--duration-quick) var(--ease-standard);
}
.stop.on {
  flex-grow: 2.3;
  background: var(--color-surface-raised);
  box-shadow:
    0 0 0 var(--stroke-hairline) var(--color-hairline),
    0 var(--stroke-rule) var(--spacing-xxs) color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.stop:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(-1 * var(--stroke-focus));
}
.name {
  grid-template-columns: 0fr;
  opacity: 0;
  padding-left: 0;
  transition:
    grid-template-columns var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.gap {
  display: block;
  padding-left: var(--spacing-xs);
}
.stop.on .name {
  grid-template-columns: 1fr;
  opacity: 1;
}

.trigger:focus-visible,
.item:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(-1 * var(--stroke-focus));
}
.item:active {
  background: var(--color-fill);
}
</style>

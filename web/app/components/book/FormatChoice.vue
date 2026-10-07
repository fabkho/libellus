<script setup lang="ts">
// An edition's format — hardcover, paperback, ebook, audiobook — as four pills
// in two rows under a small label (Change edition, "My edition isn't listed").
// One is lit (the lamp's soft fill, its tick, the lamp's ink) or none, while
// nobody knows the edition's format. A radiogroup: each pill is a radio. A
// tap says it is that format; what that does is the host's. `testid` names the
// group; each pill is `<testid>.<format>`.
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

// DESIGN ROUND (proto/format-pills): dev only, compiled out of builds. `?formatUi=a|b|c`.
const Chips = import.meta.dev ? defineAsyncComponent(() => import('./FormatUiChips.vue')) : null
const Variants = import.meta.dev ? defineAsyncComponent(() => import('./FormatUiVariants.vue')) : null
const proto = import.meta.dev ? useFormatUi().ui : null

function choose(format: BookFormat) {
  if (!props.disabled) emit('choose', format)
}
</script>

<template>
  <div>
    <component :is="Chips" v-if="Chips" />
    <component
      :is="Variants"
      v-if="Variants && proto && proto !== 'pills'"
      :variant="proto"
      :value="value"
      :label="label"
      :testid="testid"
      :required="required"
      :invalid="invalid"
      :disabled="disabled"
      @choose="choose"
    />
    <template v-else>
    <p :id="labelId" class="eyebrow mx-xs mb-ms" :class="invalid && 'text-error'">
      {{ label }}<span v-if="required" class="ml-xxs text-accent-ink" aria-hidden="true">*</span>
    </p>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-required="required ? true : undefined"
      :aria-invalid="invalid ? true : undefined"
      class="grid grid-cols-2 gap-xs"
      :data-testid="testid"
    >
      <button
        v-for="format in BOOK_FORMATS"
        :key="format"
        type="button"
        role="radio"
        :aria-checked="value === format"
        :disabled="disabled"
        class="pill flex min-h-(--size-touch) items-center justify-center gap-xs rounded-pill px-md text-callout transition-colors duration-(--duration-quick) ease-standard disabled:opacity-50"
        :class="[value === format ? 'on bg-accent-soft text-accent-ink' : 'bg-fill text-ink-muted', invalid && value !== format && 'invalid']"
        :data-testid="`${testid}.${format}`"
        @click="choose(format)"
      >
        <UiIcon v-if="value === format" name="check" :size="14" bold />{{ t(`book.format.${format}`) }}
      </button>
    </div>
    </template>
  </div>
</template>

<style scoped>
.pill {
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}
.pill.on {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-accent);
}
.pill.invalid {
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-error);
}
</style>

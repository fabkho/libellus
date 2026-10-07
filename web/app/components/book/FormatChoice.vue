<script setup lang="ts">
// An edition's format — hardcover, paperback, ebook, audiobook — as one row of
// icon segments under a small label (Change edition, "My edition isn't listed"),
// in the reader's Margins / Line spacing style (UiIconSegments). The chosen
// segment unfolds its name beside the icon; the others stay icons. None is lit
// while nobody knows the edition's format. A radiogroup: each segment is a radio
// named by its format, arrow keys move the choice. A tap says it is that format;
// what that does is the host's. `testid` names the group; each segment is
// `<testid>.<format>`.
import { BOOK_FORMATS, type BookFormat } from '~/data/books'
import type { IconSegment } from '~/components/ui/IconSegments.vue'

defineProps<{
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

/** An ebook is drawn as a reader with a home bar; the Reader's own `ebook` icon is a page of text. */
const options = computed<IconSegment<BookFormat>[]>(() =>
  BOOK_FORMATS.map((format) => ({ value: format, label: t(`book.format.${format}`), icon: format === 'ebook' ? 'tablet' : format })),
)
</script>

<template>
  <div>
    <p :id="labelId" class="eyebrow mx-xs mb-ms" :class="invalid && 'text-error'">
      {{ label }}<span v-if="required" class="ml-xxs text-accent-ink" aria-hidden="true">*</span>
    </p>
    <UiIconSegments
      :options="options"
      :value="value"
      :labelledby="labelId"
      :required="required"
      :invalid="invalid"
      :disabled="disabled"
      :testid="testid"
      @choose="emit('choose', $event)"
    />
  </div>
</template>

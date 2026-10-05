<script setup lang="ts">
// A day in a RowGroup (D's "Finished on · Today · 3 Oct" row): the calendar
// icon, the label, the day in words, a chevron. The whole row is the
// platform's own date picker (an invisible `<input type="date">` laid over
// it), so on a phone a tap opens the native wheel or calendar. `min` and `max`
// keep impossible days out of the picker where the platform honours them; the
// sheet checks the day again either way. `v-model` is `YYYY-MM-DD`, or ''
// when the picker was cleared (`placeholder` says what an empty day means, for
// a day that is optional). The input carries `testid`.
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ label: string; testid: string; min?: string; max?: string; invalid?: boolean; placeholder?: string }>(), {
  placeholder: undefined,
  min: undefined,
  max: undefined,
  invalid: false,
})

const { t } = useI18n()
const { relativeDay } = useDays()

/** Desktop browsers open the picker only from their own icon; ask for it on any click. */
function openPicker(event: MouseEvent) {
  const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try {
    input.showPicker?.()
  } catch {
    // Not allowed here (or already open): the input still takes the click.
  }
}
</script>

<template>
  <UiRow :label="label" icon="calendar" chevron class="active:bg-fill-strong">
    <span class="figures text-caption" :class="invalid ? 'text-error' : model ? 'text-ink' : 'text-ink-ghost'">
      {{ model ? relativeDay(model) : (placeholder ?? t('common.chooseDay')) }}
    </span>
    <input
      v-model="model"
      type="date"
      class="picker"
      :min="min"
      :max="max"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      :data-testid="testid"
      @click="openPicker"
    />
  </UiRow>
</template>

<style scoped>
/* Over the whole row, invisible: the row is what shows, the input what is tapped. */
.picker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  appearance: none;
}
</style>

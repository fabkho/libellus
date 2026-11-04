<script setup lang="ts">
// The day switch of the Update progress sheet (plan docs/plans/backdated-progress.md §3.1, option B): "Today ·
// Yesterday · Pick a day…", one row of pills under the Book. Presentational: the day comes in as a prop, a choice goes
// out as an event, nothing of a store in here. The look and the targets are Pages | Percent's: drawn 32 pt, a 44 pt
// box behind each. The third pill is the platform's own date picker (the `UiDateRow` technique: an invisible
// `<input type="date">` laid over the pill, so a tap opens the native wheel or calendar; `min` is the read's start,
// `max` today), and once a day is picked it carries that day ("Fri 30 Oct"). The pills wrap rather than shrink or
// scroll at a large text size (200 %).
import { dayFromPicker, dayPillsOf } from '~/data/progressDayView'

const props = withDefaults(
  defineProps<{
    /** The day the sheet is about (`YYYY-MM-DD`); null is Today. */
    day: string | null
    /** The member's today (`YYYY-MM-DD`): what Today and Yesterday mean, and the picker's latest day. */
    today: string
    /** The earliest day the picker offers (the read's start). */
    min?: string
    disabled?: boolean
  }>(),
  { min: undefined, disabled: false },
)
const emit = defineEmits<{
  /** A day was chosen: `YYYY-MM-DD`, or null for Today. */
  choose: [day: string | null]
}>()

const { t } = useI18n()
const { weekdayDay } = useDays()

const pills = computed(() => dayPillsOf(props.day, props.today))
const pickedWords = computed(() => (pills.value.picked ? weekdayDay(pills.value.picked) : null))

/** The native picker handed back a day: Today and the days from the read's start are chosen, anything else is put back. */
function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const day = dayFromPicker(input.value, props.today, props.min)
  if (day === undefined) input.value = pills.value.picked ?? ''
  else emit('choose', day)
}

/** Desktop browsers open the picker only from their own icon; ask for it on any click (as `UiDateRow`). */
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
  <div role="group" :aria-label="t('book.progress.dayLabel')" class="flex flex-wrap gap-x-xs gap-y-ms" data-testid="progress.day">
    <button
      type="button"
      :aria-pressed="pills.lit === 'today'"
      class="pill relative inline-flex h-(--size-button-sm) items-center rounded-pill px-ms text-caption"
      :class="pills.lit === 'today' ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
      :disabled="disabled"
      data-testid="progress.day.today"
      @click="emit('choose', null)"
    >
      {{ t('book.progress.dayToday') }}
    </button>
    <button
      type="button"
      :aria-pressed="pills.lit === 'yesterday'"
      class="pill relative inline-flex h-(--size-button-sm) items-center rounded-pill px-ms text-caption"
      :class="pills.lit === 'yesterday' ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
      :disabled="disabled"
      data-testid="progress.day.yesterday"
      @click="emit('choose', pills.yesterday)"
    >
      {{ t('book.progress.dayYesterday') }}
    </button>
    <!-- The picker: the input is the pill's 44 pt box, so a tap anywhere on it opens the platform's own. -->
    <span
      class="pick relative inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill px-ms text-caption"
      :class="pills.lit === 'pick' ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
    >
      <UiIcon name="calendar" :size="14" />
      <span>{{ pickedWords ?? t('book.progress.dayPick') }}</span>
      <input
        type="date"
        class="picker"
        :value="pills.picked ?? ''"
        :min="min"
        :max="today"
        :disabled="disabled"
        :aria-label="pickedWords ? t('book.progress.dayPickNamed', { day: pickedWords }) : t('book.progress.dayPickLabel')"
        data-testid="progress.day.pick"
        @click="openPicker"
        @change="picked"
      />
    </span>
  </div>
</template>

<style scoped>
/* The drawn pill is 32 px; the touch target stays 44. */
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
/* Over the whole 44 pt box of the pill, invisible: the pill is what shows, the input what is tapped. */
.picker {
  position: absolute;
  inset: 50% 0 auto;
  width: 100%;
  height: var(--size-touch);
  opacity: 0;
  cursor: pointer;
  appearance: none;
  transform: translateY(-50%);
}
.picker:disabled {
  cursor: default;
}
/* The input is invisible, so the pill carries its focus ring. */
.pick:has(.picker:focus-visible) {
  outline: var(--stroke-focus) solid var(--color-accent-ink);
  outline-offset: var(--spacing-xxs);
}
</style>

<script setup lang="ts">
// The year the Profile shows (issue #78): All first, then each year with a
// finished read, newest first. One is lit (ink fill), as Library's filters.
// However many years there are, they stay one row that scrolls sideways — a
// finger, a trackpad, Shift + wheel — without a scroll bar, edge to edge like
// Home's shelf, and the row's scroll never carries on into the page's (no
// accidental Back swipe at its ends). The picked year scrolls into view.
import type { StatsYear } from '~/data/stats'

// While the reading record loads (`loading`), All stands lit and a few quiet
// pills in the loading wave hold the years' places (docs/MOTION.md, Loading).
const props = withDefaults(defineProps<{ years: readonly number[]; loading?: boolean }>(), { loading: false })
const year = defineModel<StatsYear>({ required: true })
const { t } = useI18n()
const arriving = useArrival(() => props.loading)

const row = useTemplateRef<HTMLElement>('row')

/** The picked pill fully in view, with the screen's margin beside it. */
function reveal(behavior: ScrollBehavior) {
  const el = row.value
  const pill = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!el || !pill) return
  const margin = parseFloat(getComputedStyle(el).paddingLeft) || 0
  // The row is the pills' offset parent (`relative`).
  const left = pill.offsetLeft
  if (left - margin < el.scrollLeft) el.scrollTo({ left: left - margin, behavior })
  else if (left + pill.offsetWidth + margin > el.scrollLeft + el.clientWidth) el.scrollTo({ left: left + pill.offsetWidth + margin - el.clientWidth, behavior })
}
onMounted(() => reveal('instant'))
watch(year, () => nextTick(() => reveal(prefersReducedMotion() ? 'instant' : 'smooth')))
</script>

<template>
  <div
    ref="row"
    role="group"
    :aria-label="t('profile.yearsLabel')"
    class="pills scrollbar-none relative -mx-screen flex gap-sm overflow-x-auto px-screen"
    data-testid="profile.years"
  >
    <button
      v-for="y in ['all' as const, ...years]"
      :key="y"
      type="button"
      :aria-pressed="year === y"
      class="pill figures relative inline-flex h-(--size-button-sm) shrink-0 items-center rounded-pill px-md text-caption"
      :class="[year === y ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill', { arrive: arriving && y !== 'all' }]"
      :data-testid="`profile.year.${y}`"
      @click="year = y"
    >
      {{ y === 'all' ? t('profile.all') : y }}
    </button>
    <template v-if="loading">
      <span v-for="i in 4" :key="i" class="waiting skeleton wave h-(--size-button-sm) w-(--spacing-xxxl) shrink-0" :style="{ '--wave': i * 0.12 }" aria-hidden="true" />
    </template>
  </div>
</template>

<style scoped>
.pills {
  overscroll-behavior-x: contain;
  /* Room above and below for the pills' 44 pt touch targets, inside the scroller. */
  padding-block: calc((var(--size-touch) - var(--size-button-sm)) / 2);
  margin-block: calc((var(--size-button-sm) - var(--size-touch)) / 2);
}
/* A year's place while they load: a pill of the fill. */
.waiting {
  border-radius: var(--radius-pill);
}
/* The drawn pill is 32 px; the touch target stays 44. */
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>

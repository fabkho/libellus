<script setup lang="ts">
// The quick rating of the unrated sheet (issue #14): five stars under a row's
// text, one real button each with the Book's name in it, so a read is rated
// without leaving the sheet. A tap sets whole stars — a tap in the rating
// control does the same (RatingInput.vue, "tap for whole stars"); quarters
// stay there and in the Edit sheet. Hovering or focusing a star lights it and
// the ones before it; `busy` holds this row's stars while its Rating is on its
// way, so nothing lands twice under a finger. The star shape is UiStars'.
import type { StatsRead } from '~/data/stats'
import { tick } from '#layers/ui/app/utils/haptics'

const props = withDefaults(defineProps<{ read: StatsRead; testid?: string; busy?: boolean }>(), { testid: undefined, busy: false })
const emit = defineEmits<{ rate: [stars: number] }>()

const { t } = useI18n()
const STARS = [1, 2, 3, 4, 5] as const

/** The star under the finger or the focus (a preview), else 0. */
const lit = ref(0)

function choose(stars: number) {
  tick()
  emit('rate', stars)
}

const STAR = 'M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.4-4.1 6-.7z'
</script>

<template>
  <div
    class="rate flex items-center"
    role="group"
    :aria-label="t('profile.sheet.rateLabel', { title: props.read.book.title })"
    :data-testid="testid"
    @pointerleave="lit = 0"
  >
    <button
      v-for="star in STARS"
      :key="star"
      type="button"
      class="star flex size-(--size-touch) items-center justify-center"
      :class="star <= lit && 'lit'"
      :disabled="busy"
      :aria-label="t('profile.sheet.rateStars', { title: props.read.book.title, count: star }, star)"
      :data-testid="testid && `${testid}.${star}`"
      @pointerenter="lit = star"
      @focus="lit = star"
      @blur="lit = 0"
      @click="choose(star)"
    >
      <svg viewBox="0 0 24 24" class="size-(--size-star)" aria-hidden="true"><path :d="STAR" fill="currentColor" /></svg>
    </button>
  </div>
</template>

<style scoped>
/* Under the row's own text column (its cover is to the left of it). */
.rate {
  padding-bottom: var(--spacing-sm);
  padding-left: calc(var(--size-cover-sm) + var(--spacing-inset));
}
.star {
  color: var(--color-star-track);
  transition: color var(--duration-quick) var(--ease-standard);
}
.star.lit {
  color: var(--color-star);
}
</style>

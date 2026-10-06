<script setup lang="ts">
// A year in review's Books month by month (issue #78): a row of small covers
// per month with the month's count, an empty month a dash. When the page
// opens, each row's covers slide in from the right, one after another, as
// Books pushed onto a shelf, over `sheet` (docs/MOTION.md, Month rows), the
// rows one after another from the top; a row below the fold does it as it
// scrolls into view, once. Only `transform` and `opacity` move (no layout),
// the covers stay tappable while it runs, and with Reduce Motion nothing moves.
// While the reading record loads (`loading`), the months gone by (`goneBy`)
// hold a cover's skeleton in the loading wave and the months still to come
// their dash, so the rows stand at their height; the covers then slide in as
// on opening (docs/MOTION.md, Loading).
import type { StatsRead } from '~/data/stats'
import { useBookStore } from '~/stores/book'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import { coverDelay, rowDelay, SLIDE } from '~/utils/monthIntro'

const props = withDefaults(defineProps<{ months: { month: number, reads: StatsRead[] }[], loading?: boolean, goneBy?: number }>(), { loading: false, goneBy: 12 })

const { t } = useI18n()
const books = useBookStore()
const { count, monthShort, monthLong } = useFigures()

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const coversOf = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>('[data-intro-cover]'))

/** Holds a row's covers off to the right, unseen, before the first paint, until the row is seen. */
function hold(row: Element) {
  for (const cover of coversOf(row)) {
    cover.style.opacity = '0'
    cover.style.transform = `translateX(${SLIDE}px)`
  }
}

/** Slides a row's covers in after `delay`. The held start (`backwards`) stands in until then. */
function slideIn(row: Element, delay: number) {
  const timing = { duration: durationToken('sheet'), easing: easingToken('sheet'), fill: 'backwards' as const }
  coversOf(row).forEach((cover, i) => {
    cover.animate(
      [{ opacity: 0, transform: `translateX(${SLIDE}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { ...timing, delay: delay + coverDelay(i) },
    )
    cover.style.removeProperty('opacity')
    cover.style.removeProperty('transform')
  })
}

/** The opening, once: when the page shows its rows, or when they come after the loading skeletons. */
let opened = false
function open() {
  const el = root.value
  if (opened || !el) return
  opened = true
  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
  const rows = Array.from(el.querySelectorAll('[data-intro-row]'))
  if (!rows.length) return
  rows.forEach(hold)
  observer = new IntersectionObserver((entries) => {
    // Rows that come into view together run top to bottom; one scrolled to later starts at once.
    const seen = entries.filter((entry) => entry.isIntersecting).sort((a, b) => (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    seen.forEach((entry, i) => {
      observer?.unobserve(entry.target)
      slideIn(entry.target, rowDelay(i, seen.length))
    })
  })
  rows.forEach((row) => observer!.observe(row))
}
onMounted(() => {
  if (!props.loading) open()
})
// The rows replacing the skeletons are held before they are painted (`post` runs before the frame).
watch(
  () => props.loading,
  (now, before) => {
    if (before && !now) open()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section id="months" ref="root" :aria-label="t('profile.year.months')" class="flex flex-col" data-testid="yearInReview.months">
    <!-- A month is a group named with its count ("March: 3 books"); the short name and the figure
         are drawn for the eye only, or they run into the covers' names. -->
    <div
      v-for="m in months"
      :key="m.month"
      role="group"
      :aria-label="t('profile.year.monthLabel', { month: monthLong(m.month), count: m.reads.length }, m.reads.length)"
      class="month flex items-center gap-md py-xs"
      :data-testid="`yearInReview.month.${m.month}`"
    >
      <span class="eyebrow w-(--size-touch) shrink-0" aria-hidden="true">{{ monthShort(m.month) }}</span>
      <span v-if="loading && m.month <= goneBy" class="flex flex-1" aria-hidden="true"><span class="cover-skeleton skeleton wave" :style="{ '--wave': (m.month - 1) * 0.06 }" /></span>
      <span v-else-if="m.reads.length" class="relative flex min-w-0 flex-1 flex-wrap gap-xs" data-intro-row>
        <span v-for="read in m.reads" :key="read.sessionId" class="block" data-intro-cover>
          <UiPressLink :to="`/book/${read.book.id}`" :aria-label="read.book.title" data-testid="yearInReview.read" @press="books.prefetch(read.book.id)">
            <UiCover
              :title="read.book.title"
              :authors="read.book.authors"
              :src="coverSrc(read.book.coverUrl, 'sm')"
              :thumbhash="read.book.coverThumbhash"
              :colors="read.book.coverColors"
              size="sm"
            />
          </UiPressLink>
        </span>
      </span>
      <span v-else class="flex-1 text-ink-ghost" aria-hidden="true">—</span>
      <span class="figures w-(--size-button-sm) shrink-0 text-right text-meta" :class="m.reads.length ? 'text-ink-muted' : 'text-ink-faint'" aria-hidden="true">{{ m.reads.length ? count(m.reads.length) : '' }}</span>
    </div>
  </section>
</template>

<style scoped>
.month + .month {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
/* A month's cover while the record loads (UiCover `sm`). */
.cover-skeleton {
  width: var(--size-cover-sm);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover-sm);
}
</style>

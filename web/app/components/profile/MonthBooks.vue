<script setup lang="ts">
// A year in review's Books month by month (issue #78): a row of small covers
// per month with the month's count, an empty month a dash. When the page
// opens, each row's covers stand a little apart and press together to their
// resting gap over `sheet` (docs/MOTION.md, Month rows), the rows one after
// another from the top; a row below the fold does it as it scrolls into view,
// once. Only `transform` moves (a `translateX` per cover, no layout), the
// covers stay tappable while it runs, and with Reduce Motion nothing moves.
import type { StatsRead } from '~/data/stats'
import { useBookStore } from '~/stores/book'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import { rowDelay, startOffsets } from '~/utils/monthIntro'

defineProps<{ months: { month: number, reads: StatsRead[] }[] }>()

const { t } = useI18n()
const books = useBookStore()
const { count, monthShort } = useFigures()

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const coversOf = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>('[data-intro-cover]'))
// A cover's resting distance from the start of its row; transforms do not count.
const offsetsOf = (covers: HTMLElement[]) => startOffsets(covers.map((cover) => cover.offsetLeft))

/** Stands a row's covers apart, before the first paint, until the row is seen. */
function spread(row: Element) {
  const covers = coversOf(row)
  const offsets = offsetsOf(covers)
  covers.forEach((cover, i) => (cover.style.transform = `translateX(${offsets[i]}px)`))
}

/** Presses a row's covers together after `delay`. The held start (`backwards`) stands in until then. */
function close(row: Element, delay: number) {
  const covers = coversOf(row)
  const offsets = offsetsOf(covers)
  const timing = { duration: durationToken('sheet'), easing: easingToken('sheet'), delay, fill: 'backwards' as const }
  covers.forEach((cover, i) => {
    cover.animate([{ transform: `translateX(${offsets[i]}px)` }, { transform: 'translateX(0)' }], timing)
    cover.style.removeProperty('transform')
  })
}

onMounted(() => {
  const el = root.value
  if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
  const rows = Array.from(el.querySelectorAll('[data-intro-row]'))
  if (!rows.length) return
  rows.forEach(spread)
  observer = new IntersectionObserver((entries) => {
    // Rows that come into view together run top to bottom; one scrolled to later starts at once.
    const seen = entries.filter((entry) => entry.isIntersecting).sort((a, b) => (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    seen.forEach((entry, i) => {
      observer?.unobserve(entry.target)
      close(entry.target, rowDelay(i, seen.length))
    })
  })
  rows.forEach((row) => observer!.observe(row))
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section id="months" ref="root" :aria-label="t('profile.year.months')" class="flex flex-col" data-testid="yearInReview.months">
    <div v-for="m in months" :key="m.month" class="month flex items-center gap-md py-xs" :data-testid="`yearInReview.month.${m.month}`">
      <span class="eyebrow w-(--size-touch) shrink-0">{{ monthShort(m.month) }}</span>
      <span v-if="m.reads.length" class="relative flex min-w-0 flex-1 flex-wrap gap-xs" data-intro-row>
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
      <span class="figures w-(--size-button-sm) shrink-0 text-right text-meta" :class="m.reads.length ? 'text-ink-muted' : 'text-ink-ghost'">{{ m.reads.length ? count(m.reads.length) : '' }}</span>
    </div>
  </section>
</template>

<style scoped>
.month + .month {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

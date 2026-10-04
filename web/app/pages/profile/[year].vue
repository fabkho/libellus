<script setup lang="ts">
// A year in review (issue #78): pushed from the Profile — its "<year> in
// review", a year's column under All, or a year's card — and lit by the
// year's favourite cover. The year large, its four figures, its books month
// by month as rows of covers with the month's count (an empty month is a
// dash, nothing to make up for), the favourite, the ratings (a row opens the
// books rated so), the records, the authors read more than once, and the
// years either side. Figures and covers, never sentences.
import { figuresOf, readsInMonth, readsWithStars, yearsOf } from '~/data/stats'
import { useBookStore } from '~/stores/book'
import { useStatsStore } from '~/stores/stats'

definePageMeta({ layout: 'tabs', screen: 'yearInReview', pushed: true, validate: (route) => /^\d{4}$/.test(String(route.params.year)) })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const stats = useStatsStore()
const books = useBookStore()
const { count, monthShort } = useFigures()

const year = computed(() => Number(route.params.year))
useHead({ title: () => `${t('profile.year.eyebrow')} · ${year.value} · ${t('app.name')}` })
// Loaded each time the page shows: opened afresh, or shown again from the
// router's cache of pages (then only `onActivated` runs).
let showing = false
function show() {
  if (showing) return
  showing = true
  void stats.load()
}
onMounted(show)
onActivated(show)
onDeactivated(() => (showing = false))

const reads = computed(() => stats.record?.reads ?? [])
const years = computed(() => yearsOf(reads.value))
const figures = computed(() => figuresOf(reads.value, year.value))
const months = computed(() => Array.from({ length: 12 }, (_, m) => ({ month: m + 1, reads: readsInMonth(reads.value, year.value, m + 1) })))
const before = computed(() => years.value.find((y) => y < year.value) ?? null)
const after = computed(() => [...years.value].reverse().find((y) => y > year.value) ?? null)

// A star row's books; open again on Back from a book opened in it.
const { sheet, shown, open: sheetOpen } = useProfileSheet()
const sheetTitle = computed(() => (shown.value?.kind === 'stars' ? t('profile.sheet.stars', { count: shown.value.star, year: String(shown.value.year) }, shown.value.star) : ''))
const sheetReads = computed(() => (shown.value?.kind === 'stars' ? readsWithStars(reads.value, shown.value.year, shown.value.star) : []))
function pickStars(star: number) {
  sheet.value = { kind: 'stars', year: year.value, star }
}

// Back to the Profile it came from (or to it, opened from an address).
function back() {
  if (String(window.history.state?.back ?? '').startsWith('/profile')) router.back()
  else void navigateTo('/profile')
}
</script>

<template>
  <div class="relative min-h-dvh" data-testid="yearInReview">
    <UiAmbient :colors="figures.favourite?.book.coverColors ?? null" />
    <UiTopBar :back-label="t('profile.back')" back-testid="yearInReview.back" @back="back" />

    <section class="relative flex flex-col items-center px-xl pt-md text-center">
      <p class="eyebrow">{{ t('profile.year.eyebrow') }}</p>
      <h1 class="year mt-sm tabular-nums" data-testid="yearInReview.title">{{ year }}</h1>
    </section>

    <div v-if="stats.record && figures.books" class="relative flex flex-col gap-xl px-screen pt-lg">
      <ProfileFigures :figures="figures" />

      <section id="months" :aria-label="t('profile.year.months')" class="flex flex-col" data-testid="yearInReview.months">
        <div v-for="m in months" :key="m.month" class="month flex items-center gap-md py-xs" :data-testid="`yearInReview.month.${m.month}`">
          <span class="eyebrow w-(--size-touch) shrink-0">{{ monthShort(m.month) }}</span>
          <span v-if="m.reads.length" class="flex min-w-0 flex-1 flex-wrap gap-xs">
            <UiPressLink
              v-for="read in m.reads"
              :key="read.sessionId"
              :to="`/book/${read.book.id}`"
              :aria-label="read.book.title"
              data-testid="yearInReview.read"
              @press="books.prefetch(read.book.id)"
            >
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
          <span v-else class="flex-1 text-ink-ghost" aria-hidden="true">—</span>
          <span class="figures w-(--size-button-sm) shrink-0 text-right text-meta" :class="m.reads.length ? 'text-ink-muted' : 'text-ink-ghost'">{{ m.reads.length ? count(m.reads.length) : '' }}</span>
        </div>
      </section>

      <UiPressLink
        v-if="figures.favourite"
        id="favourite"
        :to="`/book/${figures.favourite.book.id}`"
        class="relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint"
        data-testid="yearInReview.favourite"
        @press="books.prefetch(figures.favourite.book.id)"
      >
        <UiAmbient :colors="figures.favourite.book.coverColors" shape="card" />
        <span class="eyebrow relative">{{ t('profile.year.favourite') }}</span>
        <UiCover
          class="relative"
          :title="figures.favourite.book.title"
          :authors="figures.favourite.book.authors"
          :src="coverSrc(figures.favourite.book.coverUrl, 'lg')"
          :thumbhash="figures.favourite.book.coverThumbhash"
          :colors="figures.favourite.book.coverColors"
          size="lg"
          glow
        />
        <span class="relative flex flex-col items-center gap-xs">
          <span class="book-title text-book-title" data-testid="yearInReview.favouriteTitle">{{ figures.favourite.book.title }}</span>
          <span class="text-body text-ink-muted">{{ formatAuthors(figures.favourite.book.authors, t('common.etAl')) }}</span>
          <UiStars :quarters="figures.favourite.rating" size="md" />
        </span>
      </UiPressLink>

      <ProfileRatings v-if="figures.rated" :figures="figures" @pick="pickStars" />
      <ProfileRecords :figures="figures" />
      <ProfileAuthors :figures="figures" :limit="3" />

      <nav class="flex items-center justify-between" :aria-label="t('profile.year.other')">
        <UiButton v-if="before" tone="plain" size="sm" class="-ml-sm" :to="{ path: `/profile/${before}`, replace: true }" :aria-label="t('profile.year.beforeLabel', { year: before })" data-testid="yearInReview.before">
          <UiIcon name="back" :size="15" />{{ t('profile.year.before', { year: before }) }}
        </UiButton>
        <span v-else />
        <UiButton v-if="after" tone="plain" size="sm" class="-mr-sm" :to="{ path: `/profile/${after}`, replace: true }" :aria-label="t('profile.year.afterLabel', { year: after })" data-testid="yearInReview.after">
          {{ t('profile.year.after', { year: after }) }}<UiIcon name="chevron" :size="15" />
        </UiButton>
      </nav>
    </div>

    <div v-else-if="stats.record" class="relative flex flex-col items-center gap-xs px-xl py-xl text-center" data-testid="yearInReview.empty">
      <p class="book-title text-callout">{{ t('profile.empty.title') }}</p>
      <p class="text-subhead text-ink-muted">{{ t('profile.empty.text') }}</p>
    </div>

    <div v-else-if="stats.loadError" class="relative flex flex-col items-center gap-md px-xl py-xl text-center" data-testid="yearInReview.loadError">
      <p class="text-subhead text-ink-muted">{{ stats.loadError === 'offline' ? t('profile.offline') : t('profile.loadError') }}</p>
      <UiButton v-if="stats.loadError !== 'offline'" tone="secondary" size="md" data-testid="yearInReview.retry" @click="stats.load()">{{ t('profile.retry') }}</UiButton>
    </div>

    <ProfileReadsSheet v-model:open="sheetOpen" :title="sheetTitle" :reads="sheetReads" />
  </div>
</template>

<style scoped>
.year {
  font-size: calc(var(--text-figure) * 2);
  line-height: 1;
  font-weight: var(--font-weight-light);
  letter-spacing: var(--text-figure--letter-spacing);
}
.month + .month {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

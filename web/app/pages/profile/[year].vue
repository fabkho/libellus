<script setup lang="ts">
// A year in review (issue #78): pushed from the Profile — its "<year> in
// review", a year's column under All, or a year's card — and lit by the
// year's favourite cover. The year large, its four figures, its books month
// by month as rows of covers with the month's count (an empty month is a
// dash, nothing to make up for), the favourite, the ratings (a row opens the
// books rated so), the genres (a row opens the Library filtered by it and the year), the records, the authors read more than once, and the
// years either side. Figures and covers, never sentences.
import { genreFiguresOf } from '~/data/enrich/genreFigures'
import { figuresOf, readsInMonth, readsWithoutPages, readsWithStars, yearsOf } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { useGenresStore } from '~/stores/genres'
import { useLibraryViewStore } from '~/stores/libraryView'
import { useShelfStore } from '~/stores/shelf'
import { useStatsStore } from '~/stores/stats'

definePageMeta({ layout: 'tabs', screen: 'yearInReview', pushed: true, validate: (route) => /^\d{4}$/.test(String(route.params.year)) })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const stats = useStatsStore()
const bookGenres = useGenresStore()
const libraryView = useLibraryViewStore()
// Your shelf (#23): the year's Books as Regal's 3D row under the months, for the owner only.
const shelf = useShelfStore()

const year = computed(() => Number(route.params.year))
useHead({ title: () => `${t('profile.year.eyebrow')} · ${year.value} · ${t('app.name')}` })
// Loaded each time the page shows: opened afresh, or shown again from the
// router's cache of pages (then only `onActivated` runs).
let showing = false
function show() {
  if (showing) return
  showing = true
  void stats.load({ ifStale: true })
  void bookGenres.load({ ifStale: true })
  void shelf.load()
}
onMounted(show)
onActivated(show)
onDeactivated(() => (showing = false))

const reads = computed(() => stats.record?.reads ?? [])
const years = computed(() => yearsOf(reads.value))
const figures = computed(() => figuresOf(reads.value, year.value))
// Its placeholders stand in only for a Library known to have genres (the device keeps them), so one without
// any (a new account) keeps its height when the record lands; a first visit opens the block when they come.
const genresShown = computed(() => (loading.value ? bookGenres.loaded && bookGenres.any : genreFigures.value.genres.length > 0))
const genreFigures = computed(() => genreFiguresOf(reads.value, year.value, bookGenres.ofEntry))
const shelfBooks = computed(() => (shelf.isOwner ? shelf.readIn(year.value) : []))
// Until the reading record has come (or could not), the page stands in its final shape with
// placeholders where the figures and covers go, as the Profile does (docs/MOTION.md, Loading):
// every month with a cover, a favourite, the ratings, records and authors; whatever the year
// turns out not to have closes smoothly (UiReveal).
const loading = computed(() => !stats.record && !stats.loadError)
const arriving = useArrival(() => loading.value)
const hasYear = computed(() => !!stats.record && figures.value.books > 0)
const hasRecords = computed(() => !!(figures.value.longest || figures.value.shortest || figures.value.quickest || figures.value.slowest))
// While loading, the months gone by get a cover's placeholder; the months still to come their dash, as they will be.
const today = isoDay()
const monthsGoneBy = computed(() => {
  const thisYear = Number(today.slice(0, 4))
  return year.value < thisYear ? 12 : year.value === thisYear ? Number(today.slice(5, 7)) : 0
})
// The owner's row: the pile stands in while the library file loads, and closes if the year has no Books in it.
const shelfShown = computed(() => shelf.isOwner && ((!shelf.shelf && !shelf.loadError) || shelfBooks.value.length > 0))
const months = computed(() => Array.from({ length: 12 }, (_, m) => ({ month: m + 1, reads: readsInMonth(reads.value, year.value, m + 1) })))
const before = computed(() => years.value.find((y) => y < year.value) ?? null)
const after = computed(() => [...years.value].reverse().find((y) => y > year.value) ?? null)

// A star row's books, or the year's reads without a page count; open again on Back from a book opened in it.
const { sheet, shown, open: sheetOpen, restore } = useProfileSheet()
const sheetTitle = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.kind === 'pagesMissing') return t('profile.sheet.pagesMissing')
  return s.kind === 'stars' ? t('profile.sheet.stars', { count: s.star, year: String(s.year) }, s.star) : ''
})
const sheetReads = computed(() => {
  const s = shown.value
  if (!s) return []
  if (s.kind === 'stars') return readsWithStars(reads.value, s.year, s.star)
  return s.kind === 'pagesMissing' ? readsWithoutPages(reads.value, s.year) : []
})
function pickStars(star: number) {
  sheet.value = { kind: 'stars', year: year.value, star }
}
// The Pages line: the year's reads without a page count.
function pickPagesMissing() {
  sheet.value = { kind: 'pagesMissing', year: year.value }
}

// A genre's row opens the Library's Finished list filtered by it and by this year (#168).
function pickGenre(genre: string) {
  libraryView.showGenre('finished', genre, String(year.value))
  void navigateTo('/library')
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

    <UiReveal :show="loading || hasYear">
      <!-- No gaps between the blocks: each carries the space before it inside its room, so a block that closes takes its space along. -->
      <div class="relative flex flex-col px-screen pt-lg" :aria-busy="loading || undefined">
        <ProfileFigures :figures="loading ? null : figures" @pages-missing="pickPagesMissing" />

        <ProfileMonthBooks class="pt-xl" :months="months" :loading="loading" :gone-by="monthsGoneBy" />

        <UiReveal :show="shelfShown">
          <ShelfYearRow class="pt-xl" :year="year" :books="shelfBooks" />
        </UiReveal>

        <UiReveal :show="loading || !!figures.favourite">
          <div class="pt-xl">
            <ProfileFavourite id="favourite" :read="figures.favourite" :class="{ arrive: arriving }" />
          </div>
        </UiReveal>

        <UiReveal :show="loading || figures.rated > 0">
          <ProfileRatings class="pt-xl" :figures="loading ? null : figures" @pick="pickStars" />
        </UiReveal>
        <UiReveal :show="genresShown">
          <ProfileGenres class="pt-xl" :figures="loading ? null : genreFigures" :limit="3" @pick="pickGenre" />
        </UiReveal>
        <UiReveal :show="loading || hasRecords">
          <ProfileRecords class="pt-xl" :figures="loading ? null : figures" />
        </UiReveal>
        <UiReveal :show="loading || figures.authors.length > 0">
          <ProfileAuthors class="pt-xl" :figures="loading ? null : figures" :limit="3" />
        </UiReveal>

        <div class="pt-xl">
          <nav class="flex min-h-(--size-button-sm) items-center justify-between" :aria-label="t('profile.year.other')">
            <UiButton v-if="before" tone="plain" size="sm" class="-ml-sm" :to="{ path: `/profile/${before}`, replace: true }" :aria-label="t('profile.year.beforeLabel', { year: before })" data-testid="yearInReview.before">
              <UiIcon name="back" :size="15" />{{ t('profile.year.before', { year: before }) }}
            </UiButton>
            <span v-else />
            <UiButton v-if="after" tone="plain" size="sm" class="-mr-sm" :to="{ path: `/profile/${after}`, replace: true }" :aria-label="t('profile.year.afterLabel', { year: after })" data-testid="yearInReview.after">
              {{ t('profile.year.after', { year: after }) }}<UiIcon name="chevron" :size="15" />
            </UiButton>
          </nav>
        </div>
      </div>
    </UiReveal>

    <UiReveal :show="!!stats.record && !figures.books">
      <div class="relative flex flex-col items-center gap-xs px-xl py-xl text-center" data-testid="yearInReview.empty">
        <p class="book-title text-callout">{{ t('profile.empty.title') }}</p>
        <p class="text-subhead text-ink-muted">{{ t('profile.empty.text') }}</p>
      </div>
    </UiReveal>

    <UiReveal :show="!stats.record && !!stats.loadError">
      <div class="relative flex flex-col items-center gap-md px-xl py-xl text-center" data-testid="yearInReview.loadError">
        <p class="text-subhead text-ink-muted">{{ stats.loadError === 'offline' ? t('profile.offline') : t('profile.loadError') }}</p>
        <UiButton v-if="stats.loadError !== 'offline'" tone="secondary" size="md" data-testid="yearInReview.retry" @click="stats.load()">{{ t('profile.retry') }}</UiButton>
      </div>
    </UiReveal>

    <ProfileReadsSheet v-model:open="sheetOpen" :restore="restore" :title="sheetTitle" :reads="sheetReads" />
  </div>
</template>

<style scoped>
.year {
  font-size: calc(var(--text-figure) * 2);
  line-height: 1;
  font-weight: var(--font-weight-light);
  letter-spacing: var(--text-figure--letter-spacing);
}
</style>

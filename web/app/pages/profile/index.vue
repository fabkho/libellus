<script setup lang="ts">
// The Profile (issue #78, the design round's direction D: B's place and hero
// over A's figures). The avatar in every tab's header opens it, pushed like a
// book page and lit by a cover: the favourite of the year in view (this
// year's under All). Under the hero, the year pills (All first, the default)
// and everything they scope: the four figures (the Pages line opens the reads
// without a page count), the books by year (All; a year
// opens its review) or by month (a month opens its books, "<year> in review"
// the year), the ratings (a row opens the books rated so), the genres (a row opens the
// Library filtered by it, #168), the records and the authors read more than once. The reading days (this year and All) and
// the years in review do not change with the pills. The account at the end:
// what the avatar menu held. Figures and covers, never sentences.
import { genreFiguresOf } from '~/data/enrich/genreFigures'
import { figuresOf, readsInMonth, readsOnDay, readsWithoutPages, readsWithStars, readingSinceOf, yearsOf } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { useGenresStore } from '~/stores/genres'
import { useLibraryStore } from '~/stores/library'
import { useLibraryViewStore } from '~/stores/libraryView'
import { useShelfStore } from '~/stores/shelf'
import { useStatsStore } from '~/stores/stats'

definePageMeta({ layout: 'tabs', screen: 'profile', pushed: true })

const { t } = useI18n()
const library = useLibraryStore()
const router = useRouter()
const stats = useStatsStore()
const bookGenres = useGenresStore()
const libraryView = useLibraryViewStore()
// Your shelf (#23): the owner's card, and nobody else's.
const shelf = useShelfStore()
const { monthLong, monthLetter, dayTitle } = useFigures()

useHead({ title: () => `${t('profile.title')} · ${t('app.name')}` })
// Loaded each time the page shows: opened afresh, or shown again from the
// router's cache of pages (then only `onActivated` runs).
let showing = false
function show() {
  if (showing) return
  showing = true
  void stats.load()
  void bookGenres.load()
  void shelf.load()
  // The Library tells the page, before the record does, whether anything is finished (below).
  if (!library.loaded) void library.load()
}
onMounted(show)
onActivated(show)
onDeactivated(() => (showing = false))

const thisYear = Number(isoDay().slice(0, 4))
const thisMonth = Number(isoDay().slice(5, 7))
const reads = computed(() => stats.record?.reads ?? [])
const years = computed(() => yearsOf(reads.value))
// A year in review is one tap away (the year in view, or under All the latest): for the owner, its row is warmed on idle.
useShelfPreload(() => (stats.year === 'all' ? (years.value[0] ?? null) : stats.year))
const figures = computed(() => figuresOf(reads.value, stats.year))
// Its placeholders stand in only for a Library known to have genres (the device keeps them), so one without
// any (a new account) keeps its height when the record lands; a first visit opens the block when they come.
const genresShown = computed(() => (loading.value ? bookGenres.loaded && bookGenres.any : genreFigures.value.genres.length > 0))
const genreFigures = computed(() => genreFiguresOf(reads.value, stats.year, bookGenres.ofEntry))
const yearFigures = computed(() => years.value.map((y) => figuresOf(reads.value, y)))
const all = computed(() => figuresOf(reads.value, 'all'))
const finishedAny = computed(() => all.value.books > 0)
// Until the reading record has come (or could not), the page stands in its final shape with
// placeholders where the figures go, so nothing moves when they land (docs/MOTION.md, Loading).
// Each section that may turn out to have nothing to show is guessed present, the way a member
// who reads has it, and closes smoothly if it is not (UiReveal). A member whose Library (as
// this device holds it, stores/library.ts) has nothing finished gets no placeholders: her
// figures are the empty state, which stands in the first frame (below), so the account rows
// under it never move when the record comes. A Library this device has not seen yet (a direct
// load of the Profile before anything else) is not guessed at: nothing stands under the hero
// until the Library or the record has answered (`undecided`, a moment), then the page arrives
// whole, in its final shape, and fades in.
const loading = computed(() => !stats.record && !stats.loadError)
const undecided = computed(() => loading.value && !library.loaded)
// The page fading in carries `data-moving` while it does, like a sheet rising and UiReveal: a flow waits for
// it (`untilStill`) and an accessibility scan never reads its colours half way.
const arriving = ref(false)
const libraryEmpty = computed(() => library.loaded && library.finished.length === 0)
const placeholders = computed(() => loading.value && !libraryEmpty.value)
// The empty state: the record's answer once it is in, until then (or offline, when it cannot
// come) the Library's.
const emptyShown = computed(() => (stats.record ? !finishedAny.value : libraryEmpty.value && (loading.value || stats.loadError === 'offline')))
const errorShown = computed(() => !stats.record && !!stats.loadError && !emptyShown.value)
const hasStats = computed(() => !!stats.record && finishedAny.value)
const daysShown = computed(() => (stats.year === 'all' || stats.year === thisYear) && !!stats.record?.daysSince)
const hasRecords = computed(() => !!(figures.value.longest || figures.value.shortest || figures.value.quickest || figures.value.slowest))
/** Books finished at least once (a re-read counts its Book once), as Library's Finished counts them. */
const booksRead = computed(() => new Set(reads.value.filter((r) => r.outcome === 'finished').map((r) => r.entryId)).size)
const since = computed(() => readingSinceOf(reads.value))
const light = computed(() => (stats.year === 'all' ? figuresOf(reads.value, thisYear).favourite ?? all.value.favourite : figures.value.favourite)?.book.coverColors ?? null)

const columns = computed(() =>
  figures.value.columns.map((c) =>
    stats.year === 'all'
      ? { ...c, label: `’${String(c.key).slice(2)}`, name: String(c.key) }
      : { ...c, label: monthLetter(c.key), name: monthLong(c.key) },
  ),
)
const lit = computed(() => (stats.year === 'all' ? (years.value.includes(thisYear) ? thisYear : null) : stats.year === thisYear ? thisMonth : null))

// The sheet of a month's books, a star row's, the reads without a page count, or a day's; open again on Back from a book
// opened in it.
const { sheet, shown, open: sheetOpen, restore } = useProfileSheet()
const sheetTitle = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.kind === 'month') return t('profile.sheet.month', { month: monthLong(s.month), year: s.year })
  if (s.kind === 'pagesMissing') return t('profile.sheet.pagesMissing')
  if (s.kind === 'day') return dayTitle(s.day)
  return t('profile.sheet.stars', { count: s.star, year: s.year === 'all' ? t('profile.sheet.allYears') : String(s.year) }, s.star)
})
const sheetReads = computed(() => {
  const s = shown.value
  if (!s) return []
  if (s.kind === 'month') return readsInMonth(reads.value, s.year, s.month)
  if (s.kind === 'day') return readsOnDay(stats.record?.days ?? [], s.day)
  return s.kind === 'pagesMissing' ? readsWithoutPages(reads.value, s.year) : readsWithStars(reads.value, s.year, s.star)
})

function pickColumn(key: number) {
  if (stats.year === 'all') return void router.push(`/profile/${key}`)
  sheet.value = { kind: 'month', year: stats.year, month: key }
}
// A day of the reading days that was read: the reads it was read in (the very ones its dot stands for).
function pickDay(day: string) {
  sheet.value = { kind: 'day', day }
}
function pickStars(star: number) {
  sheet.value = { kind: 'stars', year: stats.year, star }
}
// The Pages line: the reads of the year in view whose Book has no page count (a row opens its book page, where
// the count can be set).
function pickPagesMissing() {
  sheet.value = { kind: 'pagesMissing', year: stats.year }
}
// A genre's row opens the Library's Finished list filtered by it (and by the year in view).
function pickGenre(genre: string) {
  libraryView.showGenre('finished', genre, stats.year === 'all' ? null : String(stats.year))
  void navigateTo('/library')
}

// The Profile belongs to whatever tab it was opened from: back by history when there is one.
function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/')
}

// Her photo (#156): the hero's avatar and the Account's Photo row both open it.
const photo = useTemplateRef<{ start: () => void }>('photo')
</script>

<template>
  <div class="relative min-h-dvh" data-testid="profile">
    <UiAmbient :colors="light" />
    <UiTopBar :back-label="t('profile.back')" back-testid="profile.back" @back="back" />

    <ProfileHero @photo="photo?.start()" :since="since" :read="booksRead" :reading="stats.record?.reading ?? 0" :want="stats.record?.wantToRead ?? 0" :loading="loading" :expect-since="placeholders" />

    <!-- No gaps between the blocks: each carries the space after it inside its room, so a block that closes takes its space along. -->
    <Transition name="decided" @before-enter="arriving = true" @after-enter="arriving = false" @enter-cancelled="arriving = false">
      <div v-if="!undecided" class="relative flex flex-col px-screen pt-xl" :data-moving="arriving || undefined">
        <UiReveal :show="placeholders || hasStats">
          <div class="flex flex-col pb-xl" :aria-busy="loading || undefined">
            <div class="flex flex-col gap-md">
              <ProfileYearPills v-model="stats.year" :years="years" :loading="loading" />
              <ProfileFigures :figures="loading ? null : figures" @pages-missing="pickPagesMissing" />
            </div>

            <section id="columns" class="flex flex-col gap-md pt-xl">
              <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
                <h2 class="eyebrow">{{ stats.year === 'all' ? t('profile.byYear') : t('profile.byMonth') }}</h2>
                <UiButton v-if="!loading && stats.year !== 'all'" tone="quiet" size="sm" :to="`/profile/${stats.year}`" data-testid="profile.inReview">
                  {{ t('profile.inReview', { year: stats.year }) }}<UiIcon name="chevron" :size="13" />
                </UiButton>
              </div>
              <ProfileColumns :columns="loading ? null : columns" :placeholders="stats.year === 'all' ? 4 : 12" :lit="lit" testid="profile.columns" @pick="pickColumn" />
            </section>

            <UiReveal :show="loading || daysShown">
              <ProfileDays class="pt-xl" :days="stats.record?.days ?? null" :since="stats.record?.daysSince ?? null" @pick="pickDay" />
            </UiReveal>
            <UiReveal :show="loading || figures.rated > 0">
              <ProfileRatings class="pt-xl" :figures="loading ? null : figures" @pick="pickStars" />
            </UiReveal>
            <UiReveal :show="genresShown">
              <ProfileGenres class="pt-xl" :figures="loading ? null : genreFigures" @pick="pickGenre" />
            </UiReveal>
            <UiReveal :show="loading || hasRecords">
              <ProfileRecords class="pt-xl" :figures="loading ? null : figures" />
            </UiReveal>
            <UiReveal :show="loading || figures.authors.length > 0">
              <ProfileAuthors class="pt-xl" :figures="loading ? null : figures" />
            </UiReveal>
            <ProfileYearCards class="pt-xl" :years="loading ? null : yearFigures" />
          </div>
        </UiReveal>

        <UiReveal :show="emptyShown">
          <div class="flex flex-col items-center gap-xs py-lg text-center" data-testid="profile.empty">
            <p class="book-title text-callout">{{ t('profile.empty.title') }}</p>
            <p class="text-subhead text-ink-muted">{{ t('profile.empty.text') }}</p>
          </div>
          <div class="pb-xl" />
        </UiReveal>

        <UiReveal :show="errorShown">
          <div class="flex flex-col items-center gap-md py-lg text-center" data-testid="profile.loadError">
            <p class="text-subhead text-ink-muted">{{ stats.loadError === 'offline' ? t('profile.offline') : t('profile.loadError') }}</p>
            <UiButton v-if="stats.loadError !== 'offline'" tone="secondary" size="md" data-testid="profile.retry" @click="stats.load()">{{ t('profile.retry') }}</UiButton>
          </div>
          <div class="pb-xl" />
        </UiReveal>

        <ProfileShelf v-if="shelf.isOwner" class="mb-xl" />

        <!-- Share (#171): her public reading page, off until she turns it on. -->
        <ProfileSharing class="mb-xl" />

        <ProfileAccount @photo="photo?.start()" />
      </div>
    </Transition>

    <ProfileReadsSheet v-model:open="sheetOpen" :restore="restore" :title="sheetTitle" :reads="sheetReads" :with-year="shown?.kind !== 'day' && shown?.year === 'all'" />
    <ProfilePhoto ref="photo" />
  </div>
</template>

<style scoped>
/* The page under the hero arrives whole once the Library or the record has answered: opacity only, so nothing moves. */
.decided-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.decided-enter-from {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .decided-enter-active {
    transition: opacity var(--duration-quick) linear;
  }
}
</style>

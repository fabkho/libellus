<script setup lang="ts">
// The Profile (issue #78, the design round's direction D: B's place and hero
// over A's figures). The avatar in every tab's header opens it, pushed like a
// book page and lit by a cover: the favourite of the year in view (this
// year's under All). Under the hero, the year pills (All first, the default)
// and everything they scope: the four figures, the books by year (All; a year
// opens its review) or by month (a month opens its books, "<year> in review"
// the year), the ratings (a row opens the books rated so), the records and
// the authors read more than once. The reading days (this year and All) and
// the years in review do not change with the pills. The account at the end:
// what the avatar menu held. Figures and covers, never sentences.
import { figuresOf, readsInMonth, readsWithStars, readingSinceOf, yearsOf, type StatsRead } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { useStatsStore } from '~/stores/stats'

definePageMeta({ layout: 'tabs', screen: 'profile', pushed: true })

const { t } = useI18n()
const router = useRouter()
const stats = useStatsStore()
const { monthLong, monthLetter } = useFigures()

useHead({ title: () => `${t('profile.title')} · ${t('app.name')}` })
onMounted(() => void stats.load())

const thisYear = Number(isoDay().slice(0, 4))
const thisMonth = Number(isoDay().slice(5, 7))
const reads = computed(() => stats.record?.reads ?? [])
const years = computed(() => yearsOf(reads.value))
const figures = computed(() => figuresOf(reads.value, stats.year))
const yearFigures = computed(() => years.value.map((y) => figuresOf(reads.value, y)))
const all = computed(() => figuresOf(reads.value, 'all'))
const finishedAny = computed(() => all.value.books > 0)
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

// The sheet of a month's books or a star row's.
const sheet = ref<{ title: string; reads: StatsRead[]; withYear: boolean } | null>(null)
const sheetOpen = computed({ get: () => sheet.value !== null, set: (open: boolean) => !open && (sheet.value = null) })
const sheetShown = ref<{ title: string; reads: StatsRead[]; withYear: boolean }>({ title: '', reads: [], withYear: false })
watch(sheet, (now) => now && (sheetShown.value = now))

function pickColumn(key: number) {
  if (stats.year === 'all') return void router.push(`/profile/${key}`)
  sheet.value = {
    title: t('profile.sheet.month', { month: monthLong(key), year: stats.year }),
    reads: readsInMonth(reads.value, stats.year, key),
    withYear: false,
  }
}
function pickStars(star: number) {
  const year = stats.year === 'all' ? t('profile.sheet.allYears') : String(stats.year)
  sheet.value = { title: t('profile.sheet.stars', { count: star, year }, star), reads: readsWithStars(reads.value, stats.year, star), withYear: stats.year === 'all' }
}

// The Profile belongs to whatever tab it was opened from: back by history when there is one.
function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/')
}
</script>

<template>
  <div class="relative min-h-dvh" data-testid="profile">
    <UiAmbient :colors="light" />
    <UiTopBar :back-label="t('profile.back')" back-testid="profile.back" @back="back" />

    <ProfileHero :since="since" :read="booksRead" :reading="stats.record?.reading ?? 0" :want="stats.record?.wantToRead ?? 0" />

    <div class="relative flex flex-col gap-xl px-screen pt-xl">
      <template v-if="stats.record && finishedAny">
        <div class="flex flex-col gap-md">
          <ProfileYearPills v-model="stats.year" :years="years" />
          <ProfileFigures :figures="figures" />
        </div>

        <section id="columns" class="flex flex-col gap-md">
          <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
            <h2 class="eyebrow">{{ stats.year === 'all' ? t('profile.byYear') : t('profile.byMonth') }}</h2>
            <UiButton v-if="stats.year !== 'all'" tone="quiet" size="sm" :to="`/profile/${stats.year}`" data-testid="profile.inReview">
              {{ t('profile.inReview', { year: stats.year }) }}<UiIcon name="chevron" :size="13" />
            </UiButton>
          </div>
          <ProfileColumns :columns="columns" :lit="lit" testid="profile.columns" @pick="pickColumn" />
        </section>

        <ProfileDays v-if="(stats.year === 'all' || stats.year === thisYear) && stats.record.daysSince" :days="stats.record.days" :since="stats.record.daysSince" />
        <ProfileRatings v-if="figures.rated" :figures="figures" @pick="pickStars" />
        <ProfileRecords :figures="figures" />
        <ProfileAuthors :figures="figures" />
        <ProfileYearCards :years="yearFigures" />
      </template>

      <div v-else-if="stats.record" class="flex flex-col items-center gap-xs py-lg text-center" data-testid="profile.empty">
        <p class="book-title text-callout">{{ t('profile.empty.title') }}</p>
        <p class="text-subhead text-ink-muted">{{ t('profile.empty.text') }}</p>
      </div>

      <div v-else-if="stats.loadError" class="flex flex-col items-center gap-md py-lg text-center" data-testid="profile.loadError">
        <p class="text-subhead text-ink-muted">{{ stats.loadError === 'offline' ? t('profile.offline') : t('profile.loadError') }}</p>
        <UiButton v-if="stats.loadError !== 'offline'" tone="secondary" size="md" data-testid="profile.retry" @click="stats.load()">{{ t('profile.retry') }}</UiButton>
      </div>

      <ProfileAccount />
    </div>

    <ProfileReadsSheet v-model:open="sheetOpen" :title="sheetShown.title" :reads="sheetShown.reads" :with-year="sheetShown.withYear" />
  </div>
</template>

<script setup lang="ts">
// A member's year in review (social v1, U4; docs/proposals/social-v1.md D 22): her year as the Profile's own
// year page shows yours, from her record: the year large under "<name> · Year in review", the four figures,
// the months as rows of covers, the favourite, the ratings, the records, the authors and the years either
// side. Never her reading days or a progress. Lit by the year's favourite cover. Back to her profile.
// Opened from her profile (a year's column, "<year> in review", a year's card) or from an address: then her
// profile is read first (stores/memberProfile.ts), as it is for the profile itself.
import { figuresOf, readsInMonth, readsWithStars, yearsOf } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { figuresWithRatings, memberBlocks } from '~/utils/memberProfile'
import { useMemberProfileStore } from '~/stores/memberProfile'

definePageMeta({
  layout: 'tabs',
  screen: 'memberYear',
  pushed: true,
  validate: (route) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(route.params.member)) && /^\d{4}$/.test(String(route.params.year)),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const members = useMemberProfileStore()

const id = computed(() => String(route.params.member))
const year = computed(() => Number(route.params.year))
const view = computed(() => members.viewOf(id.value))
const name = computed(() => view.value.profile?.member.name ?? t('member.someone'))
const open = computed(() => {
  const p = view.value.profile
  return p && p.visible ? p : null
})

useHead({ title: () => `${t('member.yearEyebrow', { name: name.value })} · ${year.value} · ${t('app.name')}` })

// Loaded each time the page shows (opened afresh, or shown again from the router's cache of pages).
let showing = false
function show() {
  if (showing) return
  showing = true
  void members.load(id.value)
}
onMounted(show)
onActivated(show)
onDeactivated(() => (showing = false))
watch(id, () => void members.load(id.value))

const record = computed(() => view.value.record)
const reads = computed(() => record.value?.reads ?? [])
const loading = computed(() => !record.value && (!view.value.loaded || view.value.recordLoading))
const blocks = computed(() => (open.value ? memberBlocks(open.value, record.value, loading.value) : null))
/** Her figures are not for the caller: a dead link, a private account, or her switches (the page is then the quiet state). */
const missing = computed(() => view.value.loaded && !view.value.recordLoading && !record.value && !view.value.recordError)
const years = computed(() => yearsOf(reads.value))
const figures = computed(() => figuresWithRatings(figuresOf(reads.value, year.value), open.value?.sections.ratings ?? true))
const hasYear = computed(() => !!record.value && figures.value.books > 0)
const hasRecords = computed(() => !!(figures.value.longest || figures.value.shortest || figures.value.quickest || figures.value.slowest))
const arriving = useArrival(() => loading.value)
// While loading, the months gone by get a cover's placeholder; the months still to come their dash, as they will be.
const today = isoDay()
const monthsGoneBy = computed(() => {
  const thisYear = Number(today.slice(0, 4))
  return year.value < thisYear ? 12 : year.value === thisYear ? Number(today.slice(5, 7)) : 0
})
const months = computed(() => Array.from({ length: 12 }, (_, m) => ({ month: m + 1, reads: readsInMonth(reads.value, year.value, m + 1) })))
const before = computed(() => years.value.find((y) => y < year.value) ?? null)
const after = computed(() => [...years.value].reverse().find((y) => y > year.value) ?? null)

// A star row's books, as on the Profile; open again on Back from a book opened in it.
const { sheet, shown, open: sheetOpen, restore } = useProfileSheet()
const sheetTitle = computed(() => {
  const s = shown.value
  return s?.kind === 'stars' ? t('profile.sheet.stars', { count: s.star, year: String(s.year) }, s.star) : ''
})
const sheetReads = computed(() => (shown.value?.kind === 'stars' ? readsWithStars(reads.value, shown.value.year, shown.value.star) : []))
function pickStars(star: number) {
  sheet.value = { kind: 'stars', year: year.value, star }
}

// Back to her profile it came from (or to it, opened from an address).
function back() {
  if (String(window.history.state?.back ?? '').startsWith(`/friends/${id.value}`)) router.back()
  else void navigateTo(`/friends/${id.value}`)
}
</script>

<template>
  <div class="relative min-h-dvh" data-testid="memberYear">
    <UiAmbient :colors="figures.favourite?.book.coverColors ?? null" />
    <UiTopBar :back-label="t('member.back')" back-testid="memberYear.back" @back="back" />

    <div v-if="missing" class="relative flex flex-col items-center gap-xs px-xl py-xl text-center" data-testid="memberYear.missing">
      <p class="book-title text-callout">{{ t('follow.missingTitle') }}</p>
    </div>

    <!-- Her profile came, her figures did not (offline, or it failed): not a dead link. -->
    <div v-else-if="view.recordError && !record" class="relative flex flex-col items-center gap-md px-xl py-xl text-center" data-testid="memberYear.recordError">
      <p class="text-subhead text-ink-muted">{{ view.recordError === 'offline' ? t('member.offline') : t('member.loadError') }}</p>
      <UiButton v-if="view.recordError !== 'offline'" tone="secondary" size="md" data-testid="memberYear.retry" @click="members.load(id)">{{ t('member.retry') }}</UiButton>
    </div>

    <div v-else-if="view.error && !view.loaded" class="relative flex flex-col items-center gap-md px-xl py-xl text-center" data-testid="memberYear.loadError">
      <p class="text-subhead text-ink-muted">{{ view.error === 'offline' ? t('member.offline') : t('member.loadError') }}</p>
      <UiButton v-if="view.error !== 'offline'" tone="secondary" size="md" data-testid="memberYear.retry" @click="members.load(id)">{{ t('member.retry') }}</UiButton>
    </div>

    <template v-else>
      <section class="relative flex flex-col items-center px-xl pt-md text-center">
        <p class="eyebrow" data-testid="memberYear.eyebrow">{{ view.loaded ? t('member.yearEyebrow', { name }) : '' }}</p>
        <h1 class="year mt-sm tabular-nums" data-testid="memberYear.title">{{ year }}</h1>
      </section>

      <UiReveal :show="loading || hasYear">
        <!-- No gaps between the blocks: each carries the space before it inside its room, so a block that closes takes its space along. -->
        <div class="relative flex flex-col px-screen pt-lg" :aria-busy="loading || undefined">
          <ProfileFigures :figures="loading ? null : figures" still />

          <ProfileMonthBooks class="pt-xl" foreign :months="months" :loading="loading" :gone-by="monthsGoneBy" />

          <UiReveal :show="loading || !!figures.favourite">
            <div class="pt-xl" :class="{ arrive: arriving }">
              <FriendsMemberFavourite :read="loading ? null : figures.favourite" />
            </div>
          </UiReveal>

          <UiReveal :show="!!blocks?.ratings && (loading || figures.rated > 0)">
            <ProfileRatings class="pt-xl" :figures="loading ? null : figures" @pick="pickStars" />
          </UiReveal>
          <UiReveal :show="loading || hasRecords">
            <ProfileRecords class="pt-xl" foreign :figures="loading ? null : figures" />
          </UiReveal>
          <UiReveal :show="loading || figures.authors.length > 0">
            <ProfileAuthors class="pt-xl" :figures="loading ? null : figures" :limit="3" />
          </UiReveal>

          <div class="pt-xl">
            <nav class="flex min-h-(--size-button-sm) items-center justify-between" :aria-label="t('profile.year.other')">
              <UiButton v-if="before" tone="plain" size="sm" class="-ml-sm" :to="{ path: `/friends/${id}/${before}`, replace: true }" :aria-label="t('profile.year.beforeLabel', { year: before })" data-testid="memberYear.before">
                <UiIcon name="back" :size="15" />{{ t('profile.year.before', { year: before }) }}
              </UiButton>
              <span v-else />
              <UiButton v-if="after" tone="plain" size="sm" class="-mr-sm" :to="{ path: `/friends/${id}/${after}`, replace: true }" :aria-label="t('profile.year.afterLabel', { year: after })" data-testid="memberYear.after">
                {{ t('profile.year.after', { year: after }) }}<UiIcon name="chevron" :size="15" />
              </UiButton>
            </nav>
          </div>
        </div>
      </UiReveal>
    </template>

    <ProfileReadsSheet v-model:open="sheetOpen" foreign :restore="restore" :title="sheetTitle" :reads="sheetReads" />
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

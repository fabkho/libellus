<script setup lang="ts">
// A member's profile (social v1, U4; docs/proposals/social-v1.md D 21 and B 7): pushed from the feed, People
// and a follow link, lit by her favourite cover like the Profile. Three things it can be:
//  - nobody (a link that is dead, or someone who blocked her): a quiet line;
//  - a private account she does not follow: her photo and name, the lock and its line, Ask to follow, and
//    after it Requested (a tap withdraws the request);
//  - a profile she may see (public, or followed): the hero (photo, name, since when, the Library line),
//    Follow where the account is public and she does not follow yet, then, by her switches, Currently
//    reading, Want to read (the newest, then See all), the year pills and the four figures, By year or
//    By month, Ratings, Records, Authors, Recently finished (the newest 3, then See all) and the Years in review. The Profile's own
//    blocks, fed from her record. Never her reading days, a progress, an account row or a shelf.
// A Book opens its page with the cover flying into it, a Manual book opens nothing (it is not in the
// Catalogue). Read each time the page shows (stores/memberProfile.ts), online only.
import { figuresOf, readsInMonth, readsWithStars, yearsOf } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { figuresWithRatings, libraryLine, memberBlocks } from '~/utils/memberProfile'
import { useMemberProfileStore } from '~/stores/memberProfile'

definePageMeta({
  layout: 'tabs',
  screen: 'member',
  pushed: true,
  validate: (route) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(route.params.member)),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const members = useMemberProfileStore()
const online = useOnline()
const { count, monthLong, monthLetter } = useFigures()

const id = computed(() => String(route.params.member))
const view = computed(() => members.viewOf(id.value))
const card = computed(() => view.value.profile?.member ?? null)
const name = computed(() => card.value?.name?.trim() || t('member.someone'))
/** The profile as the caller may see it, or null (a private account she does not follow, nobody, not known yet). */
const open = computed(() => {
  const p = view.value.profile
  return p && p.visible ? p : null
})
const closed = computed(() => (view.value.profile && !view.value.profile.visible ? view.value.profile : null))
const missing = computed(() => view.value.loaded && !view.value.profile)

useHead({ title: () => `${card.value ? name.value : t('member.someone')} · ${t('app.name')}` })

// Loaded each time the page shows: opened afresh, shown again from the router's cache of pages (then only
// `onActivated` runs), or opened on another member.
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
// Back online while the page is open: a Requested or Follow it shows, or figures it missed, may be old.
watch(online, (now) => now && showing && void members.load(id.value))

// ------------------------------------------------------------------ her reading, in figures
const thisYear = Number(isoDay().slice(0, 4))
const thisMonth = Number(isoDay().slice(5, 7))
const record = computed(() => view.value.record)
const reads = computed(() => record.value?.reads ?? [])
const loading = computed(() => !record.value && view.value.recordLoading)
/** Her figures are switched on but could not be read: said, so it does not look as if she has none. */
const recordFailed = computed(() => !!view.value.recordError && !record.value && !!open.value?.sections.year && !!open.value.sections.finished)
const blocks = computed(() => (open.value ? memberBlocks(open.value, record.value, loading.value) : null))
const years = computed(() => yearsOf(reads.value))
const year = computed({
  get: () => view.value.year,
  set: (value) => members.setYear(id.value, value),
})
const figures = computed(() => figuresWithRatings(figuresOf(reads.value, year.value), open.value?.sections.ratings ?? true))
const all = computed(() => figuresOf(reads.value, 'all'))
const yearFigures = computed(() => years.value.map((y) => figuresOf(reads.value, y)))
const hasRecords = computed(() => !!(figures.value.longest || figures.value.shortest || figures.value.quickest || figures.value.slowest))
const light = computed(() => (year.value === 'all' ? (figuresOf(reads.value, thisYear).favourite ?? all.value.favourite) : figures.value.favourite)?.book.coverColors ?? null)
const columns = computed(() =>
  figures.value.columns.map((c) =>
    year.value === 'all'
      ? { ...c, label: `’${String(c.key).slice(2)}`, name: String(c.key) }
      : { ...c, label: monthLetter(c.key), name: monthLong(c.key) },
  ),
)
const lit = computed(() => (year.value === 'all' ? (years.value.includes(thisYear) ? thisYear : null) : year.value === thisYear ? thisMonth : null))

const library = computed(() => {
  const p = open.value
  return p ? libraryLine(p.counts, (marks) => t('member.library', marks), count) : null
})
const wantAll = computed(() => view.value.want ?? open.value?.want ?? [])

// ------------------------------------------------------------------ sheets
// A month's books or a star row's, as on the Profile; the whole Want to read; all her finished Books.
const { sheet, shown, open: sheetOpen, restore } = useProfileSheet()
const wantOpen = ref(false)
const finishedOpen = ref(false)
const sheetTitle = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.kind === 'month') return t('profile.sheet.month', { month: monthLong(s.month), year: s.year })
  return s.kind === 'stars' ? t('profile.sheet.stars', { count: s.star, year: s.year === 'all' ? t('profile.sheet.allYears') : String(s.year) }, s.star) : ''
})
const sheetReads = computed(() => {
  const s = shown.value
  if (!s) return []
  if (s.kind === 'month') return readsInMonth(reads.value, s.year, s.month)
  return s.kind === 'stars' ? readsWithStars(reads.value, s.year, s.star) : []
})
function pickColumn(key: number) {
  if (year.value === 'all') return void router.push(`/friends/${id.value}/${key}`)
  sheet.value = { kind: 'month', year: year.value, month: key }
}
function pickStars(star: number) {
  sheet.value = { kind: 'stars', year: year.value, star }
}

// ------------------------------------------------------------------ actions
const canFollow = computed(() => !!open.value && !open.value.private && open.value.state === 'none')
const requested = computed(() => closed.value?.state === 'requested')
const failed = computed(() => !!view.value.failed && view.value.failed !== 'offline')

// What an action did, said in the one polite status the page keeps: Ask to follow becomes Requested and
// Follow leaves, so neither says it by itself (a11y).
const said = ref('')
watch(id, () => (said.value = ''))
const hero = useTemplateRef<{ focus: () => void }>('hero')
async function follow() {
  const wasOpen = !!open.value
  if (!(await members.follow(id.value))) return
  if (wasOpen) {
    // The Follow button is gone: focus goes to her name, where the page begins.
    said.value = t('member.following')
    await nextTick()
    hero.value?.focus()
  } else said.value = t('member.requested')
}
async function withdraw() {
  if (await members.withdraw(id.value)) said.value = t('member.withdrawn')
}

// ⋯: the member sheet (Unfollow · Remove as follower · Block, by the relation). Once one went
// through, the profile is read again: Unfollow brings back Follow (or the private card), Block leaves
// nobody to show.
const moreOpen = ref(false)
function more() {
  moreOpen.value = true
}
function changed() {
  void members.load(id.value)
}

// The round back: by history when there is one (the feed, People, a follow link), else to the feed.
function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/friends')
}
</script>

<template>
  <div class="relative min-h-dvh" data-testid="member">
    <UiAmbient :colors="open ? light : null" />
    <UiTopBar :back-label="t('member.back')" back-testid="member.back" @back="back">
      <template v-if="open" #trailing>
        <UiRoundButton icon="more" :label="t('member.moreLabel')" data-testid="member.more" @click="more" />
      </template>
    </UiTopBar>

    <p class="sr-only" role="status" data-testid="member.status">{{ said }}</p>

    <!-- Nobody there: a dead link, or someone who blocked her. Nothing says why. -->
    <FriendsNote v-if="missing" heading :title="t('follow.missingTitle')" data-testid="member.missing" />

    <!-- Not read yet, and no copy: offline, or it failed. -->
    <FriendsNote v-else-if="view.error && !view.loaded" heading :text="view.error === 'offline' ? t('member.offline') : t('member.loadError')" data-testid="member.loadError">
      <UiButton v-if="view.error !== 'offline'" tone="secondary" size="md" data-testid="member.retry" @click="members.load(id)">{{ t('member.retry') }}</UiButton>
    </FriendsNote>

    <!-- The first answer on its way: her place is held, nothing moves when it comes. -->
    <section v-else-if="!view.loaded" class="relative flex flex-col items-center px-xl pt-sm" aria-busy="true" aria-hidden="true">
      <span class="ring skeleton wave rounded-pill" />
      <span class="line title-line mt-md w-full"><span class="skeleton wave w-1/3" :style="{ '--wave': 0.05 }" /></span>
    </section>

    <!-- A private account she does not follow. -->
    <template v-else-if="closed && card">
      <FriendsMemberHero ref="hero" :card="card">
        <span class="lock mt-md flex items-center justify-center rounded-pill bg-fill text-ink-muted" aria-hidden="true">
          <UiIcon name="lock" :size="20" />
        </span>
        <p class="mt-md text-body font-medium" data-testid="member.private">{{ t('member.privateTitle') }}</p>
        <p class="mt-xs text-body text-ink-muted">{{ t('member.privateText', { name }) }}</p>
      </FriendsMemberHero>
      <div class="relative flex flex-col gap-sm px-screen pt-lg pb-xl">
        <!-- One button for both: Ask to follow and Requested are the same control, so focus stays on it. -->
        <UiButton
          :tone="requested ? 'secondary' : 'primary'"
          block
          :offline="!online"
          :disabled="view.busy"
          :data-testid="requested ? 'member.requested' : 'member.ask'"
          @click="requested ? withdraw() : follow()"
        >
          {{ requested ? t('member.requested') : t('member.ask') }}
        </UiButton>
        <p v-if="requested" class="text-center text-footnote text-ink-faint">{{ t('member.requestedHint') }}</p>
        <p v-if="failed" class="text-center text-footnote text-error" role="alert" data-testid="member.error">{{ t('privacy.error') }}</p>
      </div>
    </template>

    <!-- A profile she may see. -->
    <template v-else-if="open && blocks">
      <FriendsMemberHero ref="hero" :card="open.member" :since="open.since" :library="library" />

      <div class="relative flex flex-col px-screen pt-lg">
        <div v-if="canFollow" class="flex flex-col gap-sm pb-xl">
          <UiButton block :offline="!online" :disabled="view.busy" data-testid="member.follow" @click="follow">{{ t('member.follow') }}</UiButton>
          <p v-if="failed" class="text-center text-footnote text-error" role="alert" data-testid="member.error">{{ t('privacy.error') }}</p>
        </div>

        <!-- No gaps between the blocks: each carries the space after it, so one that is off takes its space along. -->
        <UiReveal :show="blocks.reading">
          <section class="flex flex-col gap-md pb-xl" data-testid="member.reading">
            <h2 class="eyebrow">{{ t('member.reading') }}</h2>
            <FriendsMemberCovers :books="open.reading.map((r) => r.book)" size="md" testid="member.readingBooks" />
          </section>
        </UiReveal>

        <UiReveal :show="blocks.want">
          <section class="flex flex-col gap-md pb-xl" data-testid="member.want">
            <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
              <h2 class="eyebrow">{{ t('member.want') }}</h2>
              <UiButton v-if="blocks.wantAll" tone="quiet" size="sm" :aria-label="t('member.seeAllLabel', { count: count(open.counts.want ?? 0), section: t('member.want') })" data-testid="member.wantAll" @click="wantOpen = true">
                <span class="figures">{{ t('member.wantAll', { count: count(open.counts.want ?? 0) }) }}</span><UiIcon name="chevron" :size="13" />
              </UiButton>
            </div>
            <FriendsMemberCovers :books="open.want.map((w) => w.book)" size="sm" testid="member.wantBooks" />
          </section>
        </UiReveal>

        <div v-if="recordFailed" class="flex flex-col items-center gap-sm pb-xl text-center" data-testid="member.recordError">
          <p class="text-subhead text-ink-muted">{{ view.recordError === 'offline' ? t('member.offline') : t('member.loadError') }}</p>
          <UiButton v-if="view.recordError !== 'offline'" tone="secondary" size="md" data-testid="member.recordRetry" @click="members.load(id)">{{ t('member.retry') }}</UiButton>
        </div>

        <UiReveal :show="blocks.figures">
          <div class="flex flex-col pb-xl" :aria-busy="loading || undefined">
            <div class="flex flex-col gap-md">
              <ProfileYearPills v-model="year" :years="years" :loading="loading" />
              <ProfileFigures :figures="loading ? null : figures" still />
            </div>

            <section id="columns" class="flex flex-col gap-md pt-xl">
              <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
                <h2 class="eyebrow">{{ year === 'all' ? t('profile.byYear') : t('profile.byMonth') }}</h2>
                <UiButton v-if="!loading && year !== 'all'" tone="quiet" size="sm" :to="`/friends/${id}/${year}`" data-testid="member.inReview">
                  {{ t('profile.inReview', { year }) }}<UiIcon name="chevron" :size="13" />
                </UiButton>
              </div>
              <ProfileColumns :columns="loading ? null : columns" :placeholders="year === 'all' ? 4 : 12" :lit="lit" testid="profile.columns" @pick="pickColumn" />
            </section>

            <UiReveal :show="blocks.ratings && (loading || figures.rated > 0)">
              <ProfileRatings class="pt-xl" :figures="loading ? null : figures" @pick="pickStars" />
            </UiReveal>
            <UiReveal :show="loading || hasRecords">
              <ProfileRecords class="pt-xl" foreign :figures="loading ? null : figures" />
            </UiReveal>
            <UiReveal :show="loading || figures.authors.length > 0">
              <ProfileAuthors class="pt-xl" :figures="loading ? null : figures" />
            </UiReveal>
          </div>
        </UiReveal>

        <UiReveal :show="blocks.finished">
          <div class="pb-xl">
            <FriendsMemberFinished :items="open.finished" :all="blocks.finishedAll" @all="finishedOpen = true" />
          </div>
        </UiReveal>

        <UiReveal :show="blocks.yearCards">
          <div class="pb-xl">
            <ProfileYearCards :years="loading ? null : yearFigures" :base="`/friends/${id}`" />
          </div>
        </UiReveal>
      </div>
    </template>

    <FriendsMemberSheet
      v-if="open"
      v-model:open="moreOpen"
      :member="open.member"
      :following="open.state === 'following'"
      :follower="open.followsYou"
      @changed="changed"
    />
    <FriendsMemberWantSheet v-model:open="wantOpen" :title="t('member.want')" :items="wantAll" />
    <FriendsMemberFinishedSheet v-if="open" v-model:open="finishedOpen" :title="t('member.finished')" :items="open.finished" />
    <ProfileReadsSheet v-model:open="sheetOpen" foreign :restore="restore" :title="sheetTitle" :reads="sheetReads" :with-year="shown?.kind !== 'day' && shown?.year === 'all'" />
  </div>
</template>

<style scoped>
/* The first answer's placeholders, at the sizes of what they stand for (the hero's ring and name). */
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
.line {
  display: flex;
  align-items: center;
  justify-content: center;
}
.line > * {
  height: 62%;
}
.title-line {
  height: var(--text-title--line-height);
}
.lock {
  width: var(--size-touch);
  height: var(--size-touch);
}
</style>

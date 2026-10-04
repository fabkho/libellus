<script setup lang="ts">
// Design round #78: the three Profile directions side by side. On a phone a
// list to open each one from; on a wide screen the three running live next to
// each other, at the phone's size.
import { THIS_YEAR, applyTheme, statsOf, wantToRead } from '~/components/proto/profile/model'

definePageMeta({ layout: false })
useHead({ title: 'Profile · Design round' })

const all = statsOf('all')
const route = useRoute()
onMounted(() => {
  const asked = route.query.theme
  if (asked === 'light' || asked === 'dark') applyTheme(asked)
})

const DIRECTIONS = [
  {
    key: 'a',
    name: 'Ledger',
    where: 'A fourth tab, “You” (your initials in a ring).',
    pitch: 'The reading in figures, a year at a time: four numbers, books by month (a month opens its books), reading days, ratings, records, authors. The account at the end.',
    links: [
      { label: 'You', to: '/prototype/profile/a' },
      { label: 'All years', to: '/prototype/profile/a?year=all' },
      { label: 'Home', to: '/prototype/profile/a?screen=home' },
    ],
    good: [
      'Everything in one place, one tap away, and the year switch makes every past year comparable',
      'Figures read at a glance; the month bars answer “when did I read that?”',
      'Room to grow (goals, if ever, or collections stats) without crowding Home',
    ],
    trade: [
      'A fourth tab: the capsule grows from 224 to 296 wide, and the search morph has to learn four tabs',
      'Home loses the avatar; the account moves behind a tab you open rarely',
      'The most “dashboard”: the risk of reading as a scoreboard',
    ],
  },
  {
    key: 'b',
    name: 'Reading life',
    where: 'The avatar opens a pushed Profile page (no menu).',
    pitch: 'The reading in sentences and covers, lit by your favourite: this year so far over its covers, the days read lately, a card per year (each opens its year in review), five stars, authors, quiet facts. The account at the end.',
    links: [
      { label: 'Profile', to: '/prototype/profile/b' },
      { label: 'Year in review', to: '/prototype/profile/b?screen=year&year=2025' },
      { label: 'Home', to: '/prototype/profile/b?screen=home' },
    ],
    good: [
      'Warmest: the covers carry it, numbers sit inside sentences',
      'The tab bar stays as it is; the avatar becomes a door, like on most apps',
      'Year in review is a real place to revisit, every year',
    ],
    trade: [
      'Two taps to the theme switch and Sign out (today one)',
      'Less exact: fewer figures, no month or rating breakdown on the page',
      'Copy has to be written for edge cases (no five-star book, an empty year)',
    ],
  },
  {
    key: 'c',
    name: 'In the Library',
    where: 'No new screen: the stats fold into the Library; the account stays in the avatar menu.',
    pitch: 'Finished opens with the years as columns; each year’s pinned header carries its count, pages and average and opens a year sheet; rows say how long a read took and mark a second read. Reading days sit over Currently reading. Home’s tally opens its year.',
    links: [
      { label: 'Finished', to: '/prototype/profile/c' },
      { label: 'Year sheet', to: '/prototype/profile/c?year=2025' },
      { label: 'Reading', to: '/prototype/profile/c?segment=reading' },
      { label: 'Home', to: '/prototype/profile/c?screen=home' },
    ],
    good: [
      'Nothing new to learn or navigate; stats sit next to the books they describe',
      'Keeps DESIGN.md’s “no profile screen” and the 3-tab capsule',
      'Smallest build: a sheet, a header, a row line',
    ],
    trade: [
      'No home for the account if it ever grows (export, delete account, goals)',
      'No all-time overview beyond the year columns; authors and records only per year',
      'The Library gets busier for members who never wanted stats',
    ],
  },
] as const
</script>

<template>
  <div class="mx-auto min-h-dvh w-full max-w-(--size-max-content) bar-top px-screen pb-xxl lg:max-w-none">
    <header class="flex flex-col gap-sm py-lg">
      <p class="eyebrow">Design round · #78</p>
      <h1 class="text-large-title">Profile and reading stats</h1>
      <p class="text-subhead text-ink-muted">
        Three directions for where the account lives and which stats are worth showing, on a stub library shaped like the owner’s: {{ all.books }} finished
        reads since 2023 ({{ all.rated }} rated, {{ all.rereads.length }} re-reads, {{ all.abandoned.length }} not finished), {{ wantToRead.length }} want to
        read, three current reads with days of progress. Today is pinned to 4 Oct {{ THIS_YEAR }}. Nothing is saved.
      </p>
    </header>

    <div class="grid gap-lg lg:grid-cols-3">
      <section v-for="d in DIRECTIONS" :key="d.key" class="flex flex-col gap-md rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" :data-testid="`proto.compare.${d.key}`">
        <div class="flex items-baseline gap-sm">
          <span class="figures text-title text-accent uppercase">{{ d.key }}</span>
          <h2 class="book-title text-book-title">{{ d.name }}</h2>
        </div>
        <p class="text-subhead"><span class="text-ink">{{ d.where }}</span> <span class="text-ink-muted">{{ d.pitch }}</span></p>
        <div class="flex flex-wrap gap-sm">
          <UiButton v-for="(l, i) in d.links" :key="l.to" :tone="i === 0 ? 'primary' : 'secondary'" size="sm" :to="l.to">{{ l.label }}</UiButton>
        </div>
        <iframe class="phone hidden lg:block" :src="d.links[0].to" :title="d.name" loading="lazy" />
        <div class="grid gap-md sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <h3 class="eyebrow mb-sm">Does well</h3>
            <ul class="flex flex-col gap-xs text-caption">
              <li v-for="line in d.good" :key="line" class="flex gap-sm"><span class="text-accent">+</span>{{ line }}</li>
            </ul>
          </div>
          <div>
            <h3 class="eyebrow mb-sm">Trade-offs</h3>
            <ul class="flex flex-col gap-xs text-caption text-ink-muted">
              <li v-for="line in d.trade" :key="line" class="flex gap-sm"><span class="text-ink-faint">−</span>{{ line }}</li>
            </ul>
          </div>
        </div>
      </section>
    </div>

    <section class="mt-lg flex flex-col gap-sm rounded-lg bg-fill p-inset edge-faint">
      <h2 class="eyebrow">Recommendation</h2>
      <p class="text-subhead">
        <strong class="font-medium">B, Reading life</strong>, with C’s small touches: the avatar opens a Profile page (the account moves there, the tab bar
        stays at three), and the Library rows learn “in 12 days” and “2nd read”. Take A’s year switch and month bars into B’s year in review for the exact
        figures. Every stat shown is a query on today’s tables; nothing new to store.
      </p>
    </section>
  </div>
</template>

<style scoped>
/* A phone, scaled to fit the column. */
.phone {
  width: 393px;
  height: 852px;
  margin-bottom: calc(852px * -0.25);
  border: 0;
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-raised);
  transform: scale(0.75);
  transform-origin: top left;
}
</style>

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
    key: 'd',
    name: 'A + B',
    where: 'The avatar opens a pushed Profile page (B), with A’s figures.',
    pitch: 'B’s hero over A’s year pills and four figures, then every stat of both as figures and covers, no sentences: months (a month opens its books), reading days, ratings and the five-star shelf, records, authors, the years as cards. Each year opens B’s full-screen review, now in figures. The account at the end.',
    links: [
      { label: 'Profile', to: '/prototype/profile/d' },
      { label: 'Year in review', to: '/prototype/profile/d?screen=year&year=2025' },
      { label: 'All years', to: '/prototype/profile/d?year=all' },
      { label: 'Home', to: '/prototype/profile/d?screen=home' },
    ],
    good: [
      'Every stat of A and B in one place; figures and covers, nothing to read through',
      'B’s hero and cover light keep it warm; A’s grid makes it exact',
      'The year in review is one tap from the months, the year columns and the year cards',
      'Tab bar and Home unchanged',
    ],
    trade: [
      'A long page: the year pills scope most of it, so the order matters',
      'Dark mode and Sign out take two taps (today one)',
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
        Directions for where the account lives and which stats are worth showing, on a stub library shaped like the owner’s: {{ all.books }} finished
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
        <strong class="font-medium">D, A + B</strong>: the owner’s pick of round one (A and B; C is out, B’s sentences too). The avatar opens the
        Profile page with B’s hero over A’s figures and every stat of both; each year opens its full-screen review. Every stat shown is a query on
        today’s tables; nothing new to store.
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

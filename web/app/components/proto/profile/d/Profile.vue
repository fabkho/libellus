<script setup lang="ts">
// Direction D, A + B (the owner's pick of round one): B's place and hero —
// the avatar pushes a Profile page lit by a cover, the initials ring, the name,
// the whole reading in one mono line — over A's figures. Then every stat of
// both, as figures and covers, never as sentences: A's year pills and four
// figures, the months (a month opens its books; the year opens its full-screen
// review), the reading days, the ratings with B's five-star shelf, A's
// records, the authors (B's covers, A's tallies), B's year cards, A's three
// small figures, and the account at the end.
import { FIRST_DAY, MEMBER, THIS_YEAR, TODAY, YEARS, monthLetter, monthYear, n, plural, statsOf, type Year } from '../model'

const props = defineProps<{ year: Year; openMonth?: number | null }>()
const emit = defineEmits<{ back: []; year: [year: Year]; review: [year: number] }>()

const stats = computed(() => statsOf(props.year))
const all = statsOf('all')
const years = YEARS.map((y) => statsOf(y))
const isAll = computed(() => props.year === 'all')
const thisMonth = Number(TODAY.slice(5, 7)) - 1
const columns = computed(() => (isAll.value ? [...years].reverse() : []))
const labels = computed(() => (isAll.value ? columns.value.map((c) => `’${String(c.year).slice(2)}`) : Array.from({ length: 12 }, (_, m) => monthLetter(m))))
const values = computed(() => (isAll.value ? columns.value.map((c) => c.books) : stats.value.months))
const lit = computed(() => (isAll.value ? columns.value.length - 1 : props.year === THIS_YEAR ? thisMonth : null))
// The cover light follows the year in view: its favourite.
const light = computed(() => (isAll.value ? statsOf(THIS_YEAR) : stats.value).favourite?.book.colors ?? null)

// Local state, not the route (a sheet that writes the route fights its own Back).
const month = ref<number | null>(props.openMonth ?? null)
function pick(i: number) {
  if (isAll.value) emit('review', columns.value[i]!.year as number)
  else month.value = i
}

const span = (() => {
  const months = (THIS_YEAR - Number(FIRST_DAY.slice(0, 4))) * 12 + Number(TODAY.slice(5, 7)) - Number(FIRST_DAY.slice(5, 7))
  return `${Math.floor(months / 12)} years, ${months % 12} months`
})()
</script>

<template>
  <div class="relative min-h-dvh clear-tab-bar" data-testid="d.profile">
    <UiAmbient :colors="light" />
    <UiTopBar back-label="Back" back-testid="d.back" @back="emit('back')" />

    <!-- B's hero. -->
    <section class="relative flex flex-col items-center px-xl pt-sm text-center">
      <span class="ring figures flex items-center justify-center rounded-pill bg-surface-raised text-title text-ink-muted shadow-cover edge" aria-hidden="true">{{ MEMBER.initials }}</span>
      <h1 class="mt-md text-title" data-testid="d.name">{{ MEMBER.name }}</h1>
      <p class="mt-xs text-body text-ink-muted">Reading here since {{ monthYear(FIRST_DAY) }}</p>
      <p class="eyebrow mt-sm flex items-center gap-sm">
        {{ plural(all.books, 'book') }}<span class="dot" aria-hidden="true" />{{ n(all.pages) }} pages<span class="dot" aria-hidden="true" />{{ span }}
      </p>
    </section>

    <main class="relative flex flex-col gap-xl px-screen pt-xl">
      <!-- A's year pills and figures. -->
      <div class="flex flex-col gap-md">
        <div role="group" aria-label="Year" class="-mx-screen flex gap-sm overflow-x-auto px-screen">
          <button
            v-for="y in [...YEARS, 'all' as const]"
            :key="y"
            type="button"
            :aria-pressed="year === y"
            class="figures inline-flex h-(--size-button-sm) shrink-0 items-center rounded-pill px-md text-caption"
            :class="year === y ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
            :data-testid="`d.year.${y}`"
            @click="emit('year', y)"
          >
            {{ y === 'all' ? 'All' : y }}
          </button>
        </div>
        <ProtoProfileFigures :stats="stats" />
      </div>

      <!-- The months; the year opens its review. -->
      <section id="months" class="flex flex-col gap-md">
        <div class="flex h-(--size-button-sm) items-center justify-between">
          <h2 class="eyebrow">{{ isAll ? 'By year' : 'By month' }}</h2>
          <UiButton v-if="!isAll" tone="quiet" size="sm" class="-mr-xxs" data-testid="d.review" @click="emit('review', year as number)">
            {{ year }} in review<UiIcon name="chevron" :size="13" />
          </UiButton>
        </div>
        <ProtoProfileBars :values="values" :labels="labels" :lit="lit" pickable tall testid="d.months" @pick="pick" />
      </section>

      <ProtoProfileDays v-if="year === THIS_YEAR || isAll" />

      <section id="ratings" class="flex flex-col gap-md">
        <div class="flex items-baseline justify-between">
          <h2 class="eyebrow">Ratings</h2>
          <span class="figures text-meta text-ink-faint">{{ stats.rated }} rated<template v-if="stats.unrated"> · {{ stats.unrated }} not yet</template></span>
        </div>
        <ProtoProfileStarBars :stats="stats" />
      </section>

      <ProtoProfileShelf title="Five stars" :reads="stats.fives" testid="d.fives" />

      <ProtoProfileRecords :stats="stats" />

      <ProtoProfileAuthors :stats="stats" :limit="4" />

      <!-- B's year cards, each opening its review. -->
      <section id="years" class="flex flex-col gap-md" data-testid="d.years">
        <h2 class="eyebrow">Years in review</h2>
        <div class="-mx-screen flex gap-ms overflow-x-auto px-screen pb-md">
          <button
            v-for="y in years"
            :key="y.year"
            type="button"
            class="card relative flex shrink-0 flex-col gap-sm overflow-hidden rounded-lg bg-surface-raised p-inset text-left shadow-raised edge-faint"
            :data-testid="`d.yearCard.${y.year}`"
            @click="emit('review', y.year as number)"
          >
            <UiAmbient :colors="y.favourite?.book.colors ?? null" shape="card" />
            <span class="relative flex items-start justify-between gap-sm">
              <span class="flex flex-col gap-xs">
                <span class="text-figure tabular-nums">{{ y.year }}</span>
                <span class="figures text-meta text-ink-muted">{{ plural(y.books, 'book') }}</span>
              </span>
              <UiCover
                v-if="y.favourite"
                :title="y.favourite.book.title"
                :authors="y.favourite.book.authors"
                :src="coverSrc(y.favourite.book.cover, 'md')"
                :thumbhash="y.favourite.book.thumbhash"
                :colors="y.favourite.book.colors"
                size="md"
                glow
              />
            </span>
            <span class="relative mt-auto flex flex-col gap-xxs">
              <span class="eyebrow">Favourite</span>
              <span class="book-title truncate text-callout">{{ y.favourite?.book.title }}</span>
            </span>
          </button>
        </div>
      </section>

      <ProtoProfileAlso :stats="stats" />

      <ProtoProfileAccount />
    </main>

    <ProtoProfileMonthSheet :year="year === 'all' ? THIS_YEAR : year" :month="month" @close="month = null" />
  </div>
</template>

<style scoped>
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
.card {
  width: calc(var(--size-cover-xl) * 1.6);
  min-height: calc(var(--size-cover-xl) * 1.2);
}
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>

<script setup lang="ts">
// Direction D, A + B (the owner's pick of round one): B's place and hero —
// the avatar pushes a Profile page lit by a cover, the initials ring, the name,
// the Library in one mono line (read · reading · want to read) — over A's figures. Then every stat of
// both, as figures and covers, never as sentences: A's year pills and four
// figures (All first), the months (a month opens its books; the year opens its
// full-screen review), the reading days, the ratings (a row opens the books
// rated so), A's records, the authors (B's covers, A's tallies), B's year
// cards, and the account at the end.
import { FIRST_DAY, MEMBER, THIS_YEAR, TODAY, YEARS, currentReads, monthLetter, monthYear, n, plural, statsOf, wantToRead, type Year } from '../model'

const props = defineProps<{ year: Year; openMonth?: number | null; openStar?: number | null }>()
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
const star = ref<number | null>(props.openStar ?? null)
function pick(i: number) {
  if (isAll.value) emit('review', columns.value[i]!.year as number)
  else month.value = i
}

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
        {{ n(all.books) }} read<span class="dot" aria-hidden="true" />{{ currentReads.length }} reading<span class="dot" aria-hidden="true" />{{ wantToRead.length }} want to read
      </p>
    </section>

    <main class="relative flex flex-col gap-xl px-screen pt-xl">
      <!-- A's year pills and figures. -->
      <div class="flex flex-col gap-md">
        <div role="group" aria-label="Year" class="no-bar -mx-screen flex gap-sm overflow-x-auto px-screen">
          <button
            v-for="y in ['all' as const, ...YEARS]"
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
        <ProtoProfileStarBars :stats="stats" pickable @pick="star = $event" />
      </section>

      <ProtoProfileRecords :stats="stats" />

      <ProtoProfileAuthors :stats="stats" :limit="4" />

      <!-- B's year cards, each opening its review. -->
      <section id="years" class="flex flex-col gap-md" data-testid="d.years">
        <h2 class="eyebrow">Years in review</h2>
        <div class="no-bar -mx-screen flex gap-ms overflow-x-auto px-screen pb-md">
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

      <ProtoProfileAccount />
    </main>

    <ProtoProfileRatingSheet :year="year" :star="star" @close="star = null" />
    <ProtoProfileMonthSheet :year="year === 'all' ? THIS_YEAR : year" :month="month" @close="month = null" />
  </div>
</template>

<style scoped>
/* Sideways rows scroll by touch or trackpad; no scroll bar under them. */
.no-bar {
  scrollbar-width: none;
}
.no-bar::-webkit-scrollbar {
  display: none;
}
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

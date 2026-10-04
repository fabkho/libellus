<script setup lang="ts">
// Direction B "Reading life": the avatar opens a page of its own, pushed like
// a book page and lit like one (by this year's favourite cover). It talks
// rather than counts: the year so far in a sentence over its covers, the days
// read lately, a card for each year before, the five-star shelf, the authors
// you come back to, a few quiet facts, and the account at the end. Numbers
// stay inside sentences; nothing asks for more.
import {
  FIRST_DAY,
  MEMBER,
  THIS_YEAR,
  YEARS,
  finishedIn,
  monthYear,
  n,
  plural,
  readingDaysSummary,
  average,
  statsOf,
  wantToRead,
} from '../model'
import { DAYS } from '../library'

defineEmits<{ back: []; year: [year: number] }>()

const now = statsOf(THIS_YEAR)
const all = statsOf('all')
const past = YEARS.filter((y) => y !== THIS_YEAR).map((y) => statsOf(y))
const shelf = finishedIn(THIS_YEAR).reverse()
const lately = readingDaysSummary(21)
// Every book together, day by day: the book page's chart, for all of them.
const together = lately.cells.map((c) => ({ day: c.day, amount: c.pages || (DAYS.some((d) => d.day === c.day) ? 1 : 0) }))

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty']
const word = (count: number) => WORDS[count] ?? n(count)
const span = (() => {
  const months = (THIS_YEAR - Number(FIRST_DAY.slice(0, 4))) * 12 + 10 - Number(FIRST_DAY.slice(5, 7))
  return `${Math.floor(months / 12)} years, ${months % 12} months`
})()
</script>

<template>
  <div class="relative min-h-dvh clear-tab-bar" data-testid="b.profile">
    <UiAmbient :colors="now.favourite?.book.colors ?? null" />
    <UiTopBar back-label="Back" back-testid="b.back" @back="$emit('back')" />

    <section class="relative flex flex-col items-center px-xl pt-sm text-center">
      <span class="ring figures flex items-center justify-center rounded-pill bg-surface-raised text-title text-ink-muted shadow-cover edge" aria-hidden="true">{{ MEMBER.initials }}</span>
      <h1 class="mt-md text-title" data-testid="b.name">{{ MEMBER.name }}</h1>
      <p class="mt-xs text-body text-ink-muted">Reading here since {{ monthYear(FIRST_DAY) }}</p>
      <p class="eyebrow mt-sm flex items-center gap-sm">
        {{ plural(all.books, 'book') }}<span class="dot" aria-hidden="true" />{{ n(all.pages) }} pages<span class="dot" aria-hidden="true" />{{ span }}
      </p>
    </section>

    <main class="relative flex flex-col gap-xl px-screen pt-xl">
      <!-- This year, in a sentence, over its covers. -->
      <section class="relative overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="b.thisYear">
        <UiAmbient :colors="now.favourite?.book.colors ?? null" shape="card" />
        <div class="relative flex flex-col gap-md">
          <div class="flex items-baseline justify-between">
            <h2 class="eyebrow">{{ THIS_YEAR }} so far</h2>
            <span class="figures text-meta text-ink-faint">★ {{ average(now.average) }} on average</span>
          </div>
          <p class="prose text-callout">
            {{ word(now.books) }} books so far, {{ n(now.pages) }} pages.
            <em>{{ now.favourite?.book.title }}</em> got five stars{{ now.favourite?.nth > 1 ? ' again' : '' }}, and <em>{{ now.slowest?.book.title }}</em> kept you company longest:
            {{ now.slowest?.days }} days.
          </p>
          <div class="flex flex-wrap gap-xs" aria-label="This year's books, in order">
            <UiCover
              v-for="r in shelf"
              :key="r.id"
              :title="r.book.title"
              :authors="r.book.authors"
              :src="coverSrc(r.book.cover, 'sm')"
              :thumbhash="r.book.thumbhash"
              :colors="r.book.colors"
              size="xs"
            />
          </div>
          <button type="button" class="figures -mb-xs flex h-(--size-touch) items-center gap-xxs self-start text-footnote text-ink-muted" data-testid="b.openYear" @click="$emit('year', THIS_YEAR)">
            The whole year<UiIcon name="chevron" :size="13" />
          </button>
        </div>
      </section>

      <!-- Lately: every book together, day by day. -->
      <section id="lately" class="flex flex-col gap-md" data-testid="b.lately">
        <h2 class="eyebrow">Lately</h2>
        <p class="prose text-callout">You read on {{ lately.read }} of the last 21 days, about {{ lately.perDay }} pages at a time.</p>
        <ProgressSpark :amounts="together" size="lg" label="Pages read on each of the last three weeks" />
      </section>

      <!-- Years before. -->
      <section id="years" class="flex flex-col gap-md" data-testid="b.years">
        <h2 class="eyebrow">Years</h2>
        <div class="-mx-screen flex gap-ms overflow-x-auto px-screen pb-md">
          <button
            v-for="y in past"
            :key="y.year"
            type="button"
            class="year relative flex shrink-0 flex-col gap-sm overflow-hidden rounded-lg bg-surface-raised p-inset text-left shadow-raised edge-faint"
            :data-testid="`b.year.${y.year}`"
            @click="$emit('year', y.year as number)"
          >
            <UiAmbient :colors="y.favourite?.book.colors ?? null" shape="card" />
            <span class="relative flex items-start justify-between gap-sm">
              <span class="flex flex-col gap-xs">
                <span class="text-figure tabular-nums">{{ y.year }}</span>
                <span class="text-body text-ink-muted">{{ plural(y.books, 'book') }}</span>
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

      <!-- The five-star shelf. -->
      <section id="fives" class="flex flex-col gap-sm" data-testid="b.fives">
        <div class="flex items-baseline justify-between">
          <h2 class="eyebrow">Five stars</h2>
          <span class="figures text-meta text-ink-faint">{{ all.fives.length }}</span>
        </div>
        <div class="-mx-screen flex gap-ms overflow-x-auto px-screen pt-xs pb-md">
          <UiCover
            v-for="r in all.fives"
            :key="r.id"
            class="shrink-0"
            :title="r.book.title"
            :authors="r.book.authors"
            :src="coverSrc(r.book.cover, 'md')"
            :thumbhash="r.book.thumbhash"
            :colors="r.book.colors"
            size="md"
          />
        </div>
      </section>

      <!-- Authors you come back to. -->
      <section id="authors" class="flex flex-col gap-xs" data-testid="b.authors">
        <h2 class="eyebrow mb-xs">Authors you come back to</h2>
        <div v-for="a in all.authors.slice(0, 4)" :key="a.name" class="flex items-center gap-md py-xs">
          <span class="fan relative flex shrink-0" aria-hidden="true">
            <UiCover
              v-for="(b, i) in a.books.slice(-3).reverse()"
              :key="b.key"
              :style="{ '--i': i }"
              :title="b.title"
              :authors="b.authors"
              :src="coverSrc(b.cover, 'sm')"
              :thumbhash="b.thumbhash"
              :colors="b.colors"
              size="sm"
            />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="truncate text-body">{{ a.name }}</span>
            <span class="figures text-meta text-ink-faint">{{ plural(a.count, 'book') }}<template v-if="a.rating"> · ★ {{ average(a.rating) }}</template></span>
          </span>
        </div>
      </section>

      <!-- A few quiet facts. -->
      <section id="facts" class="flex flex-col gap-sm" data-testid="b.facts">
        <h2 class="eyebrow">And</h2>
        <p class="prose text-callout text-ink-muted">
          You read <em>{{ all.rereads.map((r) => r.book.title).join(', ').replace(/, ([^,]*)$/, ' and $1') }}</em> a second time.
        </p>
        <p class="prose text-callout text-ink-muted">You put down one book, <em>{{ all.abandoned[0]?.book.title }}</em>, {{ all.abandoned[0]?.days === 1 ? 'after a day' : `after ${all.abandoned[0]?.days} days` }}.</p>
        <p class="prose text-callout text-ink-muted">{{ n(wantToRead.length) }} more are waiting on Want to read.</p>
      </section>

      <ProtoProfileAccount />
    </main>
  </div>
</template>

<style scoped>
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
.prose {
  font-family: var(--font-serif);
  text-wrap: pretty;
}
.prose em {
  font-style: italic;
}
.year {
  width: calc(var(--size-cover-xl) * 1.6);
  min-height: calc(var(--size-cover-xl) * 1.2);
}
.fan {
  width: calc(var(--size-cover-sm) + 2 * var(--spacing-ms));
}
.fan > * {
  position: relative;
  z-index: calc(3 - var(--i));
}
.fan > * + * {
  margin-left: calc(var(--spacing-ms) - var(--size-cover-sm));
}
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>

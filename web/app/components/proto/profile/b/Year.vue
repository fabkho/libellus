<script setup lang="ts">
// Direction B: a year in review, pushed from the profile. The year large, in a
// sentence; its books month by month as rows of covers (an empty month is
// just a dash, nothing to make up for); the favourite, lit; a few records;
// and the years either side.
import { YEARS, average, dayMonth, finishedIn, monthShort, n, plural, statsOf } from '../model'

const props = defineProps<{ year: number }>()
defineEmits<{ back: []; year: [year: number] }>()

const stats = computed(() => statsOf(props.year))
const reads = computed(() => finishedIn(props.year).reverse())
const months = computed(() => Array.from({ length: 12 }, (_, m) => reads.value.filter((r) => Number(r.ended!.slice(5, 7)) === m + 1)))
const before = computed(() => YEARS.find((y) => y < props.year) ?? null)
const after = computed(() => [...YEARS].reverse().find((y) => y > props.year) ?? null)
const top = computed(() => stats.value.authors[0] ?? null)
</script>

<template>
  <div class="relative min-h-dvh clear-tab-bar" data-testid="b.yearPage">
    <UiAmbient :colors="stats.favourite?.book.colors ?? null" />
    <UiTopBar back-label="Back" back-testid="b.yearBack" @back="$emit('back')" />

    <section class="relative flex flex-col items-center px-xl pt-md text-center">
      <p class="eyebrow">Your year in books</p>
      <h1 class="big mt-sm tabular-nums" data-testid="b.yearTitle">{{ year }}</h1>
      <p class="prose mt-sm text-headline">{{ plural(stats.books, 'book') }}, {{ n(stats.pages) }} pages.</p>
      <p class="figures mt-xs text-meta text-ink-faint">★ {{ average(stats.average) }} on average<template v-if="stats.unrated"> · {{ stats.unrated }} not rated yet</template></p>
    </section>

    <main class="relative flex flex-col gap-xl px-screen pt-xl">
      <section id="months" class="flex flex-col" data-testid="b.months">
        <div v-for="(list, m) in months" :key="m" class="month flex items-center gap-md py-xs">
          <span class="eyebrow w-(--size-touch) shrink-0">{{ monthShort(m) }}</span>
          <span v-if="list.length" class="flex flex-wrap gap-xs">
            <UiCover
              v-for="r in list"
              :key="r.id"
              :title="r.book.title"
              :authors="r.book.authors"
              :src="coverSrc(r.book.cover, 'sm')"
              :thumbhash="r.book.thumbhash"
              :colors="r.book.colors"
              size="sm"
            />
          </span>
          <span v-else class="text-ink-ghost">—</span>
        </div>
      </section>

      <section v-if="stats.favourite" id="favourite" class="relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint" data-testid="b.favourite">
        <UiAmbient :colors="stats.favourite.book.colors" shape="card" />
        <span class="eyebrow relative">The favourite</span>
        <UiCover
          class="relative"
          :title="stats.favourite.book.title"
          :authors="stats.favourite.book.authors"
          :src="coverSrc(stats.favourite.book.cover, 'lg')"
          :thumbhash="stats.favourite.book.thumbhash"
          :colors="stats.favourite.book.colors"
          size="lg"
          glow
        />
        <span class="relative flex flex-col items-center gap-xs">
          <span class="book-title text-book-title">{{ stats.favourite.book.title }}</span>
          <span class="text-body text-ink-muted">{{ stats.favourite.book.authors[0] }}</span>
          <UiStars :quarters="stats.favourite.rating" size="md" />
        </span>
      </section>

      <section id="records" class="flex flex-col gap-sm" data-testid="b.records">
        <h2 class="eyebrow">Also</h2>
        <p v-if="stats.longest" class="prose text-callout text-ink-muted">
          The longest was <em>{{ stats.longest.book.title }}</em>, {{ n(stats.longest.pages!) }} pages; the shortest <em>{{ stats.shortest?.book.title }}</em>, {{ n(stats.shortest!.pages!) }}.
        </p>
        <p v-if="stats.fastest" class="prose text-callout text-ink-muted">
          <em>{{ stats.fastest.book.title }}</em> went quickest, {{ stats.fastest.days === 1 ? 'in a day' : `in ${stats.fastest.days} days` }} ({{ dayMonth(stats.fastest.ended!) }}).
        </p>
        <p v-if="top" class="prose text-callout text-ink-muted">You read {{ top.name }} most: {{ plural(top.count, 'book') }}.</p>
        <p v-if="stats.abandoned.length" class="prose text-callout text-ink-muted">One you put down: <em>{{ stats.abandoned[0]!.book.title }}</em>.</p>
      </section>

      <nav class="flex items-center justify-between border-t-(length:--stroke-hairline) border-hairline-strong pt-sm" aria-label="Other years">
        <UiButton v-if="before" tone="plain" size="sm" class="-ml-sm" :data-testid="`b.yearBefore`" @click="$emit('year', before)">
          <UiIcon name="back" :size="15" />{{ before }}
        </UiButton>
        <span v-else />
        <UiButton v-if="after" tone="plain" size="sm" class="-mr-sm" data-testid="b.yearAfter" @click="$emit('year', after)">
          {{ after }}<UiIcon name="chevron" :size="15" />
        </UiButton>
      </nav>
    </main>
  </div>
</template>

<style scoped>
.big {
  font-size: calc(var(--text-figure) * 2);
  line-height: 1;
  font-weight: var(--font-weight-light);
  letter-spacing: var(--text-figure--letter-spacing);
}
.prose {
  font-family: var(--font-serif);
  text-wrap: pretty;
}
.prose em {
  font-style: italic;
}
.month + .month {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

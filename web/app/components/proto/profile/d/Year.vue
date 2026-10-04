<script setup lang="ts">
// Direction D: a year in review, full screen (B's), in figures instead of
// sentences: the year large, A's four figures, the books month by month as
// rows of covers (an empty month is a dash), the favourite lit, the ratings,
// A's records, the authors, A's small figures, and the years either side.
import { YEARS, monthShort, statsOf, finishedIn } from '../model'

const props = defineProps<{ year: number }>()
defineEmits<{ back: []; year: [year: number] }>()

const stats = computed(() => statsOf(props.year))
const reads = computed(() => finishedIn(props.year).reverse())
const months = computed(() => Array.from({ length: 12 }, (_, m) => reads.value.filter((r) => Number(r.ended!.slice(5, 7)) === m + 1)))
const before = computed(() => YEARS.find((y) => y < props.year) ?? null)
const after = computed(() => [...YEARS].reverse().find((y) => y > props.year) ?? null)
</script>

<template>
  <div class="relative min-h-dvh clear-tab-bar" data-testid="d.yearPage">
    <UiAmbient :colors="stats.favourite?.book.colors ?? null" />
    <UiTopBar back-label="Back" back-testid="d.yearBack" @back="$emit('back')" />

    <section class="relative flex flex-col items-center px-xl pt-md text-center">
      <p class="eyebrow">Your year in books</p>
      <h1 class="big mt-sm tabular-nums" data-testid="d.yearTitle">{{ year }}</h1>
    </section>

    <main class="relative flex flex-col gap-xl px-screen pt-lg">
      <ProtoProfileFigures :stats="stats" />

      <section id="months" class="flex flex-col" data-testid="d.yearMonths">
        <div v-for="(list, m) in months" :key="m" class="month flex items-center gap-md py-xs">
          <span class="eyebrow w-(--size-touch) shrink-0">{{ monthShort(m) }}</span>
          <span v-if="list.length" class="flex min-w-0 flex-1 flex-wrap gap-xs">
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
          <span v-else class="flex-1 text-ink-ghost">—</span>
          <span class="figures w-(--size-button-sm) shrink-0 text-right text-meta" :class="list.length ? 'text-ink-muted' : 'text-ink-ghost'">{{ list.length || '' }}</span>
        </div>
      </section>

      <section v-if="stats.favourite" id="favourite" class="relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint" data-testid="d.favourite">
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

      <section id="ratings" class="flex flex-col gap-md">
        <div class="flex items-baseline justify-between">
          <h2 class="eyebrow">Ratings</h2>
          <span class="figures text-meta text-ink-faint">{{ stats.rated }} rated<template v-if="stats.unrated"> · {{ stats.unrated }} not yet</template></span>
        </div>
        <ProtoProfileStarBars :stats="stats" />
      </section>

      <ProtoProfileRecords :stats="stats" />

      <ProtoProfileAuthors :stats="stats" :limit="3" />

      <ProtoProfileAlso :stats="stats" :want="false" />

      <nav class="flex items-center justify-between" aria-label="Other years">
        <UiButton v-if="before" tone="plain" size="sm" class="-ml-sm" data-testid="d.yearBefore" @click="$emit('year', before)">
          <UiIcon name="back" :size="15" />{{ before }}
        </UiButton>
        <span v-else />
        <UiButton v-if="after" tone="plain" size="sm" class="-mr-sm" data-testid="d.yearAfter" @click="$emit('year', after)">
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
.month + .month {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

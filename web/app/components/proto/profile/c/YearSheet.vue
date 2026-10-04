<script setup lang="ts">
// Direction C: a year's review in a sheet, over the Library (from a year's
// column or its pinned header, or Home's tally). Three figures, the months,
// how the ratings fell, the records, the author read most, and — for this
// year — the days read lately. Done closes it; nothing to set.
import { THIS_YEAR, average, monthLetter, n, plural, readingDaysSummary, short, statsOf, TODAY } from '../model'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ year: number }>()

const stats = computed(() => statsOf(props.year))
const lit = computed(() => (props.year === THIS_YEAR ? Number(TODAY.slice(5, 7)) - 1 : null))
const lately = readingDaysSummary(30)
const top = computed(() => stats.value.authors[0] ?? null)
const records = computed(() =>
  [
    stats.value.favourite && { label: 'Favourite', read: stats.value.favourite, figure: `★ ${average(stats.value.favourite.rating)}` },
    stats.value.longest && { label: 'Longest', read: stats.value.longest, figure: `${n(stats.value.longest.pages!)} p.` },
    stats.value.fastest && { label: 'Quickest', read: stats.value.fastest, figure: plural(stats.value.fastest.days!, 'day') },
  ].filter((r): r is NonNullable<typeof r> => Boolean(r)),
)

</script>

<template>
  <UiSheet v-model:open="open" :title="String(year)" testid="cYear" action="Done" @action="open = false">
    <div class="flex flex-col gap-lg">
      <section class="grid grid-cols-3 border-b-(length:--stroke-hairline) border-hairline-strong pb-md">
        <div class="flex flex-col gap-xs">
          <span class="eyebrow">Books</span><span class="text-figure tabular-nums">{{ stats.books }}</span>
        </div>
        <div class="flex flex-col gap-xs">
          <span class="eyebrow">Pages</span><span class="text-figure tabular-nums">{{ short(stats.pages) }}</span>
        </div>
        <div class="flex flex-col gap-xs">
          <span class="eyebrow">Average</span><span class="text-figure tabular-nums">{{ average(stats.average) }}</span>
        </div>
      </section>

      <section class="flex flex-col gap-sm">
        <h3 class="eyebrow">By month</h3>
        <ProtoProfileBars :values="stats.months" :labels="Array.from({ length: 12 }, (_, m) => monthLetter(m))" :lit="lit" testid="c.months" />
      </section>

      <section v-if="year === THIS_YEAR" class="flex flex-col gap-xs">
        <h3 class="eyebrow">Lately</h3>
        <p class="text-subhead text-ink-muted">
          <span class="figures text-ink">{{ lately.read }}</span> reading days in the last 30, about <span class="figures text-ink">{{ lately.perDay }}</span> pages each.
        </p>
      </section>

      <section class="flex flex-col gap-sm">
        <div class="flex items-baseline justify-between">
          <h3 class="eyebrow">Ratings</h3>
          <span class="figures text-meta text-ink-faint">{{ stats.unrated ? `${stats.unrated} not rated` : `${stats.rated} rated` }}</span>
        </div>
        <ProtoProfileStarBars :stats="stats" />
      </section>

      <section class="flex flex-col">
        <h3 class="eyebrow">Of note</h3>
        <ProtoProfileBookRow v-for="r in records" :key="r.label" :book="r.read.book" :label="r.label" :figure="r.figure" />
      </section>

      <p class="text-subhead text-ink-muted">
        <template v-if="top">Most read: <span class="text-ink">{{ top.name }}</span>, {{ plural(top.count, 'book') }}. </template>
        <template v-if="stats.rereads.length">{{ plural(stats.rereads.length, 'book') }} read again. </template>
        <template v-if="stats.abandoned.length">{{ stats.abandoned.length }} not finished.</template>
        <template v-if="stats.medianDays"> Usually {{ stats.medianDays }} days from start to finish.</template>
      </p>
    </div>
  </UiSheet>
</template>

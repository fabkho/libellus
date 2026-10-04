<script setup lang="ts">
// Design round #78: A's records — longest, shortest, quickest, took its time —
// as Library rows with the label over the title and the figure on the right.
import { n, plural, type Stats } from './model'

const props = defineProps<{ stats: Stats }>()
const records = computed(() =>
  [
    props.stats.longest && { label: 'Longest', read: props.stats.longest, figure: `${n(props.stats.longest.pages!)} p.` },
    props.stats.shortest && { label: 'Shortest', read: props.stats.shortest, figure: `${n(props.stats.shortest.pages!)} p.` },
    props.stats.fastest && { label: 'Quickest', read: props.stats.fastest, figure: plural(props.stats.fastest.days!, 'day') },
    props.stats.slowest && { label: 'Took its time', read: props.stats.slowest, figure: plural(props.stats.slowest.days!, 'day') },
  ].filter((r): r is NonNullable<typeof r> => Boolean(r)),
)
</script>

<template>
  <section id="records" class="flex flex-col" data-testid="proto.records">
    <h2 class="eyebrow mb-xs">Records</h2>
    <ProtoProfileBookRow v-for="r in records" :key="r.label" :book="r.read.book" :label="r.label" :figure="r.figure" />
  </section>
</template>

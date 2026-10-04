<script setup lang="ts">
// A year's records (issue #78, A's): the longest and the shortest Book, the
// quickest read and the one that took its time — each a Library row with the
// label over the title and the figure at the right, opening its book page.
import type { YearFigures } from '~/data/stats'

const props = defineProps<{ figures: YearFigures }>()
const { t } = useI18n()
const { count } = useFigures()

const records = computed(() => {
  const f = props.figures
  return [
    f.longest && { key: 'longest', read: f.longest, figure: t('profile.records.pages', { count: count(f.longest.pages!) }) },
    f.shortest && { key: 'shortest', read: f.shortest, figure: t('profile.records.pages', { count: count(f.shortest.pages!) }) },
    f.quickest && { key: 'quickest', read: f.quickest, figure: t('profile.records.days', { count: count(f.quickest.days!) }, f.quickest.days!) },
    f.slowest && { key: 'slowest', read: f.slowest, figure: t('profile.records.days', { count: count(f.slowest.days!) }, f.slowest.days!) },
  ].filter((r) => !!r)
})
</script>

<template>
  <section v-if="records.length" id="records" class="flex flex-col" data-testid="profile.records">
    <h2 class="eyebrow mb-xs">{{ t('profile.records.title') }}</h2>
    <ProfileReadRow v-for="r in records" :key="r.key" :read="r.read" :label="t(`profile.records.${r.key}`)" :figure="r.figure" :data-testid="`profile.record.${r.key}`" />
  </section>
</template>

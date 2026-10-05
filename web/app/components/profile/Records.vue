<script setup lang="ts">
// A year's records (issue #78, A's): the longest and the shortest Book, the
// quickest read and the one that took its time — each a Library row with the
// label over the title and the figure at the right, opening its book page.
// While the reading record loads (`figures` null) four rows of placeholders
// stand where they will be, a cover's box and the lines of text, in the
// loading wave (docs/MOTION.md, Loading).
import type { YearFigures } from '~/data/stats'

const props = defineProps<{ figures: YearFigures | null }>()
const { t } = useI18n()
const { count } = useFigures()
const arriving = useArrival(() => !props.figures)

const records = computed(() => {
  const f = props.figures
  if (!f) return []
  return [
    f.longest && { key: 'longest', read: f.longest, figure: t('profile.records.pages', { count: count(f.longest.pages!) }) },
    f.shortest && { key: 'shortest', read: f.shortest, figure: t('profile.records.pages', { count: count(f.shortest.pages!) }) },
    f.quickest && { key: 'quickest', read: f.quickest, figure: t('profile.records.days', { count: count(f.quickest.days!) }, f.quickest.days!) },
    f.slowest && { key: 'slowest', read: f.slowest, figure: t('profile.records.days', { count: count(f.slowest.days!) }, f.slowest.days!) },
  ].filter((r) => !!r)
})
</script>

<template>
  <section v-if="!figures || records.length" id="records" class="flex flex-col" data-testid="profile.records">
    <h2 class="eyebrow mb-xs">{{ t('profile.records.title') }}</h2>
    <template v-if="!figures">
      <ProfileRowPlaceholder v-for="i in 4" :key="i" :wave="(i - 1) * 0.15" label figure />
    </template>
    <template v-else>
      <ProfileReadRow
        v-for="r in records"
        :key="r.key"
        :class="{ arrive: arriving }"
        :read="r.read"
        :label="t(`profile.records.${r.key}`)"
        :figure="r.figure"
        :data-testid="`profile.record.${r.key}`"
      />
    </template>
  </section>
</template>

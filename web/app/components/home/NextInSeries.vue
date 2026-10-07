<script setup lang="ts">
// "Next in your series" on Home (#167): for a series she finished a Book of,
// the next one she has not started — a quiet list of up to three, the most
// recent finish first, each with its place ("Book 4 · City Watch"), her status
// (Want to read) or "+ Want to read", opening its Book's page. Only when there
// is one; one she is reading already is a card higher up, so it is left out
// (utils/enrich.ts, upNextInSeries). The last section of Home, so appearing
// after the lists moves nothing; kept on the device, so it is there at once
// (offline too) the next time.
import { useLibraryStore } from '~/stores/library'
import { useSeriesStore } from '~/stores/series'

const { t } = useI18n()
const series = useSeriesStore()
const library = useLibraryStore()

const items = computed(() => upNextInSeries(series.next))
const placeOf = (position: number | undefined, name: string) => {
  const n = positionText(position)
  return n ? t('series.nextPlace', { n, name }) : name
}

// Asked when it mounts (Home shows it once the Library is there) and each time Home is shown again.
let justMounted = false
onMounted(() => {
  justMounted = true
  void series.loadNext()
  void nextTick(() => (justMounted = false))
})
onActivated(() => {
  if (!justMounted) void series.loadNext()
})
// A Book finished (or started) elsewhere: what comes next changes.
watch(
  () => library.finished.length + library.reading.length,
  () => void series.loadNext(),
)
</script>

<template>
  <section v-if="items.length" data-testid="home.nextInSeries">
    <div class="flex h-(--size-touch) items-center">
      <h2 class="eyebrow">{{ t('series.next') }}</h2>
    </div>
    <ul :aria-label="t('series.next')">
      <AuthorWorkRow
        v-for="(item, index) in items"
        :key="item.series.id"
        :work="item.next"
        :place="placeOf(item.next.position, item.series.name)"
        testid="home.next"
        :year="false"
        :eager="index < 3"
      />
    </ul>
  </section>
</template>

<script setup lang="ts">
// One series she has started, as Home's "Next in your series" and its sheet list
// it: the next work open in it — its cover, its title, where it stands in the
// series ("Book 3 of 10 · Discworld") — and her status of it, or "+ Want to read"
// (AuthorWorkRow, which opens the Book's page and adds from the row). The key of
// the list is the series and its next work, so a series whose next work changed
// (she finished the one it offered) is a row leaving and a row arriving. The "..."
// after it opens the series' small menu (Mute series; HomeNextMenu, hosted by the
// section): a button of its own, 44 pt, never a swipe, which the sheet's swipe-down
// and iOS's Back-swipe would fight.
import type { StartedSeries } from '~/data/enrich'

const props = defineProps<{ item: StartedSeries; testid: string; eager?: boolean }>()
const emit = defineEmits<{ more: [item: StartedSeries] }>()

const { t } = useI18n()
const place = computed(() => {
  const name = props.item.series.name
  const at = nextPlace(props.item)
  if (!at) return name
  return at.count ? t('series.nextPlaceOf', { n: at.n, count: at.count, name }) : t('series.nextPlace', { n: at.n, name })
})
</script>

<template>
  <AuthorWorkRow :work="item.next" :place="place" :testid="testid" :year="false" :eager="eager">
    <template #trailing>
      <button
        type="button"
        class="relative -mr-sm flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint hover:text-ink"
        aria-haspopup="dialog"
        :aria-label="t('series.moreLabel', { name: item.series.name })"
        :data-testid="`${testid}Menu`"
        @click="emit('more', item)"
      >
        <UiIcon name="more" :size="20" />
      </button>
    </template>
  </AuthorWorkRow>
</template>

<script setup lang="ts">
// Every series she has started and not finished, in a sheet (Home's "See more",
// when there are more than the five the section lists): the same rows, the
// latest activity first, the sheet's body scrolling when they are many. Modelled
// on Home's tally sheet (HomeTallySheet): a plain `UiSheet` with its own test
// IDs. A row opens its Book's page, which closes the sheet; "+ Want to read" opens
// the Add sheet over this one, and her status takes the button's place when it
// has fallen away.
import type { StartedSeries } from '~/data/enrich'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ items: readonly StartedSeries[] }>()

const { t } = useI18n()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('series.started')" testid="homeSeries">
    <ul :aria-label="t('series.started')" data-testid="homeSeries.list">
      <HomeNextRow v-for="item in items" :key="`${item.series.id}:${item.next.workId ?? item.next.title}`" :item="item" testid="homeSeries.row" />
    </ul>
  </UiSheet>
</template>

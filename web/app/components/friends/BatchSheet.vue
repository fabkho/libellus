<script setup lang="ts">
// A batch, opened (social v1, §C 16): the Books of "Clara finished 3 books" in a sheet, the member
// and the count in its title, the day as its eyebrow, each Book as the feed's row without the avatar
// line repeated. A row opens its Book's page, which closes the sheet; Back from the Book opens it
// again as it was left (`restore`, components/ui/Sheet.vue).
import type { FeedRow } from '~/data/feed'
import type { SheetRestore } from '~/composables/useSheetRestore'

type Batch = Extract<FeedRow, { type: 'batch' }>

const open = defineModel<boolean>('open', { required: true })
defineProps<{ batch: Batch; dayLabel: string; restore?: SheetRestore | null }>()

const { t } = useI18n()
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('feed.batchTitle', { name: batch.member.name?.trim() || t('member.someone'), count: batch.entries.length })"
    testid="friendsBatch"
    :restore="restore"
  >
    <p class="eyebrow pb-xs" data-testid="friendsBatch.day">{{ dayLabel }}</p>
    <ul class="flex flex-col divide-y divide-hairline" data-testid="friendsBatch.list">
      <FriendsFeedRow v-for="entry in batch.entries" :key="entry.id" :entry="entry" bare testid="friendsBatch.row" />
    </ul>
  </UiSheet>
</template>

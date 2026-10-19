<script setup lang="ts">
// A batch, opened (social v1, §C 16): the Books of "Clara finished 3 books" in a sheet, the member
// and the count in its title, the day as its eyebrow, each Book as the feed's row without the avatar
// line repeated. A row opens its Book's page, which closes the sheet; Back from the Book opens it
// again as it was left (`restore`, `UiSheet`).
//
// Home's Your friends opens it for a member's row too (social v2a): the reads her sentence names. Of one kind (a
// feed batch's, or "finished A and B") it is the same sheet; of several (`kind: null`: "started A, added B to Want
// to read") the title is her name alone and each row says what she did, with her avatar and name (which open her
// page) as in the feed.
import type { FeedBatchView } from '~/data/feed'
import type { SheetRestore } from '#ui/utils/sheetRestore'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ batch: FeedBatchView; dayLabel: string; restore?: SheetRestore | null }>()

const { t } = useI18n()
const name = computed(() => props.batch.member.name?.trim() || t('member.someone'))
const title = computed(() => (props.batch.kind ? t('feed.batchTitle', { name: name.value, count: props.batch.entries.length }) : name.value))
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="title"
    testid="friendsBatch"
    :restore="restore"
  >
    <p class="eyebrow pb-xs" data-testid="friendsBatch.day">{{ dayLabel }}</p>
    <ul class="flex flex-col divide-y divide-hairline" data-testid="friendsBatch.list">
      <FriendsFeedRow v-for="entry in batch.entries" :key="entry.id" :entry="entry" :bare="batch.kind !== null" testid="friendsBatch.row" />
    </ul>
  </UiSheet>
</template>

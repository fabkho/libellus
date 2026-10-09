<script setup lang="ts">
// Three or more of one kind by one member on one day (social v1, §C 16), folded into one row: a fan
// of up to three of the covers, her avatar and name, what she did to how many ("finished 3 books"),
// and a chevron. A tap opens the batch's sheet (FriendsBatchSheet), which lists the Books; the
// row itself opens nothing else. `dayLabel` is Home's day word at the line's end.
import type { FeedRow } from '~/data/feed'

type Batch = Extract<FeedRow, { type: 'batch' }>

const props = defineProps<{ batch: Batch; testid: string; dayLabel?: string | null; eager?: boolean }>()
defineEmits<{ open: [] }>()

const { t } = useI18n()
const name = computed(() => props.batch.member.name?.trim() || t('member.someone'))
const covers = computed(() => props.batch.entries.slice(0, 3))
const what = computed(() => t(`feed.${feedBatchKey(props.batch.kind)}`, { count: props.batch.entries.length }))
</script>

<template>
  <li :data-testid="testid">
    <button
      type="button"
      class="batch flex w-full items-center gap-ml py-ms text-left"
      aria-haspopup="dialog"
      :aria-label="`${name} ${what}`"
      :data-testid="`${testid}Open`"
      @click="$emit('open')"
    >
      <span class="flex shrink-0" aria-hidden="true">
        <UiCover
          v-for="entry in covers"
          :key="entry.id"
          decorative
          :title="entry.book.title"
          :authors="entry.book.authors"
          :src="coverSrc(entry.book.coverUrl, 'sm')"
          :thumbhash="entry.book.coverThumbhash"
          :colors="entry.book.coverColors"
          size="sm"
          :eager="eager"
          class="cover"
        />
      </span>
      <span class="flex min-w-0 flex-1 items-start justify-between gap-sm">
        <!-- One line, as an entry's, when the sentence fits beside the name; else it drops under the avatar. -->
        <span class="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xxs text-subhead">
          <span class="flex min-w-0 items-center gap-sm">
            <FriendsAvatar :card="batch.member" />
            <span class="truncate font-medium">{{ name }}</span>
          </span>
          <span class="min-w-0 text-ink-muted">{{ what }}</span>
        </span>
        <span v-if="dayLabel" class="eyebrow shrink-0 pt-xs">{{ dayLabel }}</span>
      </span>
      <UiIcon name="chevron" :size="16" class="-ml-ml shrink-0 text-ink-ghost" />
    </button>
  </li>
</template>

<style scoped>
/* The fan: each cover a little over the one before it, three of them as wide as a feed row's cover
   (`md`), so the text column starts where an entry's does. */
.cover + .cover {
  margin-left: calc(-0.6 * var(--size-cover-sm));
}
</style>

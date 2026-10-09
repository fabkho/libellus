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
      <span class="flex min-w-0 flex-1 items-start justify-between gap-sm pr-xs">
        <!-- Always one line, the avatar, the name and the verb: a count of two digits ("added 17 to Want to read") used to
             drop under the avatar at 390 px. What does not fit is cut at the end (the verb before the name); the button's name
             above carries the whole sentence. -->
        <span class="flex min-w-0 items-center gap-sm text-subhead">
          <FriendsAvatar :card="batch.member" class="shrink-0" />
          <span class="min-w-0 truncate font-medium">{{ name }}</span>
          <span class="min-w-0 shrink-[3] truncate text-ink-muted">{{ what }}</span>
        </span>
        <span v-if="dayLabel" class="eyebrow shrink-0 pt-xs">{{ dayLabel }}</span>
      </span>
      <UiIcon name="chevron" :size="16" class="-mr-xs -ml-ml shrink-0 text-ink-ghost" />
    </button>
  </li>
</template>

<style scoped>
/* The fan: each cover mostly over the one before it, so three of them are narrower than a feed row's
   cover (`md`) and leave the text column room for a count of two digits at 390 px. */
.cover + .cover {
  margin-left: calc(-0.7 * var(--size-cover-sm));
}
</style>

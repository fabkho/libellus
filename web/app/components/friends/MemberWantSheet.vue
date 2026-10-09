<script setup lang="ts">
// Her whole Want to read (social v1, U4; *See all* under the covers): a sheet with a row per Book,
// newest first, its cover, title, author and the day she added it. A row opens the Book (which closes
// the sheet); a Manual book opens nothing.
import type { SocialBook } from '~/data/social'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ title: string; items: readonly { book: SocialBook; addedOn: string }[] }>()

const { t } = useI18n()
const { formatDay } = useDays()
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="memberWant">
    <ul class="flex flex-col pb-lg">
      <li v-for="item in items" :key="item.book.id" data-testid="memberWant.row">
        <FriendsMemberBookLink :book="item.book" class="flex items-center gap-inset py-sm active:opacity-80">
          <UiCover
            decorative
            :title="item.book.title"
            :authors="item.book.authors"
            :src="coverSrc(item.book.coverUrl, 'sm')"
            :thumbhash="item.book.coverThumbhash"
            :colors="item.book.coverColors"
            size="sm"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="book-title title-wrap text-callout">{{ item.book.title }}</span>
            <span class="truncate text-caption text-ink-muted">{{ formatAuthors(item.book.authors, t('common.etAl')) }}</span>
            <span class="figures text-meta text-ink-faint">{{ formatDay(item.addedOn) }}</span>
          </span>
        </FriendsMemberBookLink>
      </li>
    </ul>
  </UiSheet>
</template>

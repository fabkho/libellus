<script setup lang="ts">
// Her reads that were liked this week, in Home's Your circle (social v2a, contract §3): one quiet row per read,
// newest like first, above the card — a few small avatars and one sentence in muted ink: "Anna and Ben liked your
// review of *Piranesi*", "Anna and 4 others liked …", "… liked that you finished *Piranesi*" for a finish without
// a review (her own Library says which; a read it no longer holds says "liked your read of"). A tap asks who
// (`open`, the read): the likers sheet names them. This is where she sees who liked her reads: no count sits on
// them anywhere else in 2a. Drawing only; Home's section reads `stores/likes.ts` and opens the sheet.
//
// Props: `items` (RecentLike[]). Emits `open` with the item. Test ids: `home.likes` (the list), `home.like` (a row).
import type { RecentLike } from '~/data/social'
import { useLibraryStore } from '~/stores/library'
import { circleNameParts } from '~/utils/circle'

const props = defineProps<{ items: readonly RecentLike[] }>()
defineEmits<{ open: [item: RecentLike] }>()

const { t } = useI18n()
const library = useLibraryStore()
const nameOf = (card: { name: string | null }) => card.name?.trim() || t('member.someone')

/** What her Library says of the read: with a review or without; null when it does not hold that read any more. */
function reviewed(item: RecentLike): boolean | null {
  const read = library.entryForBook(item.book.id)?.latestSession
  return read?.id === item.session ? Boolean(read.review?.trim()) : null
}

const rows = computed(() =>
  props.items.map((item) => {
    const parts = circleNameParts(item.likers.map(nameOf), Math.max(0, item.count - item.likers.length))
    const had = reviewed(item)
    return {
      item,
      names: t(`social.circle.names.${parts.key}`, parts.args, parts.count),
      keypath: had === null ? 'social.likes.read' : had ? 'social.likes.reviewed' : 'social.likes.finished',
    }
  }),
)
</script>

<template>
  <ul v-if="rows.length" class="flex flex-col" data-testid="home.likes" :aria-label="t('social.likers.title')">
    <li v-for="row in rows" :key="row.item.session">
      <button type="button" class="flex min-h-(--size-touch) w-full items-center gap-ms py-xs text-left" :aria-label="`${row.names}. ${t('social.likes.open')}`" data-testid="home.like" @click="$emit('open', row.item)">
        <span class="flex shrink-0" aria-hidden="true">
          <span v-for="liker in row.item.likers.slice(0, 3)" :key="liker.id" class="face"><FriendsAvatar :card="liker" /></span>
        </span>
        <i18n-t :keypath="row.keypath" tag="span" scope="global" class="line-clamp-2 min-w-0 flex-1 text-caption text-ink-muted">
          <template #names>{{ row.names }}</template>
          <template #title><i class="book-title italic">{{ row.item.book.title }}</i></template>
        </i18n-t>
        <UiIcon name="heart" :size="14" class="shrink-0 text-accent-ink" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
/* The faces overlap, each over the one before it. */
.face + .face {
  margin-left: calc(-1 * var(--spacing-sm));
}
</style>

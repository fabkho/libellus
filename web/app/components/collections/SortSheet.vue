<script setup lang="ts">
// Sort inside a Collection (backlog #9): her own order, or the same Books by title, author, year or when
// they were put on it, as rows. A tap chooses one (the way it goes by nature: newest first, A to Z) and
// the sheet closes; a tap on the one that is chosen turns it round, as the Library's sort sheet does. The
// chosen row says which way it goes. Her own order has no direction. A view only: nothing is saved to the
// Collection.
import { collectionDir, COLLECTION_SORTS, type CollectionSort, type CollectionSortKey } from '~/data/collectionSort'

const props = defineProps<{ sort: CollectionSort }>()
const emit = defineEmits<{ choose: [sort: CollectionSort] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

/** The words for a direction: A to Z for text, oldest or newest first for years and dates. */
const dirName = (key: CollectionSortKey, dir: CollectionSort['dir']) => t(`collection.sort.dir.${key === 'title' || key === 'author' ? 'text' : 'date'}.${dir}`)

function choose(key: CollectionSortKey) {
  const chosen = props.sort.key === key
  const dir = chosen && key !== 'order' ? (props.sort.dir === 'asc' ? 'desc' : 'asc') : collectionDir(key)
  emit('choose', { key, dir })
  open.value = false
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('collection.sort.title')" testid="collectionSort">
    <UiRowGroup>
      <UiRow
        v-for="key in COLLECTION_SORTS"
        :key="key"
        as="button"
        :label="t(`collection.sort.key.${key}`)"
        :aria-pressed="sort.key === key"
        :data-testid="`collectionSort.${key}`"
        @click="choose(key)"
      >
        <template v-if="sort.key === key">
          <template v-if="key === 'order'">
            <UiIcon name="check" :size="15" bold class="shrink-0 text-accent-ink" />
          </template>
          <template v-else>
            <span class="text-caption text-ink-muted" :data-testid="`collectionSort.${key}.dir`">{{ dirName(key, sort.dir) }}</span>
            <UiIcon name="down" :size="15" bold class="shrink-0 text-accent-ink transition-transform duration-(--duration-quick) ease-standard" :class="sort.dir === 'asc' && 'rotate-180'" />
          </template>
        </template>
      </UiRow>
    </UiRowGroup>
  </UiSheet>
</template>

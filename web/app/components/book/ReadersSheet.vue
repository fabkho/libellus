<script setup lang="ts">
// All the readers of a Book she follows (social v2a, contract §1.5; *See all* on the Book page's Readers): a sheet
// with every row in the section's order, read in pages of `READERS_PAGE` from the start when it opens, *Show more*
// at the foot while there is a next page. Offline the rows the session already has stay; with none, the sheet
// says nothing but its title. Test ids: `bookReaders` (the sheet), `bookReaders.row`, `bookReaders.more`,
// `bookReaders.empty`.
import { useBookReadersStore } from '~/stores/bookReaders'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ bookId: string; title: string }>()

const { t } = useI18n()
const readers = useBookReadersStore()
const online = useOnline()

const per = computed(() => readers.of(props.bookId))
const rows = computed(() => (per.value.allLoaded ? per.value.all : per.value.top))
const busy = computed(() => Boolean(readers.loadingMore[props.bookId]))

watch(open, (now) => now && void readers.loadAll(props.bookId))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('book.readers.sheetTitle')" testid="bookReaders">
    <ul class="flex flex-col pb-lg">
      <li v-for="reader in rows" :key="reader.member.id" class="row">
        <BookReaderRow :reader="reader" :title="title" testid="bookReaders.row" />
      </li>
    </ul>
    <p v-if="busy && rows.length === 0" class="py-ml text-center text-caption text-ink-faint" role="status" data-testid="bookReaders.empty">{{ t('book.readers.loadingMore') }}</p>
    <div v-if="per.next" class="flex justify-center pb-lg">
      <UiButton tone="quiet" size="sm" :disabled="busy" :offline="!online" data-testid="bookReaders.more" @click="readers.loadMore(bookId)">
        {{ t('book.readers.more') }}
      </UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>

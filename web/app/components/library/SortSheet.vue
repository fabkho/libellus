<script setup lang="ts">
// Sort (issue #169): the orders a Status list offers, as rows. A tap chooses one (the way it
// goes by nature: newest first, highest first, A to Z) and the sheet closes; a tap on the one
// that is chosen turns it round, as Files does. The chosen row says which way it goes.
import { naturalDir, SORTS, sortFor, type Sort, type SortKey } from '~/data/libraryView'
import type { EntryStatus } from '~/data/library'

const props = defineProps<{ status: EntryStatus; sort: Sort }>()
const emit = defineEmits<{ choose: [sort: Sort] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const current = computed(() => sortFor(props.status, props.sort))
/** What the sort by date is called where the read is still open. */
const nameOf = (key: SortKey) => t(`library.view.sortKey.${key === 'dateRead' && props.status === 'reading' ? 'dateStarted' : key}`)

function choose(key: SortKey) {
  const dir = current.value.key === key ? (current.value.dir === 'asc' ? 'desc' : 'asc') : naturalDir(key)
  emit('choose', { key, dir })
  open.value = false
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('library.view.sortTitle')" testid="librarySort">
    <UiRowGroup>
      <UiRow
        v-for="key in SORTS[status]"
        :key="key"
        as="button"
        :label="nameOf(key)"
        :aria-pressed="current.key === key"
        :data-testid="`librarySort.${key}`"
        @click="choose(key)"
      >
        <template v-if="current.key === key">
          <span class="text-caption text-ink-muted" :data-testid="`librarySort.${key}.dir`">{{ t(`library.view.sortDir.${key}.${current.dir}`) }}</span>
          <UiIcon name="down" :size="15" bold class="shrink-0 text-accent-ink transition-transform duration-(--duration-quick) ease-standard" :class="current.dir === 'asc' && 'rotate-180'" />
        </template>
      </UiRow>
    </UiRowGroup>
  </UiSheet>
</template>

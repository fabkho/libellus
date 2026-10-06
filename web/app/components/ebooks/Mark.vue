<script setup lang="ts">
// The quiet mark of a Book whose ebook is on this device (issue #131): a small
// ebook icon in faint ink beside the author, on the Library's rows and cards
// and Home's reading cards. Nothing else changes on the card; the book page
// says more. Named for assistive technology, hidden from nobody.
import type { LibraryEntry } from '~/data/library'
import { useEbooksStore } from '~/stores/ebooks'

const props = defineProps<{ entry: LibraryEntry; testid: string }>()

const { t } = useI18n()
const ebooks = useEbooksStore()
const linked = computed(() => ebooks.linkFor(props.entry) !== null)
</script>

<template>
  <span v-if="linked" class="inline-flex shrink-0 items-center text-ink-faint" :title="t('ebooks.mark')" :data-testid="testid">
    <UiIcon name="ebook" :size="13" />
    <span class="sr-only">{{ t('ebooks.mark') }}</span>
  </span>
</template>

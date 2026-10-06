<script setup lang="ts">
// An ebook file that waits for the member (issue #131, *Unlinked ebooks*): its
// own cover (from the file), its title and author as the file says them, the
// file's name in mono, and why it waits: several of her Books could be it
// (Choose book opens them in a sheet), or none is in her Library yet (Find book
// opens search with the title and author typed in; the Book she adds is linked
// to the file). Ignore deletes the copy and never offers the file again.
import type { EbookRecord } from '~/data/ebooks/ebooks'
import { useEbooksStore } from '~/stores/ebooks'

const props = defineProps<{ record: EbookRecord }>()

const { t } = useI18n()
const ebooks = useEbooksStore()
const candidates = computed(() => ebooks.candidatesOf(props.record).length)
const title = computed(() => props.record.metadata.title || t('ebooks.untitled'))
</script>

<template>
  <li class="flex gap-inset py-sm" data-testid="ebooks.waiting">
    <UiCover decorative :title="title" :authors="record.metadata.authors" :src="ebooks.coverOf(record)" size="sm" />
    <div class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span class="book-title title-wrap text-body-large" data-testid="ebooks.waitingTitle">{{ title }}</span>
      <span v-if="record.metadata.authors.length" class="truncate text-caption text-ink-muted">{{ formatAuthors(record.metadata.authors, t('common.etAl')) }}</span>
      <span class="figures truncate text-meta text-ink-faint" data-testid="ebooks.waitingFile">{{ record.name }}</span>
      <span class="text-meta text-ink-faint" data-testid="ebooks.waitingWhy">{{ candidates ? t('ebooks.couldBe', { count: candidates }, candidates) : t('ebooks.noMatch') }}</span>
      <div class="-ml-sm mt-xs flex flex-wrap items-center gap-xs">
        <UiButton v-if="candidates" tone="quiet" size="sm" data-testid="ebooks.choose" @click="ebooks.choose(record)">{{ t('ebooks.choose') }}</UiButton>
        <UiButton :tone="candidates ? 'plain' : 'quiet'" size="sm" data-testid="ebooks.find" @click="ebooks.find(record)">{{ t('ebooks.find') }}</UiButton>
        <UiButton tone="plain" size="sm" data-testid="ebooks.ignore" @click="ebooks.ignore(record)">{{ t('ebooks.ignore') }}</UiButton>
      </div>
    </div>
  </li>
</template>

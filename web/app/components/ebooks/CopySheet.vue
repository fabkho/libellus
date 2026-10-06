<script setup lang="ts">
// Another copy of a Book that has an ebook already (#131): a second file of
// Men at Arms, found by Find book (a tap on her entry) or by a scan. A small
// sheet: "Men at Arms already has an ebook", the file and the one linked now
// (their names in mono), then *Replace with this file* (the old copy is
// removed from the device) and *Keep the current one* (this file goes to
// Ignore: its copy deleted, never offered again).
import { fileAuthors, fileTitle } from '~/data/ebooks/match'
import { useEbooksStore } from '~/stores/ebooks'

const { t } = useI18n()
const ebooks = useEbooksStore()

const open = computed({
  get: () => ebooks.copyQuestion !== null,
  set: (value) => {
    if (!value) ebooks.copyQuestion = null
  },
})
// Kept while the sheet slides away.
const asked = shallowRef(ebooks.copyQuestion)
watch(
  () => ebooks.copyQuestion,
  (question) => {
    if (question) asked.value = question
  },
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('ebooks.copySheet.title', { title: asked?.entry.book.title ?? '' })" testid="ebookCopy">
    <div v-if="asked" class="flex flex-col gap-md px-xs pt-xs pb-lg">
      <UiBookLine
        :title="fileTitle(asked.record.metadata) ?? asked.record.name"
        :authors="fileAuthors(asked.record.metadata)"
        :src="ebooks.coverOf(asked.record)"
        whole
      />
      <dl class="-mt-sm flex flex-col gap-xs text-caption">
        <div class="flex min-w-0 items-baseline gap-sm">
          <dt class="eyebrow w-(--size-cover-lg) shrink-0">{{ t('ebooks.copySheet.this') }}</dt>
          <dd class="figures min-w-0 truncate text-meta text-ink-muted" data-testid="ebookCopy.file">{{ asked.record.name }}</dd>
        </div>
        <div class="flex min-w-0 items-baseline gap-sm">
          <dt class="eyebrow w-(--size-cover-lg) shrink-0">{{ t('ebooks.copySheet.current') }}</dt>
          <dd class="figures min-w-0 truncate text-meta text-ink-muted" data-testid="ebookCopy.current">{{ asked.current.name }}</dd>
        </div>
      </dl>
      <div class="flex flex-col gap-sm">
        <UiButton tone="secondary" block data-testid="ebookCopy.replace" @click="ebooks.replaceCopy()">{{ t('ebooks.copySheet.replace') }}</UiButton>
        <p class="-mt-xs text-center text-caption text-ink-faint">{{ t('ebooks.copySheet.replaceHint') }}</p>
        <UiButton tone="quiet" block data-testid="ebookCopy.keep" @click="ebooks.keepCurrent()">{{ t('ebooks.copySheet.keep') }}</UiButton>
      </div>
    </div>
  </UiSheet>
</template>

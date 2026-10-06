<script setup lang="ts">
// Which Book a waiting ebook file is (issue #131): matching found several
// Books in the Library that fit (two editions of one title), or a title
// without its author. The sheet shows the file (its own cover, title and
// author), then the candidates as rows with their covers; a tap links the
// file to that Book (one file per Book: one linked before is replaced).
import type { LibraryEntry } from '~/data/library'
import { useEbooksStore } from '~/stores/ebooks'

const { t } = useI18n()
const ebooks = useEbooksStore()

const open = computed({
  get: () => ebooks.choosing !== null,
  set: (value) => {
    if (!value) ebooks.choosing = null
  },
})
// Kept while the sheet slides away.
const record = shallowRef(ebooks.choosing)
watch(
  () => ebooks.choosing,
  (choosing) => {
    if (choosing) record.value = choosing
  },
)
const candidates = computed(() => (record.value ? ebooks.candidatesOf(record.value) : []))

function pick(entry: LibraryEntry) {
  if (record.value) void ebooks.link(record.value, entry)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('ebooks.chooseSheet.title')" testid="ebookCandidates">
    <div v-if="record" class="pt-xs pb-sm">
      <UiBookLine :title="record.metadata.title || record.name" :authors="record.metadata.authors" :src="ebooks.coverOf(record)" />
      <ul class="mt-xs flex flex-col">
        <li v-for="entry in candidates" :key="entry.id">
          <button
            type="button"
            class="flex min-h-(--size-touch) w-full items-center gap-inset rounded-md py-sm text-left active:bg-fill-strong"
            data-testid="ebookCandidates.candidate"
            @click="pick(entry)"
          >
            <UiCover
              :title="entry.book.title"
              :authors="entry.book.authors"
              :src="coverSrc(entry.book.coverUrl, 'sm')"
              :thumbhash="entry.book.coverThumbhash"
              :colors="entry.book.coverColors"
              size="sm"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-xxs">
              <span class="book-title truncate text-body-large">{{ entry.book.title }}</span>
              <span class="truncate text-caption text-ink-muted">{{ formatAuthors(entry.book.authors, t('common.etAl')) }}</span>
              <span class="figures text-meta text-ink-faint">{{ [entry.book.year, entry.book.publisher].filter(Boolean).join(' · ') }}</span>
            </span>
            <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
          </button>
        </li>
      </ul>
    </div>
  </UiSheet>
</template>

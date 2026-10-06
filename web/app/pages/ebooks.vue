<script setup lang="ts">
// Ebooks on this device (issue #131, phase 1): the EPUB files Libellus keeps a
// copy of, linked to Books in the Library. Reached from the Profile's account
// rows and from a share of EPUB files (pages/share.vue), whose result it shows
// at the top: "3 ebooks · 2 linked · 1 needs you" (and how many were not EPUBs).
//
// Then, where the browser can pick a folder (Chrome; not Safari or Firefox),
// the Ebook folder: its name (a tap picks it, or another), Scan (asks for the
// folder's permission on that tap when Android has forgotten it: never
// unasked), and the hint that Android does not let a PWA use the Download
// folder itself. Then the files that need her (Choose book, Find book,
// Ignore: components/ebooks/WaitingRow.vue) and the linked ones, each opening
// its Book; a copy the browser evicted says Missing. Nothing here is ever
// uploaded, and the footer says so. A pushed screen in the tab layout.
import { useEbooksStore } from '~/stores/ebooks'
import { useLibraryStore } from '~/stores/library'

definePageMeta({ layout: 'tabs', screen: 'ebooks', pushed: true })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ebooks = useEbooksStore()
const library = useLibraryStore()

useHead({ title: () => `${t('ebooks.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

onMounted(() => {
  // Back from Find book without adding it: nothing is being looked for any more.
  ebooks.stopFinding()
  void ebooks.load()
  if (!library.loaded) void library.load()
})

const missed = computed(() => route.query.missed !== undefined)

const report = computed(() => {
  const done = ebooks.report
  if (!done) return null
  const parts = [t('ebooks.report.total', { count: done.total }, done.total)]
  if (done.linked) parts.push(t('ebooks.report.linked', { count: done.linked }))
  if (done.needsYou) parts.push(t('ebooks.report.needsYou', { count: done.needsYou }, done.needsYou))
  return { source: done.source, line: parts.join(' · '), failed: done.failed ? t('ebooks.report.failed', { count: done.failed }, done.failed) : null }
})

const scanning = computed(() => ebooks.busy?.source === 'folder')
const scanLabel = computed(() => {
  const busy = ebooks.busy
  if (!scanning.value || !busy) return t('ebooks.folder.scan')
  return busy.total ? t('ebooks.folder.scanningCount', { done: busy.done, total: busy.total }) : t('ebooks.folder.scanning')
})

const linkedRows = computed(() =>
  ebooks.linked.map((record) => ({ record, entry: record.bookId ? library.entryForBook(record.bookId) : null, missing: ebooks.missing.has(record.id) })),
)
const empty = computed(() => ebooks.loaded && !ebooks.records.some((r) => r.state !== 'ignored') && !ebooks.folderSupported)
</script>

<template>
  <div class="relative min-h-dvh pb-xl">
    <UiTopBar :back-label="t('ebooks.back')" back-testid="ebooks.back" @back="back" />

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="ebooks.title">{{ t('ebooks.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('ebooks.intro') }}</p>
    </header>

    <div class="flex flex-col gap-lg px-screen pt-lg">
      <p v-if="missed" class="text-subhead text-ink" role="status" data-testid="ebooks.missed">{{ t('ebooks.missed') }}</p>

      <!-- What the last share or scan did. -->
      <section v-if="report" class="rounded-lg bg-surface-raised p-inset edge-faint" role="status" data-testid="ebooks.report">
        <div class="flex items-center justify-between gap-sm">
          <h2 class="eyebrow">{{ t(`ebooks.report.${report.source}`) }}</h2>
          <button type="button" class="-mr-sm min-h-(--size-touch) px-sm text-caption text-ink-muted" data-testid="ebooks.reportDismiss" @click="ebooks.clearReport()">
            {{ t('ebooks.report.dismiss') }}
          </button>
        </div>
        <p class="text-body text-ink" data-testid="ebooks.reportLine">{{ report.line }}</p>
        <p v-if="report.failed" class="mt-xxs text-caption text-ink-muted" data-testid="ebooks.reportFailed">{{ report.failed }}</p>
      </section>

      <!-- The ebook folder: Chrome only. -->
      <section v-if="ebooks.folderSupported" data-testid="ebooks.folderSection">
        <UiRowGroup>
          <UiRow
            as="button"
            icon="library"
            :label="t('ebooks.folder.label')"
            :placeholder="t('ebooks.folder.choose')"
            chevron
            :disabled="scanning"
            data-testid="ebooks.folder"
            @click="ebooks.pickFolder()"
          >
            <span v-if="ebooks.folder" class="figures truncate text-ink" data-testid="ebooks.folderName">{{ ebooks.folder.name }}</span>
          </UiRow>
        </UiRowGroup>
        <UiButton
          v-if="ebooks.folder"
          tone="secondary"
          block
          class="mt-ms"
          :disabled="scanning"
          data-testid="ebooks.scan"
          @click="ebooks.scan()"
        >
          {{ scanLabel }}
        </UiButton>
        <p v-if="ebooks.error === 'folder'" class="mt-ms text-caption text-error" role="alert" data-testid="ebooks.folderError">{{ t('ebooks.folder.error') }}</p>
        <p class="mt-ms text-caption text-ink-faint">{{ t('ebooks.folder.hint') }}</p>
      </section>

      <section v-if="ebooks.waiting.length" data-testid="ebooks.needsYou">
        <div class="flex h-(--size-touch) items-center justify-between">
          <h2 class="eyebrow">{{ t('ebooks.needsYou') }}</h2>
          <span class="eyebrow text-ink-faint">{{ ebooks.waiting.length }}</span>
        </div>
        <ul class="divide-y divide-hairline">
          <EbooksWaitingRow v-for="record in ebooks.waiting" :key="record.id" :record="record" />
        </ul>
      </section>

      <section v-if="linkedRows.length" data-testid="ebooks.linkedSection">
        <div class="flex h-(--size-touch) items-center justify-between">
          <h2 class="eyebrow">{{ t('ebooks.linked') }}</h2>
          <span class="eyebrow text-ink-faint">{{ linkedRows.length }}</span>
        </div>
        <ul class="flex flex-col">
          <li v-for="{ record, entry, missing } in linkedRows" :key="record.id">
            <UiPressLink
              :to="entry ? `/book/${entry.book.id}` : `/book/${record.bookId}`"
              class="flex items-center gap-inset py-sm"
              data-testid="ebooks.linkedRow"
            >
              <UiCover
                decorative
                :title="entry?.book.title ?? record.metadata.title ?? record.name"
                :authors="entry?.book.authors ?? record.metadata.authors"
                :src="entry ? coverSrc(entry.book.coverUrl, 'sm') : ebooks.coverOf(record)"
                :thumbhash="entry?.book.coverThumbhash"
                :colors="entry?.book.coverColors"
                size="sm"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-xxs">
                <span class="book-title title-wrap text-body-large" data-testid="ebooks.linkedTitle">{{ entry?.book.title ?? record.metadata.title ?? record.name }}</span>
                <span class="figures truncate text-meta text-ink-faint">{{ record.name }}</span>
                <span v-if="missing" class="flex items-center gap-xs text-meta text-error" data-testid="ebooks.linkedMissing">
                  <UiIcon name="ebook" :size="12" />{{ t('ebooks.missing') }}
                </span>
              </span>
              <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
            </UiPressLink>
          </li>
        </ul>
        <p v-if="linkedRows.some((row) => row.missing)" class="mt-xs text-caption text-ink-faint">{{ t('ebooks.missingHint') }}</p>
      </section>

      <UiEmptyState v-if="empty" screen="ebooks" :title="t('ebooks.empty.title')" :text="t('ebooks.empty.text')" compact />

      <p class="text-caption text-ink-faint" data-testid="ebooks.footer">{{ t('ebooks.footer') }}</p>
    </div>

    <EbooksCandidateSheet />
  </div>
</template>

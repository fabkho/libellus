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
import { fileAuthors, fileTitle } from '~/data/ebooks/match'
import { useEbooksStore } from '~/stores/ebooks'
import { useLibraryStore } from '~/stores/library'
import { relativeTime } from '~/utils/relativeTime'

definePageMeta({ layout: 'tabs', screen: 'ebooks', pushed: true })

const { t, locale } = useI18n()
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
  // Of the files that wait, the other copies of a linked Book are said apart, as the page lists them.
  const copyIds = new Set(ebooks.copies.map((record) => record.id))
  const copies = done.ids.filter((id) => copyIds.has(id)).length
  const needsYou = Math.max(0, done.needsYou - copies)
  if (needsYou) parts.push(t('ebooks.report.needsYou', { count: needsYou }, needsYou))
  if (copies) parts.push(t('ebooks.report.copies', { count: copies }, copies))
  return { source: done.source, line: parts.join(' · '), failed: done.failed ? t('ebooks.report.failed', { count: done.failed }, done.failed) : null }
})

const scanning = computed(() => ebooks.busy?.source === 'folder')
/** The folder was scanned before (its time is kept with it): Scan again, and when, quietly. */
const scannedAt = computed(() => (ebooks.folderShown?.scannedAt ? new Date(ebooks.folderShown.scannedAt) : null))
const scanLabel = computed(() => {
  const busy = ebooks.busy
  if (!scanning.value || !busy) return scannedAt.value ? t('ebooks.folder.scanAgain') : t('ebooks.folder.scan')
  return busy.total ? t('ebooks.folder.scanningCount', { done: busy.done, total: busy.total }) : t('ebooks.folder.scanning')
})
// "Scanned 2 minutes ago" stays true while the page is open.
const now = ref(Date.now())
let ticking: ReturnType<typeof setInterval> | undefined
onMounted(() => (ticking = setInterval(() => (now.value = Date.now()), 30_000)))
onBeforeUnmount(() => clearInterval(ticking))
/** How old a scan may be before the page wonders whether books were added since. */
const SCAN_HINT_AFTER_MS = 20 * 60 * 60_000
/**
 * The last scan is from before this app session, or older than about a day:
 * one quiet line asks whether books were added to the folder. Never a scan
 * or a permission prompt unasked (owner, #131): only her tap on Scan again.
 */
const scanHint = computed(
  () => Boolean(scannedAt.value) && !scanning.value && (scannedAt.value!.getTime() < ebooks.openedAt || now.value - scannedAt.value!.getTime() > SCAN_HINT_AFTER_MS),
)
const scannedWhen = computed(() =>
  scannedAt.value && !scanning.value ? t('ebooks.folder.scanned', { when: relativeTime(scannedAt.value, Math.max(now.value, Date.now()), locale.value) }) : null,
)

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
      <!-- The eyebrow and Dismiss share one line: the quiet text action is centred on it and keeps its 44 px target outside the card's padding. -->
      <section v-if="report" class="flex flex-col gap-xs rounded-lg bg-surface-raised px-inset pt-ms pb-inset edge-faint" role="status" data-testid="ebooks.report">
        <div class="flex items-center justify-between gap-sm">
          <h2 class="eyebrow">{{ t(`ebooks.report.${report.source}`) }}</h2>
          <UiButton tone="plain" size="sm" class="-my-sm -mr-ms" data-testid="ebooks.reportDismiss" @click="ebooks.clearReport()">
            {{ t('ebooks.report.dismiss') }}
          </UiButton>
        </div>
        <p class="text-body text-ink" data-testid="ebooks.reportLine">{{ report.line }}</p>
        <p v-if="report.failed" class="text-caption text-ink-muted" data-testid="ebooks.reportFailed">{{ report.failed }}</p>
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
            <span v-if="ebooks.folderShown" class="figures truncate text-ink" data-testid="ebooks.folderName">{{ ebooks.folderShown.name }}</span>
            <span v-else-if="!ebooks.known" class="line flex h-(--text-body--line-height) w-(--size-cover-lg) items-center" aria-hidden="true"><span class="skeleton wave h-3/5 w-full" /></span>
          </UiRow>
        </UiRowGroup>
        <!-- First visit, before the device's records are read: the button's room, so nothing below jumps. -->
        <div v-if="!ebooks.known" class="skeleton wave mt-ms h-(--size-button) rounded-pill" aria-hidden="true" />
        <UiButton
          v-else-if="ebooks.folderShown"
          tone="secondary"
          block
          class="mt-ms"
          :disabled="scanning"
          data-testid="ebooks.scan"
          @click="ebooks.scan()"
        >
          {{ scanLabel }}
        </UiButton>
        <p v-if="scannedWhen" class="mt-xs text-center text-caption text-ink-faint" data-testid="ebooks.scannedAt">
          {{ scannedWhen }}<template v-if="scanHint"> · <span data-testid="ebooks.scanHint">{{ t('ebooks.folder.scanHint') }}</span></template>
        </p>
        <p v-if="ebooks.error === 'folder'" class="mt-ms text-caption text-error" role="alert" data-testid="ebooks.folderError">{{ t('ebooks.folder.error') }}</p>
        <p class="mt-ms text-caption text-ink-faint">{{ t('ebooks.folder.hint') }}</p>
      </section>

      <!-- First visit (no snapshot yet): the lists' room while the device's records are read (Profile's loading, #123). -->
      <section v-if="!ebooks.known" :aria-busy="true" data-testid="ebooks.loading">
        <div class="flex h-(--size-touch) items-center"><span class="skeleton wave h-(--text-eyebrow--line-height) w-(--size-cover-lg)" aria-hidden="true" /></div>
        <ProfileRowPlaceholder v-for="i in 3" :key="i" :wave="i * 0.12" />
      </section>

      <section v-if="ebooks.unmatched.length" data-testid="ebooks.needsYou">
        <div class="flex h-(--size-touch) items-center justify-between">
          <h2 class="eyebrow">{{ t('ebooks.needsYou') }}</h2>
          <span class="eyebrow text-ink-faint">{{ ebooks.unmatched.length }}</span>
        </div>
        <ul class="divide-y divide-hairline">
          <EbooksWaitingRow v-for="record in ebooks.unmatched" :key="record.id" :record="record" />
        </ul>
      </section>

      <!-- Another copy of a Book that has its ebook: apart and quiet, Replace or Keep current. -->
      <section v-if="ebooks.copies.length" data-testid="ebooks.copies">
        <div class="flex h-(--size-touch) items-center justify-between">
          <h2 class="eyebrow">{{ t('ebooks.copies') }}</h2>
          <span class="eyebrow text-ink-faint">{{ ebooks.copies.length }}</span>
        </div>
        <ul class="divide-y divide-hairline">
          <EbooksWaitingRow v-for="record in ebooks.copies" :key="record.id" :record="record" copy />
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
                :title="entry?.book.title ?? fileTitle(record.metadata) ?? record.name"
                :authors="entry?.book.authors ?? fileAuthors(record.metadata)"
                :src="entry ? coverSrc(entry.book.coverUrl, 'sm') : ebooks.coverOf(record)"
                :thumbhash="entry?.book.coverThumbhash"
                :colors="entry?.book.coverColors"
                size="sm"
                :whole="!entry"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-xxs">
                <span class="book-title title-wrap text-body-large" data-testid="ebooks.linkedTitle">{{ entry?.book.title ?? fileTitle(record.metadata) ?? record.name }}</span>
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
    <EbooksEditionChoiceSheet />
    <EbooksCopySheet />
    <EbooksLinkNote />
  </div>
</template>

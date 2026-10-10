<script setup lang="ts">
// The Web Share Target (issue #91): sharing a link or text to Libellus from
// Goodreads, Amazon, a browser or a bookstore app opens `/share?title=&text=&url=`
// (the service worker turns the manifest's POST into that GET, public/sw-share.js).
// The page reads what was shared, finds the Book and goes to its page, or to the
// search palette with the words typed in when no Book is certain. Either way it
// replaces itself in the history, so Back never lands on a page that only redirects.
//
// EPUB files shared to Libellus (issue #131) arrive as `/share?ebooks=<id>`: the
// service worker kept them on the device and the page lists them (names and sizes)
// and asks "Add N ebooks shared to Libellus?". Only the tap on Add takes them in
// (copies them, links what fits) and goes to the ebooks page, which says what
// happened ("3 ebooks · 2 linked · 1 needs you"); Not now deletes them. Any page on
// the web can POST to /share, so nothing is imported without that tap (security
// round, October 2026, F4). `ebooks=missed`: the share came before the service
// worker was there to keep the files (functions/share.js), or held nothing it keeps.
//
// Signed out, the share is kept through the sign-in (middleware/auth.global.ts)
// and comes back here once the member is in.
import { bookKey } from '~/data/books'
import { useEbooksStore } from '~/stores/ebooks'
import { useShareStore } from '~/stores/share'
import { sizeLabel, type PendingShare } from '~/data/ebooks/shared'
import { LAUNCH_QUERY, LAUNCH_SEARCH } from '~/utils/launch'
import { PENDING_SHARE_KEY, takeShare } from '~/utils/pendingShare'
import type { SharedPayload } from '~/utils/shared'

definePageMeta({ layout: false, screen: 'share' })

const { t } = useI18n()
const route = useRoute()
const share = useShareStore()
const ebooks = useEbooksStore()

useHead({ title: () => t('share.title') })

const first = (value: unknown): string | null => (Array.isArray(value) ? first(value[0]) : typeof value === 'string' ? value : null)

const takingEbooks = ref(false)
/** The files waiting under the address's `ebooks=`, shown for the member to confirm. */
const confirming = ref<PendingShare | null>(null)
const status = computed(() => {
  if (!takingEbooks.value) return t('share.finding')
  const busy = ebooks.busy
  return busy && busy.total > 1 ? t('share.takingMany', { done: busy.done, total: busy.total }) : t('share.taking')
})

/** The member's tap on Add: the only way a shared file reaches her device. */
async function addShared() {
  const waiting = confirming.value
  if (!waiting || takingEbooks.value) return
  takingEbooks.value = true
  try {
    await ebooks.takeShared(waiting.id)
  } catch {
    // The files stay in the service worker's cache for the next try; the ebooks page shows what there is.
  }
  confirming.value = null
  await navigateTo('/ebooks', { replace: true })
}

/** Not now: the shared files are deleted, nothing is taken in. */
async function dropShared() {
  const waiting = confirming.value
  confirming.value = null
  if (waiting) await ebooks.dropShared(waiting.id).catch(() => {})
  await navigateTo('/', { replace: true })
}

onMounted(async () => {
  const fromAddress: SharedPayload = {
    title: first(route.query.title),
    text: first(route.query.text),
    url: first(route.query.url),
    ebooks: first(route.query.ebooks),
  }
  const shared = fromAddress.title || fromAddress.text || fromAddress.url || fromAddress.ebooks ? fromAddress : takeShare(window.localStorage)
  // A share in the address replaces any kept from before.
  window.localStorage.removeItem(PENDING_SHARE_KEY)
  if (!shared) return void (await navigateTo('/', { replace: true }))

  if (shared.ebooks) {
    if (shared.ebooks === 'missed' || !ebooks.supported) return void (await navigateTo({ path: '/ebooks', query: { missed: '1' } }, { replace: true }))
    // Nothing is taken in here: the files wait for the tap (`addShared`).
    const waiting = await ebooks.pendingShared(shared.ebooks).catch(() => null)
    if (!waiting) return void (await navigateTo({ path: '/ebooks', query: { missed: '1' } }, { replace: true }))
    confirming.value = waiting
    return
  }

  const outcome = await share.resolve(shared)
  if (outcome.kind === 'book') await navigateTo(`/book/${bookKey(outcome.book)}`, { replace: true })
  else await navigateTo({ path: '/', query: { [LAUNCH_SEARCH]: '1', ...(outcome.query ? { [LAUNCH_QUERY]: outcome.query } : {}) } }, { replace: true })
})
</script>

<template>
  <main class="screen-inset flex min-h-dvh flex-col items-center justify-center gap-ms px-lg text-center">
    <p class="font-serif text-wordmark font-regular lowercase italic" data-testid="share.brand">{{ t('app.name') }}</p>
    <section v-if="confirming && !takingEbooks" class="flex w-full max-w-sm flex-col gap-md" data-testid="share.confirm">
      <h1 class="text-title" data-testid="share.confirmTitle">{{ t('share.confirmTitle', { count: confirming.files.length }, confirming.files.length) }}</h1>
      <p class="text-subhead text-ink-muted">{{ t('share.confirmText') }}</p>
      <ul class="flex flex-col gap-xs rounded-lg bg-surface-raised px-inset py-ms text-left edge-faint" data-testid="share.files">
        <li v-for="file in confirming.files" :key="file.index" class="flex items-baseline justify-between gap-sm text-body text-ink" data-testid="share.file">
          <span class="min-w-0 truncate">{{ file.name }}</span>
          <span class="figures shrink-0 text-caption text-ink-muted">{{ sizeLabel(file.size) }}</span>
        </li>
      </ul>
      <p v-if="confirming.skipped" class="text-caption text-ink-muted" data-testid="share.skipped">
        {{ t('share.skipped', { count: confirming.skipped }, confirming.skipped) }}
      </p>
      <UiButton block data-testid="share.add" @click="addShared">{{ t('share.add') }}</UiButton>
      <UiButton tone="plain" block data-testid="share.notNow" @click="dropShared">{{ t('share.notNow') }}</UiButton>
    </section>
    <p v-else class="text-subhead text-ink-muted" role="status" data-testid="share.status">{{ status }}</p>
  </main>
</template>

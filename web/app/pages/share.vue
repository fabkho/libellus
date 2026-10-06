<script setup lang="ts">
// The Web Share Target (issue #91): sharing a link or text to Libellus from
// Goodreads, Amazon, a browser or a bookstore app opens `/share?title=&text=&url=`
// (the service worker turns the manifest's POST into that GET, public/sw-share.js).
// The page reads what was shared, finds the Book and goes to its page, or to the
// search palette with the words typed in when no Book is certain. Either way it
// replaces itself in the history, so Back never lands on a page that only redirects.
//
// EPUB files shared to Libellus (issue #131) arrive as `/share?ebooks=<id>`: the
// service worker kept them on the device; the page takes them in (copies them,
// links what fits) and goes to the ebooks page, which says what happened
// ("3 ebooks · 2 linked · 1 needs you"). `ebooks=missed`: the share came before
// the service worker was there to keep the files (functions/share.js).
//
// Signed out, the share is kept through the sign-in (middleware/auth.global.ts)
// and comes back here once the member is in.
import { bookKey } from '~/data/books'
import { useEbooksStore } from '~/stores/ebooks'
import { useShareStore } from '~/stores/share'
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
const status = computed(() => {
  if (!takingEbooks.value) return t('share.finding')
  const busy = ebooks.busy
  return busy && busy.total > 1 ? t('share.takingMany', { done: busy.done, total: busy.total }) : t('share.taking')
})

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
    takingEbooks.value = true
    try {
      await ebooks.takeShared()
    } catch {
      // The files stay in the service worker's cache for the next try; the ebooks page shows what there is.
    }
    return void (await navigateTo('/ebooks', { replace: true }))
  }

  const outcome = await share.resolve(shared)
  if (outcome.kind === 'book') await navigateTo(`/book/${bookKey(outcome.book)}`, { replace: true })
  else await navigateTo({ path: '/', query: { [LAUNCH_SEARCH]: '1', ...(outcome.query ? { [LAUNCH_QUERY]: outcome.query } : {}) } }, { replace: true })
})
</script>

<template>
  <main class="screen-inset flex min-h-dvh flex-col items-center justify-center gap-ms px-lg text-center">
    <p class="font-serif text-wordmark font-regular lowercase italic" data-testid="share.brand">{{ t('app.name') }}</p>
    <p class="text-subhead text-ink-muted" role="status" data-testid="share.status">{{ status }}</p>
  </main>
</template>

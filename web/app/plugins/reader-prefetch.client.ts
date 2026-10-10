import { hasOpenableEbook } from '~/data/reader/prefetch'
import { readEbooksSnapshot } from '~/data/ebooks/snapshot'
import { useSessionStore } from '~/stores/session'
import { onIdle } from '~/utils/idle'
import { prefetchReader } from '~/utils/readerChunks'

/**
 * Fetches the ebook reader ahead for a member who has an ebook on this device (data/reader/prefetch.ts): on
 * idle, a moment after the app has painted, so the Home and Library requests go first. Read now then opens
 * the reader from memory, with no loading step. Nothing is fetched for a member without an ebook, and
 * a Book page with one asks again on its own (pages/book/[key].vue).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const session = useSessionStore()
  nuxtApp.hook('app:mounted', () => {
    watch(
      () => session.member?.id,
      (memberId, _before, onCleanup) => {
        if (!memberId || !hasOpenableEbook(readEbooksSnapshot(window.localStorage, memberId))) return
        let cancel = () => {}
        const timer = setTimeout(() => (cancel = onIdle(prefetchReader, { timeout: 5000, fallback: 1000 })), 1500)
        onCleanup(() => {
          clearTimeout(timer)
          cancel()
        })
      },
      { immediate: true },
    )
  })
})

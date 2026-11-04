import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useSessionStore } from '~/stores/session'

/** The Book behind one of her buddy reads or invitations, as far as a suggestion needs it to leave it out. */
export type TogetherBook = { id: string; title: string; authors: string[] }

/**
 * The Books of her active buddy reads and of the invitations she has waiting, and nothing else of buddy reads: what "Potential buddy reads"
 * on a friend's profile leaves out (utils/buddySuggestions.ts). Like stores/buddyInvites.ts it is a small door the pages may import: the big
 * store (stores/buddyRead.ts, the send queue, the live channel) stays out, and the repository (`data/buddyReads.ts`) is loaded by a dynamic
 * `import()` the first time she is asked. One query (`my_buddy_reads()`), kept `FRESH_MS`; read after her own Library, never before the
 * friend's profile says it shows something to suggest from. `null` until read, and after a refusal: a section that cannot tell what she is
 * already reading together draws nothing.
 */
export const useBuddyTogetherStore = defineStore('buddyTogether', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  const books = ref<TogetherBook[] | null>(null)
  let reading: Promise<void> | null = null
  let loadedAt = 0
  const FRESH_MS = 45_000

  function load({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!backend || !online.value || !session.member) return Promise.resolve()
    if (!force && books.value && Date.now() - loadedAt < FRESH_MS) return Promise.resolve()
    const member = session.member.id
    reading ??= (async () => {
      const { createBuddyReads } = await import('~/data/buddyReads')
      const answer = await createBuddyReads(backend, { online: isOnline, self: () => member }).mine()
      // Another member came in while it was asked, or it was refused: what was held stays.
      if (answer.error || session.member?.id !== member) return
      const active = answer.data.reads.filter((read) => read.status === 'active').map((read) => read.book)
      books.value = [...active, ...answer.data.invitations.map((invitation) => invitation.book)].map((book) => ({
        id: book.id,
        title: book.title,
        authors: book.authors,
      }))
      loadedAt = Date.now()
    })().finally(() => {
      reading = null
    })
    return reading
  }

  watch(
    () => session.member?.id ?? null,
    () => {
      books.value = null
      loadedAt = 0
    },
  )

  return { books, load }
})

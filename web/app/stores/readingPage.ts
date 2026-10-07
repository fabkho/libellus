import { defineStore } from 'pinia'
import { createReadingPages, type PublicBookCard, type PublicReadingPage, type ReadingPages } from '~/data/readingPage'

/** Where a visitor's read of a page or a card stands. `missing`: no such page (a dead or wrong link). */
export type PublicState = 'loading' | 'ready' | 'missing' | 'offline' | 'error'

/**
 * Sharing, the visitor's side (issue #171): the reading page and the Book card
 * a link opens (pages/r/…), for anyone, signed in or not. What it holds is
 * what the database published for the token (data/readingPage.ts) and nothing
 * else; a page opened again from the card asks again, so a page turned off
 * meanwhile is gone at once.
 */
export const useReadingPageStore = defineStore('readingPage', () => {
  const backend = useBackend()
  let repository: ReadingPages | null = null
  function repo(): ReadingPages | null {
    if (!backend) return null
    repository ??= createReadingPages(backend, { online: isOnline })
    return repository
  }

  const page = ref<PublicReadingPage | null>(null)
  const pageState = ref<PublicState>('loading')
  /** The token the page in hand belongs to. */
  const pageToken = ref<string | null>(null)

  const card = ref<PublicBookCard | null>(null)
  const cardState = ref<PublicState>('loading')

  async function loadPage(token: string) {
    if (pageToken.value !== token) {
      page.value = null
      pageState.value = 'loading'
    }
    pageToken.value = token
    const r = repo()
    if (!r) return void (pageState.value = 'error')
    const result = await r.publicPage(token)
    if (pageToken.value !== token) return
    if (result.error) {
      pageState.value = result.error === 'offline' ? 'offline' : 'error'
      return
    }
    page.value = result.data
    pageState.value = result.data ? 'ready' : 'missing'
  }

  let cardKey: string | null = null
  async function loadCard(token: string, bookId: string) {
    const key = `${token}/${bookId}`
    if (cardKey !== key) {
      card.value = null
      cardState.value = 'loading'
    }
    cardKey = key
    const r = repo()
    if (!r) return void (cardState.value = 'error')
    const result = await r.publicCard(token, bookId)
    if (cardKey !== key) return
    if (result.error) {
      cardState.value = result.error === 'offline' ? 'offline' : 'error'
      return
    }
    card.value = result.data
    cardState.value = result.data ? 'ready' : 'missing'
  }

  return { page, pageState, pageToken, card, cardState, loadPage, loadCard }
})

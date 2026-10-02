import { defineStore } from 'pinia'

/**
 * The search overlay's view state. Search never navigates (issue #1, Screens
 * and navigation): the Search tab — or the search prompt on an empty Home —
 * opens a palette over the current page, which stays where it is behind it.
 * This ticket (#5) only opens and closes it; the query, the sources and the
 * results are #6/#12 and arrive here as more state and actions.
 */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false)
  const query = ref('')

  function open() {
    isOpen.value = true
  }

  /** Cancel, a tap on the page behind, a swipe down, Escape, or leaving the page. */
  function close() {
    isOpen.value = false
    query.value = ''
  }

  return { isOpen, query, open, close }
})

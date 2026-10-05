import { useLibraryStore } from '~/stores/library'
import { useReadingStore } from '~/stores/reading'
import { useSearchStore } from '~/stores/search'
import { LAUNCH_PROGRESS, LAUNCH_QUERY, LAUNCH_SEARCH, mostRecentlyUpdated } from '~/utils/launch'

/**
 * What the app was opened to do (issue #91): the manifest's shortcuts open
 * `/?search=1` and `/?progress=1`, and a share that found no Book opens
 * `/?search=1&q=<text>`. The shell acts on it once, at launch or when the
 * address changes under a running app, and takes it off the address so a
 * reload or Back does not repeat it.
 *
 * search: the search palette, with `q` already typed in it.
 * progress: the Update progress sheet of the Currently reading Book updated
 * last; Home stays as it is when nothing is being read.
 */
export function useLaunch() {
  const route = useRoute()
  const router = useRouter()
  const search = useSearchStore()
  const library = useLibraryStore()
  const reading = useReadingStore()

  async function act() {
    const { [LAUNCH_SEARCH]: wantsSearch, [LAUNCH_PROGRESS]: wantsProgress, [LAUNCH_QUERY]: query, ...rest } = route.query
    if (wantsSearch === undefined && wantsProgress === undefined) return
    await router.replace({ query: rest, hash: route.hash })

    if (wantsSearch !== undefined) {
      search.open()
      if (typeof query === 'string' && query) search.query = query
    }
    if (wantsProgress !== undefined) {
      // Asked for again even when the device holds a copy: another device may have started or updated a read since.
      await library.load()
      const entry = mostRecentlyUpdated(library.reading)
      if (!entry) return
      // Home stays under the book, so Back leads to it.
      await navigateTo(`/book/${entry.book.id}`)
      reading.openProgress(entry)
    }
  }

  onMounted(() => void act())
  watch(() => route.query, () => void act())
}

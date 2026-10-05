/**
 * Dev-only switches for the design round on the first-results loading state
 * (`?loading=a..e`, `?delay=2000`). Never in a build: every read sits behind
 * `import.meta.dev`, which the build replaces with `false`, and the bundler
 * drops the rest.
 *
 * `?loading=a..e` picks one of the five ideas (`o`, or no value, is today's
 * single ghost row); `?delay=2000` holds every answer back that many
 * milliseconds, so a fast source looks slow enough to see the state. Both
 * are remembered in this browser (localStorage) until changed, so they
 * survive navigating and reloading on a phone; `?loading=` and `?delay=0`
 * clear them. The picker (SearchDevPicker) sets them without typing a URL.
 */
export const LOADING_VARIANTS = ['o', 'a', 'b', 'c', 'd', 'e'] as const
export type LoadingVariant = (typeof LOADING_VARIANTS)[number]
export const DELAYS_MS = [0, 1000, 2000, 4000] as const

const STORAGE_KEY = 'libellus-dev-search'
const loading = ref<LoadingVariant>('o')
const delay = ref(0)
let ready = false

function read() {
  if (ready || !import.meta.client) return
  ready = true
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { loading?: string; delay?: number }
    if (LOADING_VARIANTS.includes(saved.loading as LoadingVariant)) loading.value = saved.loading as LoadingVariant
    if (Number.isFinite(saved.delay)) delay.value = saved.delay!
    const params = new URLSearchParams(location.search)
    const asked = params.get('loading')
    if (asked !== null) loading.value = LOADING_VARIANTS.includes(asked as LoadingVariant) ? (asked as LoadingVariant) : 'o'
    const wait = Number(params.get('delay'))
    if (params.has('delay') && Number.isFinite(wait)) delay.value = Math.max(0, wait)
  } catch {
    // An unreadable setting is no setting.
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ loading: loading.value, delay: delay.value }))
}

export function useSearchDev() {
  if (import.meta.dev) read()
  return {
    /** The loading idea showing (`o`: today's). Always `o` outside dev. */
    loading: computed<LoadingVariant>(() => (import.meta.dev ? loading.value : 'o')),
    /** The artificial wait before an answer shows, in ms. Always 0 outside dev. */
    delay: computed(() => (import.meta.dev ? delay.value : 0)),
    setLoading(variant: LoadingVariant) {
      if (!import.meta.dev) return
      loading.value = variant
      save()
    },
    setDelay(ms: number) {
      if (!import.meta.dev) return
      delay.value = ms
      save()
    },
  }
}

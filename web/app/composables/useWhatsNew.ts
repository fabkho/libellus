import { minorVersion, shouldShowNotes, WHATS_NEW_KEY, type ReleaseNotes } from '~/utils/changelog'

/**
 * What's new (docs/OPERATIONS.md, "Releases"): the notes of the release this build
 * is (appConfig.release, embedded at build time by nuxt.config.ts) in a sheet.
 *
 * After an update the signed-in shell shows them once on this device by itself
 * (`check`, utils/changelog.ts `shouldShowNotes` has the rules); the device keeps
 * the last version it saw under `libellus:whatsNew`. Profile → Version · What's new
 * opens them any time (`show`). One sheet for the whole app (layouts/tabs.vue).
 */
let checked = false

export function useWhatsNew() {
  const notes = useAppConfig().release as ReleaseNotes
  const open = useState('whatsNew.open', () => false)
  const minor = minorVersion(notes.version)

  /** Once per visit: shows the notes when this device last saw an older release, and remembers this one. */
  function check() {
    if (!import.meta.client || checked || !notes.version) return
    checked = true
    let seen: string | null = null
    try {
      seen = window.localStorage.getItem(WHATS_NEW_KEY)
      if (seen !== notes.version) window.localStorage.setItem(WHATS_NEW_KEY, notes.version)
    } catch {
      return // storage blocked: never nag on every start
    }
    if (shouldShowNotes(seen, notes)) open.value = true
  }

  function show() {
    open.value = true
  }

  return { notes, minor, open, check, show }
}

/**
 * The install hint (issue #94, utils/installHint.ts has the rules) and, on
 * Android, the install prompt Chrome offers.
 *
 * `visible` is what Home shows: the iPhone/iPad Safari hint while Libellus is
 * not installed and not dismissed in the last week. `dismiss()` hides it and
 * remembers that on this device.
 *
 * Chrome fires `beforeinstallprompt` once, early, long before the avatar menu
 * exists, so the install plugin starts listening at boot (`listenForInstall`)
 * and keeps the event: `canInstall` is true only when it fired, and
 * `install()` shows Chrome's own dialog. Nothing here ever shows on iOS
 * (no such event) or in the installed app (Chrome fires none there).
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = shallowRef<InstallPromptEvent | null>(null)
const dismissedAt = ref<number | null>(null)
const clock = ref(0)
let listening = false

/** Run once at boot by the install plugin. */
export function listenForInstall() {
  if (listening || !import.meta.client) return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome's mini-infobar stays away; the avatar menu's row is the way in.
    event.preventDefault()
    deferred.value = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => (deferred.value = null))
}

function readEnvironment(): InstallEnvironment {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
  }
}

export function useInstallHint() {
  const visible = computed(() => {
    if (!import.meta.client || !clock.value) return false
    return shouldShowInstallHint(readEnvironment(), dismissedAt.value, clock.value)
  })

  /** Reads the device's memory and the clock again: on mount, and when a kept-alive Home comes back. */
  function refresh() {
    dismissedAt.value = readDismissedAt(window.localStorage)
    clock.value = Date.now()
  }

  function dismiss() {
    const now = Date.now()
    writeDismissedAt(window.localStorage, now)
    dismissedAt.value = now
    clock.value = now
  }

  const canInstall = computed(() => deferred.value !== null)

  async function install() {
    const event = deferred.value
    if (!event) return
    // Chrome allows the prompt once per event, accepted or not.
    deferred.value = null
    await event.prompt()
    await event.userChoice
  }

  return { visible, refresh, dismiss, canInstall, install }
}

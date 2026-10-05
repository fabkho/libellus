import { listenForInstall } from '~/composables/useInstallHint'

/** Keeps Chrome's `beforeinstallprompt`, which fires before any screen is up (composables/useInstallHint.ts). */
export default defineNuxtPlugin(() => {
  listenForInstall()
})

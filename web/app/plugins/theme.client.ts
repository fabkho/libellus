import { useThemeStore } from '~/stores/theme'

/** The theme switch reads the stored choice and the device's appearance once, at boot. */
export default defineNuxtPlugin(() => {
  useThemeStore().start()
})

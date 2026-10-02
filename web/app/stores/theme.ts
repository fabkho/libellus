import { defineStore } from 'pinia'

/**
 * Light or dark (utils/theme.ts has the rule). The store holds what the switch
 * shows and does what a tap means; the page already wears the stored theme
 * before the app boots, put there by the inline script in nuxt.config.ts.
 */
export const useThemeStore = defineStore('theme', () => {
  const preference = ref<ThemePreference>(null)
  const deviceIsDark = ref(false)

  // The surface colour per theme, from tokens.json through nuxt.config.ts (appConfig).
  const colors = useAppConfig().themeColors as ThemeColors

  /** What is showing: the switch is on when this is dark. */
  const theme = computed<Theme>(() => resolveTheme(preference.value, deviceIsDark.value))

  /** Run once by the theme plugin: reads the stored choice and follows the device. */
  function start() {
    if (!import.meta.client) return
    preference.value = readPreference(window.localStorage)
    // The boot script runs before the theme-color tags are parsed; repaint them
    // now that they exist (the attribute on <html> is already right).
    if (preference.value) applyPreference(document, preference.value, colors)
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    deviceIsDark.value = query.matches
    query.addEventListener('change', (event) => (deviceIsDark.value = event.matches))
  }

  /** The switch: stores the opposite of what is showing and puts it on the page. */
  function toggle() {
    const next = nextPreference(preference.value, deviceIsDark.value)
    preference.value = next
    if (!import.meta.client) return
    writePreference(window.localStorage, next)
    applyPreference(document, next, colors)
  }

  return { preference, theme, start, toggle }
})

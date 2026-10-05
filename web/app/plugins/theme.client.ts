import { useThemeStore } from '~/stores/theme'

/**
 * The theme switch reads the stored choice and the device's appearance once,
 * at boot. The head manager owns the theme-color tags (nuxt.config.ts declares
 * them for the static HTML), so their colour is declared here from the store:
 * the chosen theme's surface on both, or each its own while nothing is chosen.
 */
export default defineNuxtPlugin(() => {
  const theme = useThemeStore()
  theme.start()
  useHead({
    meta: [
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: light)',
        content: () => themeColorFor(theme.preference, 'light', theme.colors),
      },
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: dark)',
        content: () => themeColorFor(theme.preference, 'dark', theme.colors),
      },
    ],
  })
})

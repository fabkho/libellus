import { dimStatusBar } from '~/utils/statusBarDim'

/**
 * The installed app's status bar under a sheet's scrim (utils/statusBarDim.ts, issue A6): the bar is outside the
 * viewport, so the scrim cannot reach it, and it takes the scrim's colour for as long as a layer (a sheet, a confirm,
 * the reader) is on screen, open or still on its way out.
 *
 * The shared UI base's layers (`useModalLayer`, `useModalShown`) know nothing of the app's status bar, so the app
 * follows them from here instead of from inside the layer, as it did while the layer was its own. `useModalShown` says
 * whether any layer is on screen, not how many: a confirm over a sheet dims the bar once, where the page under two
 * scrims is darker (it dimmed once per layer before). A count in the base would bring that back.
 */
export default defineNuxtPlugin({
  name: 'libellus:status-bar-dim',
  setup() {
    const shown = useModalShown()
    let undim: (() => void) | null = null
    watch(
      shown,
      (on) => {
        if (on) undim ??= dimStatusBar()
        else {
          undim?.()
          undim = null
        }
      },
      { flush: 'sync' },
    )
  },
})

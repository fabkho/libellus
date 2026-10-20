import { dimStatusBar } from '~/utils/statusBarDim'

/**
 * The installed app's status bar under a sheet's scrim (utils/statusBarDim.ts, issue A6): the bar is outside the
 * viewport, so the scrim cannot reach it, and it takes the scrim's colour for as long as a layer (a sheet, a confirm,
 * the reader) is on screen, open or still on its way out.
 *
 * The shared UI base's layers (`useModalLayer`) know nothing of the app's status bar, so the app follows them from
 * here instead of from inside the layer, as it did while the layer was its own. `useModalDepth` says how many layers
 * are on screen: one dim per layer, as the page under two scrims is darker (a confirm over a sheet dims twice).
 */
export default defineNuxtPlugin({
  name: 'libellus:status-bar-dim',
  setup() {
    const depth = useModalDepth()
    const releases: (() => void)[] = []
    watch(
      depth,
      (count) => {
        while (releases.length < count) releases.push(dimStatusBar())
        while (releases.length > count) releases.pop()!()
      },
      { flush: 'sync' },
    )
  },
})

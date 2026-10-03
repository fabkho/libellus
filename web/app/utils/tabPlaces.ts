/**
 * Each tab keeps its place, as on iOS: Home and Library remember how far down
 * they were when the member left them, and going back to the tab lands there
 * again — from the tab bar, the search palette's tabs or a link. Back and
 * forward still use the place the browser saved for that history entry, and a
 * tab entered from outside the signed-in shell (the way in after a sign-out)
 * starts at the top. Written when a navigation leaves a tab (ShellTabBar), read
 * by the router's scroll behaviour (app/router.options.ts). Framework-free, so
 * the rule is tested on its own (tests/tab-places.test.ts).
 */

/** The tab pages: the places with a tab in the tab bar. */
export const TAB_ROOTS: readonly string[] = ['/', '/library']

export const isTabRoot = (path: string) => TAB_ROOTS.includes(path)

export interface ScrollPlace {
  left: number
  top: number
}

export interface Arrival {
  /** The path being entered. */
  to: string
  /** The page being left is in the signed-in shell (the tabs layout). */
  fromShell: boolean
  /** What the browser saved for this history entry: only on back and forward. */
  saved: ScrollPlace | null
}

export function createTabPlaces() {
  const places = new Map<string, number>()
  return {
    /** A navigation leaves `path` scrolled to `top`: a tab remembers it. */
    leave(path: string, top: number) {
      if (isTabRoot(path)) places.set(path, Math.max(0, top))
    },
    /** Where the page being entered opens. */
    arrive({ to, fromShell, saved }: Arrival): ScrollPlace {
      if (!fromShell) places.clear()
      if (saved) return saved
      return { left: 0, top: isTabRoot(to) ? (places.get(to) ?? 0) : 0 }
    },
  }
}

/** The app's one memory of the tabs' places. */
export const tabPlaces = createTabPlaces()

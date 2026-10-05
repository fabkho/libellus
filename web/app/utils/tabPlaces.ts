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

// ------------------------------------------------------------ landing there

/** How long a place waits for its page to grow tall enough before it lands as far down as it can. */
export const PLACE_PATIENCE = 2000

/** What `untilReachable` needs of the page; the router hands it the document's (app/router.options.ts). */
export interface PageWatch {
  /** How far down the page can be scrolled right now. */
  maxTop(): number
  /** Calls `changed` whenever the page's size may have changed; returns the undo. */
  onResize(changed: () => void): () => void
  /** Calls `took` when the member scrolls, taps or types herself; returns the undo. */
  onMember(took: () => void): () => void
}

/** How a wait for a place ended. */
export type Reach = 'reachable' | 'member' | 'patience' | 'cancelled'

/**
 * Waits until the page is tall enough to land on `place`. A page that is still
 * rendering its content when the router scrolls (a slow device, a list still
 * coming in) would otherwise clamp the place to its short height, and the
 * member, coming back to a tab, lands at the top instead of where she left it.
 * Ends at once when the place is already in reach, as soon as a change of size
 * brings it in reach, when the member takes over (scrolling, tapping or typing
 * herself: a late jump would pull the page out from under her finger), or after
 * `patience` ms (then the place is applied as far as the page goes). `cancel`
 * ends it early (a newer navigation took over).
 */
export function untilReachable(place: ScrollPlace, page: PageWatch, patience = PLACE_PATIENCE) {
  let end: (reach: Reach) => void = () => {}
  const reached = new Promise<Reach>((resolve) => {
    if (place.top <= page.maxTop()) return resolve('reachable')
    const stops: (() => void)[] = []
    let done = false
    end = (reach) => {
      if (done) return
      done = true
      for (const stop of stops) stop()
      resolve(reach)
    }
    // A watch that answers at once has already ended the wait: its undo runs straight away.
    const keep = (stop: () => void) => (done ? stop() : stops.push(stop))
    const timer = setTimeout(() => end('patience'), patience)
    keep(() => clearTimeout(timer))
    keep(page.onMember(() => end('member')))
    keep(page.onResize(() => place.top <= page.maxTop() && end('reachable')))
  })
  return { reached, cancel: () => end('cancelled') }
}

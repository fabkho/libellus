/**
 * Warming a friend's page before it opens (docs/plans/shared-books-slideshow.md, loading): a tap on a link to her, or her
 * row coming into view, starts the request for "You both read" (and its first covers and the reel's chunk) so they are
 * on their way, or in, when the page opens. Framework-free: the address that names a friend, and how many a screen may
 * warm by itself (a few at most; a tap is always the member's own intent).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FRIEND_HREF = new RegExp(`^/friends/(${UUID})/?(?:[?#].*)?$`, 'i')

/** The friend an address leads to (`/friends/<id>`, not her year pages or the tab itself); null for any other. */
export function friendIdOfHref(href: string | null | undefined): string | null {
  const found = href ? FRIEND_HREF.exec(href) : null
  return found ? found[1]!.toLowerCase() : null
}

/**
 * What may be warmed on its own (rows coming into view, no tap), for the whole session and not per screen: at most
 * `limit` friends in any `windowMs` (default 3 in 5 minutes), each friend once while her warm lasts (`keepMs`, the
 * answer's own lifetime in the store: a second visit to People warms nobody again). One instance is shared by every
 * Home, Friends and People visit (composables/useFriendWarm.ts).
 */
export function createWarmBudget({ limit = 3, windowMs = 5 * 60_000, keepMs = 3 * 60_000 }: { limit?: number; windowMs?: number; keepMs?: number } = {}) {
  /** When each friend was taken by a row (these count against the window). */
  const taken = new Map<string, number>()
  /** When each friend was warmed by a tap (remembered, but not counted against the rows' window). */
  const noted = new Map<string, number>()
  const prune = (now: number) => {
    for (const [id, at] of taken) if (now - at >= Math.max(windowMs, keepMs)) taken.delete(id)
    for (const [id, at] of noted) if (now - at >= keepMs) noted.delete(id)
  }
  return {
    /** Whether this friend may be warmed on its own now (and counts her); false when she was lately, or the window is spent. */
    take(id: string, now = Date.now()): boolean {
      prune(now)
      const at = taken.get(id)
      if (at !== undefined && now - at < keepMs) return false
      if (noted.has(id)) return false
      let inWindow = 0
      for (const [, when] of taken) if (now - when < windowMs) inWindow++
      if (inWindow >= limit) return false
      taken.set(id, now)
      return true
    },
    /** A friend warmed by a tap (her own intent, never refused): remembered, so the rows do not warm her again. */
    note(id: string, now = Date.now()) {
      noted.set(id, now)
    },
    reset() {
      taken.clear()
      noted.clear()
    },
  }
}

/** The session's one budget (the composable's). */
export const warmBudget = createWarmBudget()

/**
 * A tap on a link to a friend, told from a finger that scrolls: the pointer going down only starts a short wait
 * (`delay`, 80 ms); moving past `slop` px, the browser taking the gesture for a scroll (`pointercancel`) or a second
 * pointer cancels it; going up before the wait ends warms at once (a quick tap), and a click with no pointer before
 * it (the keyboard) warms too. `warm` is called at most once per gesture. Framework-free, the timer injectable.
 */
export function createTapWarmer(
  warm: (id: string) => void,
  { delay = 80, slop = 6, setTimer = (run: () => void, ms: number) => setTimeout(run, ms) as unknown, clearTimer = (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) } = {},
) {
  let pending: { id: string; x: number; y: number; timer: unknown } | null = null
  let done = false
  const cancel = () => {
    if (pending) clearTimer(pending.timer)
    pending = null
  }
  return {
    down(id: string, x: number, y: number) {
      cancel()
      done = false
      const gesture = { id, x, y, timer: null as unknown }
      gesture.timer = setTimer(() => {
        if (pending !== gesture) return
        pending = null
        done = true
        warm(id)
      }, delay)
      pending = gesture
    },
    move(x: number, y: number) {
      if (pending && Math.hypot(x - pending.x, y - pending.y) > slop) cancel()
    },
    /** The browser took the gesture (a scroll) or it was cut off. */
    cancel,
    /** The finger lifted: a tap (the wait not over, the pointer not moved away) warms now. */
    up() {
      const gesture = pending
      cancel()
      if (gesture && !done) {
        done = true
        warm(gesture.id)
      }
    },
    /** A click on a link to her that no pointer led to (Enter on the keyboard): warm unless this gesture already did. */
    click(id: string) {
      if (done) return void (done = false)
      cancel()
      warm(id)
    },
  }
}

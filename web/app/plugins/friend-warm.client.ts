import { createTapWarmer, friendIdOfHref, warmBudget } from '~/utils/friendWarm'

/**
 * A tap on a link to a friend starts what her page will need while the route resolves (composables/useFriendWarm.ts):
 * one listener set for every link to her in the app, whichever screen draws it. A finger that scrolls past rows is not
 * a tap: the pointer going down only starts an 80 ms wait, which moving, the browser taking the gesture for a scroll or
 * a cancel ends; a quick tap warms when the finger lifts, the keyboard's click warms too (`createTapWarmer`). Passive;
 * does nothing offline; remembered in the session's one budget, so the rows do not warm her again.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const tap = createTapWarmer((id) => {
    if (!isOnline()) return
    warmBudget.note(id)
    // The stores exist once the app is set up; asked here, at the tap.
    nuxtApp.runWithContext(() => void useFriendWarm().warmFriend(id))
  })
  const friendOf = (event: Event) => friendIdOfHref(((event.target as Element | null)?.closest?.('a[href]'))?.getAttribute('href'))
  const opts = { capture: true, passive: true } as const
  document.addEventListener('pointerdown', (event) => {
    const id = friendOf(event)
    if (id && event.isPrimary) tap.down(id, event.clientX, event.clientY)
  }, opts)
  document.addEventListener('pointermove', (event) => tap.move(event.clientX, event.clientY), opts)
  document.addEventListener('pointerup', () => tap.up(), opts)
  document.addEventListener('pointercancel', () => tap.cancel(), opts)
  // A scroll that began on a row: the page moving is the cancel, whichever pointer events the browser sent.
  document.addEventListener('scroll', () => tap.cancel(), { capture: true, passive: true })
  document.addEventListener('click', (event) => {
    const id = friendOf(event)
    if (id) tap.click(id)
  }, opts)
})

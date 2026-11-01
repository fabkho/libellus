import { durationToken, easingToken, prefersReducedMotion } from '#layers/ui/app/utils/motion'
import { LAUNCH_TAKEOVER_MOTION, launchTakeover } from '~/utils/launchTakeover'

/**
 * The launch takeover (docs/plans/new-logo.md, B; docs/MOTION.md, "Launch takeover"): the frame in
 * `app/spa-loading-template.html` took over from Android's static launch screen on the first paint, with the
 * lamp's glow swelling into the room; here it leaves as the app arrives.
 *
 * Nothing waits for anything: the frame is in the document before this runs and the swell is CSS, so the
 * app mounts as fast as it always did; when it has mounted (one frame later, so the app is under the frame
 * when the frame starts to go) the frame fades out on the tokens' `exit` — cutting the swell short if the
 * app came sooner. With Reduce Motion there is no swell and the frame crossfades on `standard`.
 *
 * The frame is moved out of Nuxt's SPA loading wrapper and removed here rather than left to Nuxt: the
 * wrapper (`#__nuxt-loader`) is taken away when the app's suspense resolves, instantly, which would cut the
 * leaving short. A tab, or a document without the frame, takes the `none` path and is left alone: Nuxt
 * removes the (hidden) template as it always does.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const frame = document.querySelector<HTMLElement>('[data-launch-frame]')
  const take = launchTakeover({
    frame: frame !== null,
    standalone: matchMedia('(display-mode: standalone)').matches,
    reducedMotion: prefersReducedMotion(),
  })
  if (!frame || take === 'none') return

  // Out of `#__nuxt-loader` (Nuxt's wrapper: it removes it whole when the app has mounted) and into the body,
  // so the frame outlives the mount and can leave on its own motion.
  document.body.append(frame)

  const motion = LAUNCH_TAKEOVER_MOTION[take]
  let left = false
  const leave = () => {
    if (left) return
    left = true
    const duration = durationToken(motion.duration)
    const leaving = frame.animate([{ opacity: '1' }, { opacity: '0' }], {
      duration,
      easing: easingToken(motion.easing),
      fill: 'forwards',
    })
    // Nothing is left in the document afterwards: no layer, no animation, no image (the frame is one node).
    const remove = () => frame.remove()
    leaving.finished.then(remove, remove)
    // `finished` does not settle in a document that is being hidden (an animation paused at the page's
    // lifecycle); twice the token's own length is the bound, so no second number is invented here.
    setTimeout(remove, 2 * duration)
  }

  // The app is mounted: one frame of it is painted under the frame, then the frame leaves.
  nuxtApp.hook('app:mounted', () => requestAnimationFrame(() => requestAnimationFrame(leave)))
  // An app that fails to mount (an uncaught boot error) shows its error page: the frame must not sit on it.
  nuxtApp.hook('app:error', leave)
})

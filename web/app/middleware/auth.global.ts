import { useSessionStore } from '~/stores/session'
import { followToOpen, peekFollow } from '~/utils/pendingFollow'
import { peekShare } from '~/utils/pendingShare'
import { isPublicPath } from '~/utils/publicPath'
import { AUTH_ROUTES, signedOutDestination, withoutSlash } from '~/utils/signedOutRoute'

/**
 * Everything else is behind the code. Signed-in members have no business on
 * the access screens; signed-out ones are sent to sign-in — or, when a code is
 * in the air and the app was relaunched at the start URL, back to where the
 * mail left off instead of asking for the address again.
 */
export default defineNuxtRouteMiddleware((to) => {
  // The design playground (a dev-only route tree; production builds strip it).
  if (import.meta.dev && to.path.startsWith('/prototype')) return
  const path = withoutSlash(to.path)
  // A member's reading page and its Book cards (#171) are for anyone with the link, signed in or not.
  if (isPublicPath(path)) return

  const session = useSessionStore()

  if (session.status === 'signedIn') {
    if (import.meta.client && path !== '/share' && peekShare(window.localStorage)) return navigateTo('/share', { replace: true })
    // A follow link (social v1, pages/f/[token].vue) kept the same way opens after a share waiting.
    if (import.meta.client) {
      const follow = followToOpen(path, peekFollow(window.localStorage), !!peekShare(window.localStorage))
      if (follow) return navigateTo(follow, { replace: true })
    }
    return AUTH_ROUTES.includes(path) ? navigateTo('/') : undefined
  }

  // A share (issue #91) or a follow link that came before the sign-in is kept on the device and
  // opened once the member is in, wherever the sign-in sends her first.
  const destination = signedOutDestination(to, { pending: !!session.pending, storage: import.meta.client ? window.localStorage : null })
  if (destination) return navigateTo(destination)
})

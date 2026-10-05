import { useSessionStore } from '~/stores/session'
import { keepShare, peekShare } from '~/utils/pendingShare'

/** The only screens a signed-out member may see. */
const AUTH_ROUTES = ['/sign-in', '/sign-up', '/verify']
/** Open to anybody, signed in or not: the privacy policy Google Play links to (#90). */
const PUBLIC_ROUTES = ['/privacy']

/**
 * Everything else is behind the code. Signed-in members have no business on
 * the access screens; signed-out ones are sent to sign-in — or, when a code is
 * in the air and the app was relaunched at the start URL, back to where the
 * mail left off instead of asking for the address again.
 */
export default defineNuxtRouteMiddleware((to) => {
  // The design playground (a dev-only route tree; production builds strip it).
  if (import.meta.dev && to.path.startsWith('/prototype')) return
  if (PUBLIC_ROUTES.includes(to.path)) return

  const session = useSessionStore()
  const isAuthRoute = AUTH_ROUTES.includes(to.path)

  // A share (issue #91, pages/share.vue) that came before the sign-in is kept on the device and
  // opened once the member is in, wherever the sign-in sends her first.
  const first = (value: unknown) => (Array.isArray(value) ? first(value[0]) : typeof value === 'string' ? value : null)

  if (session.status === 'signedIn') {
    if (import.meta.client && to.path !== '/share' && peekShare(window.localStorage)) return navigateTo('/share', { replace: true })
    return isAuthRoute ? navigateTo('/') : undefined
  }

  if (to.path === '/share' && import.meta.client) {
    const shared = { title: first(to.query.title), text: first(to.query.text), url: first(to.query.url) }
    if (shared.title || shared.text || shared.url) keepShare(window.localStorage, shared)
  }

  if (!isAuthRoute) return navigateTo(session.pending ? '/verify' : '/sign-in')
  if (to.path === '/verify' && !session.pending) return navigateTo('/sign-in')
})

import { useSessionStore } from '~/stores/session'

/** The only screens a signed-out member may see. */
const AUTH_ROUTES = ['/sign-in', '/sign-up', '/verify']

/**
 * Everything else is behind the code. Signed-in members have no business on
 * the access screens; signed-out ones are sent to sign-in — or, when a code is
 * in the air and the app was relaunched at the start URL, back to where the
 * mail left off instead of asking for the address again.
 */
export default defineNuxtRouteMiddleware((to) => {
  // The design playground (a dev-only route tree; production builds strip it).
  if (import.meta.dev && to.path.startsWith('/prototype')) return

  const session = useSessionStore()
  const isAuthRoute = AUTH_ROUTES.includes(to.path)

  if (session.status === 'signedIn') {
    return isAuthRoute ? navigateTo('/') : undefined
  }

  if (!isAuthRoute) return navigateTo(session.pending ? '/verify' : '/sign-in')
  if (to.path === '/verify' && !session.pending) return navigateTo('/sign-in')
})

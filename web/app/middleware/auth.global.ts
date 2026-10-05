import { useSessionStore } from '~/stores/session'
import { keepShare, peekShare } from '~/utils/pendingShare'

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
  // Cloudflare Pages serves each generated route as a folder and redirects `/sign-up` to
  // `/sign-up/`, so a page opened at its address arrives with the slash: compare without it.
  const path = to.path.length > 1 ? to.path.replace(/\/+$/, '') : to.path

  const session = useSessionStore()
  const isAuthRoute = AUTH_ROUTES.includes(path)

  // A share (issue #91, pages/share.vue) that came before the sign-in is kept on the device and
  // opened once the member is in, wherever the sign-in sends her first.
  const first = (value: unknown) => (Array.isArray(value) ? first(value[0]) : typeof value === 'string' ? value : null)

  if (session.status === 'signedIn') {
    if (import.meta.client && path !== '/share' && peekShare(window.localStorage)) return navigateTo('/share', { replace: true })
    return isAuthRoute ? navigateTo('/') : undefined
  }

  if (path === '/share' && import.meta.client) {
    const shared = { title: first(to.query.title), text: first(to.query.text), url: first(to.query.url) }
    if (shared.title || shared.text || shared.url) keepShare(window.localStorage, shared)
  }

  if (!isAuthRoute) return navigateTo(session.pending ? '/verify' : '/sign-in')
  if (path === '/verify' && !session.pending) return navigateTo('/sign-in')
})

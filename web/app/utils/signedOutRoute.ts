import { DEVICE_LIBRARY_KEY } from '../data/deviceLibrary'
import type { DeviceStorage } from '../data/localData'
import { keepPending, pendingLinkPath, pendingPath, pendingTokenIn, type PendingKind, type PendingValue } from './pendingLink'
import { isPublicPath } from './publicPath'

/**
 * Where a visitor who is not signed in goes, and the one place that says so: the auth middleware
 * (middleware/auth.global.ts) asks it once the session store knows nobody is signed in, and the
 * router's first navigation asks it before that (`knownSignedOut`, router.options.ts) so the page
 * behind the address is never fetched for a visitor who is sent away from it.
 */

/** The only screens a signed-out member may see. */
export const AUTH_ROUTES = ['/sign-in', '/sign-up', '/verify']

// Under the prefix signing out clears (data/localData.ts). The session store writes and reads it.
export const PENDING_SIGN_IN_KEY = 'libellus.pendingSignIn'

/** Cloudflare Pages serves each generated route as a folder and redirects `/sign-up` to `/sign-up/`: compare without the slash. */
export const withoutSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

const first = (value: unknown): string | null => (Array.isArray(value) ? first(value[0]) : typeof value === 'string' ? value : null)

/** What the device holds of each kind, as the middleware reads it before it navigates. */
export type PendingWaiting = { readonly [K in PendingKind]: PendingValue[K] | null }

/**
 * Where a signed-in member is sent for what she opened while signed out, or null for no move. The order is the rule
 * and it lives here with the rest of "where a visitor goes": a share first (issue #91), then a follow link (social v1,
 * pages/f/[token].vue), then a buddy read link (W3, pages/t/[token].vue). The ones after wait for the next navigation.
 * Nothing opens on `/share` (the page is taking a share in), and a link she is already on resolves itself: its page
 * spends the kept copy.
 */
export function pendingLinkToOpen(path: string, waiting: PendingWaiting): string | null {
  if (path === '/share') return null
  if (waiting.share) return pendingPath('share', waiting.share)
  if (waiting.follow) return pendingLinkPath('follow', path) ? null : pendingPath('follow', waiting.follow)
  if (waiting.buddyRead) return pendingLinkPath('buddyRead', path) ? null : pendingPath('buddyRead', waiting.buddyRead)
  return null
}

/**
 * The address a signed-out visitor is sent to from `to`, or undefined to let her stay (the access screens,
 * a public page). Keeps what she came for through the sign-in as the middleware always did: a share
 * (issue #91, pages/share.vue), a follow link (social v1, pages/f/[token].vue) and a buddy read link (pages/t/[token].vue). `pending`: a code is in the
 * air, so a screen other than sign-in goes back to the verify screen. `storage` is null on a server.
 */
export function signedOutDestination(
  to: { path: string; query: Record<string, unknown> },
  { pending, storage }: { pending: boolean; storage: DeviceStorage | null },
): string | undefined {
  const path = withoutSlash(to.path)
  // A member's reading page and its Book cards (#171) are for anyone with the link, signed in or not.
  if (isPublicPath(path)) return undefined
  const isAuthRoute = AUTH_ROUTES.includes(path)

  if (path === '/share' && storage) {
    const shared = { title: first(to.query.title), text: first(to.query.text), url: first(to.query.url), ebooks: first(to.query.ebooks) }
    // Shared ebook files wait in the service worker's cache meanwhile (#131).
    if (shared.title || shared.text || shared.url || shared.ebooks) keepPending(storage, 'share', shared)
  }

  const followed = pendingTokenIn('follow', path)
  if (followed && storage) keepPending(storage, 'follow', followed)

  const joining = pendingTokenIn('buddyRead', path)
  if (joining && storage) keepPending(storage, 'buddyRead', joining)

  if (!isAuthRoute) return pending ? '/verify' : '/sign-in'
  if (path === '/verify' && !pending) return '/sign-in'
  return undefined
}

/** supabase-js keeps a session under `sb-<project>-auth-token` (a name made from the API's host). */
const SESSION_KEY = /^sb-.+-auth-token$/

/**
 * True only when the device holds nothing of a member: no stored Supabase session, no copy of a Library
 * (the offline start opens that without a session, stores/session.ts, `restore`) and no code in the air.
 * A first visit and a signed-out device. Read synchronously, before the session store has restored
 * anything, which is the point; anything else is left to the middleware, so this never decides for a
 * member who might be signed in.
 */
export function knownSignedOut(storage: DeviceStorage): boolean {
  if (storage.getItem(DEVICE_LIBRARY_KEY) !== null || storage.getItem(PENDING_SIGN_IN_KEY) !== null) return false
  for (let index = 0; index < storage.length; index++) {
    if (SESSION_KEY.test(storage.key(index) ?? '')) return false
  }
  return true
}

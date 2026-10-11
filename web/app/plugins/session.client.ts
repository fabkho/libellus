import { createAuth } from '~/data/auth'
import { useSessionStore } from '~/stores/session'

/**
 * Restores the session before the first route resolves, so a member who is
 * already signed in never sees the sign-in screen flash past, and keeps the
 * store in step with Supabase afterwards — a token that expires or a sign-out
 * in another tab ends up on the sign-in screen either way.
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const session = useSessionStore()
  await session.restore()

  const client = useBackend()
  if (!client) return
  createAuth(client).onMemberChange((member) => {
    // Offline, "nobody" only means an expired token could not be renewed yet:
    // the member stays in her Library (stores/session.ts, restore). A real end
    // of the session is told again once the renewal reaches the server.
    if (!member && !isOnline()) return
    const wasSignedIn = session.status === 'signedIn'
    // The store's own sign-in already adopted this member; nothing to do twice. Another member
    // than the one the device holds clears the device first (stores/session.ts, signedInAs).
    // Online, "nobody" is an answer: the session ended (refused renewal, revoked, a sign-out in another
    // tab). The device forgets what it kept of the member, as signing out does (security round, F11).
    const settled = member
      ? member.id !== session.member?.id
        ? session.signedInAs(member)
        : null
      : session.member
        ? session.sessionEnded()
        : null
    // To the sign-in screen once the member is out (the route guard sends a signed-in member away from it).
    if (!member && wasSignedIn) void Promise.resolve(settled).then(() => nuxtApp.runWithContext(() => navigateTo('/sign-in')))
  })
})

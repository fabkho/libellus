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
    const wasSignedIn = session.status === 'signedIn'
    // The store's own sign-in already adopted this member; nothing to do twice.
    if (member?.id !== session.member?.id) session.adopt(member)
    if (!member && wasSignedIn) nuxtApp.runWithContext(() => navigateTo('/sign-in'))
  })
})

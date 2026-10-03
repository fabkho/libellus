import { defineStore } from 'pinia'
import { createAuth, type Auth, type AuthErrorCode, type Member } from '~/data/auth'
import { readSavedMember } from '~/data/deviceLibrary'
import { clearLocalData } from '~/data/localData'

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn'

/** An address a code has been mailed to, and which screen asked for it. */
export type PendingCode = {
  email: string
  flow: 'signIn' | 'signUp'
  sentAt: number
}

// Under the prefix signing out clears (data/localData.ts).
const PENDING_KEY = 'libellus.pendingSignIn'

// otp_expiry in supabase/config.toml. After that the stored address only leads
// to a code that no longer works, so it is dropped rather than restored.
const PENDING_TTL_MS = 60 * 60 * 1000

/**
 * Who is signed in, and which code is in the air. The screens read this and
 * call its actions; nothing below the store knows about Vue, and nothing above
 * it knows about Supabase.
 */
export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('loading')
  const member = ref<Member | null>(null)
  const pending = ref<PendingCode | null>(null)
  const error = ref<AuthErrorCode | null>(null)
  const busy = ref(false)

  // The address the sign-up screen starts with: the one the sign-in screen just
  // found no account for. Not persisted: nothing has been sent yet, so a
  // relaunch starts over.
  const signUpEmail = ref('')

  function auth(): Auth | null {
    const client = useBackend()
    return client ? createAuth(client) : null
  }

  /**
   * One place for the busy flag, the cleared error and the double-tap guard, so
   * no screen has to remember them. A build without its Supabase config falls
   * out here; the sign-in screen shows the config problem instead of the form,
   * so this is the belt to that screen's braces.
   */
  async function run<T>(action: (auth: Auth) => Promise<T>): Promise<T | null> {
    if (busy.value) return null
    const client = auth()
    if (!client) {
      error.value = 'not_configured'
      return null
    }
    busy.value = true
    error.value = null
    try {
      return await action(client)
    } finally {
      busy.value = false
    }
  }

  function readPending(): PendingCode | null {
    if (!import.meta.client) return null
    const raw = window.localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    try {
      const stored = JSON.parse(raw) as PendingCode
      if (!stored?.email || Date.now() - stored.sentAt > PENDING_TTL_MS) {
        window.localStorage.removeItem(PENDING_KEY)
        return null
      }
      return stored
    } catch {
      window.localStorage.removeItem(PENDING_KEY)
      return null
    }
  }

  /**
   * iOS kills an installed app while the member is in Mail reading the code and
   * relaunches it at the start URL. The address therefore has to outlive the
   * process, or they come back to an empty form.
   */
  function setPending(next: PendingCode) {
    pending.value = next
    if (import.meta.client) window.localStorage.setItem(PENDING_KEY, JSON.stringify(next))
  }

  function clearPending() {
    pending.value = null
    if (import.meta.client) window.localStorage.removeItem(PENDING_KEY)
  }

  /** The one way the signed-in state changes, wherever the news comes from. */
  function adopt(next: Member | null) {
    member.value = next
    status.value = next ? 'signedIn' : 'signedOut'
    if (next) clearPending()
  }

  /** Run by the session plugin before the first route resolves. */
  async function restore() {
    pending.value = readPending()
    const client = auth()
    if (!client) {
      status.value = 'signedOut'
      return
    }
    // Offline, an expired access token cannot be renewed, and Supabase retries
    // for about half a minute before it says so. The member whose Library this
    // device holds (data/deviceLibrary.ts) opens it at once instead: offline
    // nothing can be written anyway. Supabase's answer follows in the
    // background; only a device that holds no session at all is signed out by
    // it. A session that ended on the server meanwhile signs out once the
    // connection is back and the renewal is refused (plugins/session.client.ts).
    const saved = import.meta.client && !isOnline() ? readSavedMember(window.localStorage) : null
    if (saved) {
      adopt(saved)
      void client.restoreMember().then(({ member, unreachable }) => {
        if (member) adopt(member)
        else if (!unreachable) adopt(null)
      })
      return
    }
    adopt(await client.currentMember())
  }

  /** The sign-in screen: the address alone decides which screen comes next. */
  async function submitEmail(email: string): Promise<'verify' | 'signUp' | null> {
    const address = email.trim()
    return await run(async (client) => {
      const result = await client.requestCode(address)
      if (result.kind === 'error') {
        error.value = result.code
        return null
      }
      if (result.kind === 'unknownEmail') {
        signUpEmail.value = address
        return 'signUp'
      }
      setPending({ email: address, flow: 'signIn', sentAt: Date.now() })
      return 'verify'
    })
  }

  async function submitSignUp(input: { email: string; inviteCode: string }): Promise<'verify' | null> {
    const address = input.email.trim()
    return await run(async (client) => {
      const result = await client.requestSignUpCode({ email: address, inviteCode: input.inviteCode })
      if (result.error) {
        error.value = result.error
        return null
      }
      setPending({ email: address, flow: 'signUp', sentAt: Date.now() })
      return 'verify'
    })
  }

  async function verify(code: string): Promise<boolean> {
    const address = pending.value?.email
    if (!address) return false
    const verified = await run(async (client) => {
      const result = await client.verifyCode(address, code)
      if (result.error) {
        error.value = result.error
        return false
      }
      signUpEmail.value = ''
      adopt(await client.currentMember())
      return true
    })
    return verified ?? false
  }

  /**
   * Both flows resend the same way: asking for the first sign-up code already
   * created the account, so from the verify screen on there is only signing in.
   */
  async function resend(): Promise<boolean> {
    const current = pending.value
    if (!current) return false
    const sent = await run(async (client) => {
      const result = await client.requestCode(current.email)
      if (result.kind !== 'sent') {
        error.value = result.kind === 'error' ? result.code : 'unknown'
        return false
      }
      setPending({ ...current, sentAt: Date.now() })
      return true
    })
    return sent ?? false
  }

  /** "Use another email": the code in the mailbox is abandoned, not used. */
  function changeEmail() {
    clearPending()
    signUpEmail.value = ''
    error.value = null
  }

  function clearError() {
    error.value = null
  }

  /** Ends the session, then forgets what the device cached about the member. */
  async function signOut() {
    await auth()?.signOut()
    if (import.meta.client) clearLocalData(window.localStorage)
    pending.value = null
    adopt(null)
  }

  return {
    status,
    member,
    pending,
    signUpEmail,
    error,
    busy,
    adopt,
    restore,
    submitEmail,
    submitSignUp,
    verify,
    resend,
    changeEmail,
    clearError,
    signOut,
  }
})

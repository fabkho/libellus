import { defineStore } from 'pinia'
import { createAuth, type Auth, type AuthErrorCode, type DeleteAccountError, type Member } from '~/data/auth'
import { readSavedMember } from '~/data/deviceLibrary'
import { forgetMemberData, otherMemberHere } from '~/data/localData'
import { useSyncStore } from '~/stores/sync'
import { PENDING_FOLLOW_KEY } from '~/utils/pendingFollow'
import { PENDING_SHARE_KEY } from '~/utils/pendingShare'
import { PENDING_SIGN_IN_KEY } from '~/utils/signedOutRoute'

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn'

/** An address a code has been mailed to, and which screen asked for it. */
export type PendingCode = {
  email: string
  flow: 'signIn' | 'signUp'
  sentAt: number
}

// Under the prefix signing out clears (data/localData.ts); the router's first navigation reads it too.
const PENDING_KEY = PENDING_SIGN_IN_KEY

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
  /** The member is ending the session herself (sign out, delete account): the session listener leaves the clearing to those. */
  let signingOut = false

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
        if (member) void signedInAs(member)
        // A refusal (not a missing connection): the session is over, and so is what the device kept of it.
        else if (!unreachable) void sessionEnded()
      })
      return
    }
    const current = await client.currentMember()
    if (current) await signedInAs(current)
    // Nobody is signed in, and a member's data is still here: her session died while the app was closed.
    else if (import.meta.client && readSavedMember(window.localStorage)) await sessionEnded()
    else adopt(null)
  }

  /**
   * A member is signed in (a code verified, a session restored, a sign-in in another tab). If
   * what the device holds is another member's, all of it goes first: nothing of the last one
   * is shown to, or sent for, this one (security round, F11).
   */
  async function signedInAs(next: Member) {
    if (import.meta.client) {
      if (otherMemberHere(window.localStorage, next.id, readSavedMember(window.localStorage)?.id ?? null)) await forgetDevice()
    }
    adopt(next)
  }

  /**
   * The session ended without the member asking (the refresh token is gone: revoked, expired,
   * a sign-out in another tab): the device forgets what it kept of her, as a sign-out does, but
   * keeps what is not hers (a sign-in or share waiting) and the writes still waiting to sync, so
   * they go out when she is back (the outbox is hers by id and sent for no one else). Not for a
   * missing connection: offline the session cannot be renewed, which proves nothing.
   */
  async function sessionEnded() {
    // Her own sign-out or account deletion clears the device itself, after the session is over.
    if (signingOut) {
      adopt(null)
      return
    }
    await forgetDevice({ sessionEnded: true })
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
      const next = await client.currentMember()
      if (next) await signedInAs(next)
      else adopt(null)
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

  // ------------------------------------------------------------- the name

  /** The name sheet's save is on its way. */
  const nameBusy = ref(false)
  const nameError = ref<AuthErrorCode | 'offline' | null>(null)

  /**
   * Sets the first name the greeting and the avatar use, or clears it (blank).
   * Returns whether it was saved; on a refusal `nameError` says why.
   */
  async function setName(name: string): Promise<boolean> {
    const client = auth()
    if (!client || nameBusy.value) return false
    nameBusy.value = true
    nameError.value = null
    try {
      const result = await client.setName(name, { online: isOnline })
      if (result.error || !result.member) {
        nameError.value = result.error ?? 'unknown'
        return false
      }
      adopt(result.member)
      return true
    } finally {
      nameBusy.value = false
    }
  }

  function clearNameError() {
    nameError.value = null
  }

  /**
   * Ends the session, then forgets what the device cached about the member: her
   * Library and, in IndexedDB, the writes still waiting to sync (issue #93; the
   * header's sync chip says how many).
   */
  async function signOut() {
    signingOut = true
    try {
      await auth()?.signOut()
      await forgetDevice()
    } finally {
      signingOut = false
    }
  }

  /**
   * The device forgets the member: the Library's copy and every other cache of hers under `libellus.`
   * (descriptions, genres, ebook metadata, the feed, her places and highlights, the views she
   * kept), the outbox and her ebook records in IndexedDB, her ebook files, the covers and
   * portraits she browsed, the pending address. `sessionEnded`: her session died by itself, so
   * what waits for the next sign-in (the address, a share, a follow) and her unsynced writes stay.
   */
  async function forgetDevice({ sessionEnded = false }: { sessionEnded?: boolean } = {}) {
    if (import.meta.client) {
      const memberId = member.value?.id ?? readSavedMember(window.localStorage)?.id ?? null
      useSyncStore().close()
      await forgetMemberData(
        {
          storage: window.localStorage,
          indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
          caches: typeof caches === 'undefined' ? null : caches,
          files: navigator.storage,
        },
        { sessionEnded, memberId, keep: [PENDING_SIGN_IN_KEY, PENDING_SHARE_KEY, PENDING_FOLLOW_KEY] },
      )
    }
    if (!sessionEnded) pending.value = null
    adopt(null)
  }

  // ------------------------------------------------------- deleting the account

  /** The delete is on its way. */
  const deleting = ref(false)
  /** Shown once on Sign in after the account was deleted here (issue #101). */
  const accountDeleted = ref(false)

  /**
   * Deletes the member's account on the server (`createAuth.deleteAccount`),
   * then does what signing out does: the outbox is discarded with the rest of
   * what the device cached (the theme stays). Returns why it did not happen,
   * or null when it did; on a failure nothing was removed anywhere.
   */
  async function deleteAccount(): Promise<DeleteAccountError | null> {
    const client = auth()
    if (!client || deleting.value) return 'unknown'
    deleting.value = true
    signingOut = true
    try {
      const result = await client.deleteAccount({ online: isOnline })
      if (result.error) return result.error
      await forgetDevice()
      accountDeleted.value = true
      return null
    } finally {
      deleting.value = false
      signingOut = false
    }
  }

  function clearAccountDeleted() {
    accountDeleted.value = false
  }

  return {
    status,
    member,
    pending,
    signUpEmail,
    error,
    busy,
    adopt,
    signedInAs,
    sessionEnded,
    restore,
    submitEmail,
    submitSignUp,
    verify,
    resend,
    changeEmail,
    clearError,
    nameBusy,
    nameError,
    setName,
    clearNameError,
    signOut,
    deleting,
    accountDeleted,
    deleteAccount,
    clearAccountDeleted,
  }
})

import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Every way the access flow can fail, as a stable code. The data layer never
 * words an error: the screens map a code to copy (`auth.error.<code>` in the
 * message file), and a native port maps the same codes to its own strings.
 */
export type AuthErrorCode =
  /** Sign-up without an invite code. */
  | 'invite_required'
  /** Nobody handed that code out. */
  | 'invite_invalid'
  | 'invite_expired'
  /** Used as often as its limit allows. */
  | 'invite_exhausted'
  /** The code was live when the mail was requested and is not any more at verify. */
  | 'invite_gone'
  /**
   * Wrong, expired or already used. GoTrue answers all three identically
   * (`otp_expired`) on purpose, so the endpoint cannot be used to probe codes.
   */
  | 'code_invalid'
  /** Another mail was asked for too soon (the resend button tapped twice). */
  | 'rate_limited'
  | 'email_invalid'
  /** The build has no Supabase URL or key. */
  | 'not_configured'
  | 'unknown'

export type AuthResult = { error: AuthErrorCode | null }

/**
 * What asking for a code can come back as. An address nobody has an account
 * for is not a failure — it is the branch into sign-up — so it carries no error.
 */
export type CodeRequest =
  | { kind: 'sent' }
  | { kind: 'unknownEmail' }
  | { kind: 'error'; code: AuthErrorCode }

/** Who is signed in. Only what the app shows; the token never leaves the client. */
export type Member = { id: string; email: string }

type AuthFailure = { message: string; code?: string }

/**
 * Turns what GoTrue and the signup gate (supabase/migrations) say into a stable
 * code. GoTrue does not pass a trigger's message on: it answers
 * `unexpected_failure` with a wording of its own, one per place where the gate
 * can refuse. Both mean the invite gate and nothing else — it is the only thing
 * hanging off those two writes.
 */
export function mapAuthError(failure: AuthFailure): AuthErrorCode {
  const m = failure.message.toLowerCase()
  if (m.includes('invite_code_required')) return 'invite_required'
  if (m.includes('invite_code_invalid')) return 'invite_invalid'
  if (m.includes('invite_code_expired')) return 'invite_expired'
  if (m.includes('invite_code_exhausted')) return 'invite_exhausted'

  // At verify: the address was proved but the invite behind it is gone.
  if (m.includes('error confirming user')) return 'invite_gone'
  // At sign-up the form has pre-flighted the code, so this is the narrow race
  // where it goes stale in between.
  if (m.includes('database error saving new user')) return 'invite_invalid'

  if (
    failure.code === 'over_email_send_rate_limit' ||
    failure.code === 'over_request_rate_limit' ||
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    m.includes('for security purposes')
  ) {
    return 'rate_limited'
  }
  if (failure.code === 'otp_expired' || m.includes('expired') || (m.includes('invalid') && m.includes('token'))) {
    return 'code_invalid'
  }
  if (failure.code === 'email_address_invalid' || failure.code === 'validation_failed') {
    return 'email_invalid'
  }
  return 'unknown'
}

/**
 * How GoTrue words "I will not create an account for this address" when
 * `shouldCreateUser` is false. The screens turn it into the sign-up step rather
 * than into a sentence, so it is recognised rather than mapped.
 */
function isUnknownEmail(failure: AuthFailure): boolean {
  const m = failure.message.toLowerCase()
  return (
    failure.code === 'otp_disabled' ||
    m.includes('signups not allowed') ||
    m.includes('signup is disabled')
  )
}

/**
 * What the app asks of Supabase Auth. Framework-free so the rules run against
 * a real local stack in plain Node (web/tests): the session store owns state,
 * this owns the calls.
 */
export function createAuth(client: SupabaseClient) {
  return {
    /**
     * The sign-in screen, and the resend button on both flows: mail a code to an
     * address that already has an account, never create one. Once a sign-up has
     * asked for its first code the account exists, so resending is this call in
     * either flow.
     */
    async requestCode(email: string): Promise<CodeRequest> {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        // Signing in must never quietly create an account: the invite code is
        // the only door in, and an unknown address is answered with the sign-up
        // step instead of an error.
        options: { shouldCreateUser: false },
      })
      if (!error) return { kind: 'sent' }
      if (isUnknownEmail(error)) return { kind: 'unknownEmail' }
      return { kind: 'error', code: mapAuthError(error) }
    },

    /** New member: check the invite, then create the account and mail a code. */
    async requestSignUpCode({
      email,
      inviteCode,
    }: {
      email: string
      inviteCode: string
    }): Promise<AuthResult> {
      const code = inviteCode.trim()
      if (!code) return { error: 'invite_required' }

      // Pre-flight, so a wrong code fails against the field that caused it and
      // no account is created a moment before the trigger would roll it back.
      // The trigger still enforces the same rules when the account is created.
      const { data: status, error: rpcError } = await client.rpc('invite_code_status', {
        p_code: code,
      })
      if (rpcError) return { error: mapAuthError(rpcError) }
      if (status === 'missing') return { error: 'invite_required' }
      if (status === 'expired') return { error: 'invite_expired' }
      if (status === 'exhausted') return { error: 'invite_exhausted' }
      if (status !== 'valid') return { error: 'invite_invalid' }

      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true, data: { invite_code: code } },
      })
      return { error: error ? mapAuthError(error) : null }
    },

    /** Both flows end here: the six digits from the mail. */
    async verifyCode(email: string, code: string): Promise<AuthResult> {
      const { error } = await client.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      return { error: error ? mapAuthError(error) : null }
    },

    /** The session stored on this device, if any. Read locally; no round trip. */
    async currentMember(): Promise<Member | null> {
      const { data } = await client.auth.getSession()
      const user = data.session?.user
      return user?.email ? { id: user.id, email: user.email } : null
    },

    /**
     * `currentMember`, and whether the answer is only for want of a server: a
     * stored session whose access token has expired is renewed first, and
     * without a connection that fails (after about half a minute of retries).
     * Then nobody is signed in as far as Supabase can say, yet the session is
     * still on the device and will be renewed once the connection is back
     * (issue #15: the app opens offline).
     */
    async restoreMember(): Promise<{ member: Member | null; unreachable: boolean }> {
      const { data, error } = await client.auth.getSession()
      const user = data.session?.user
      const member = user?.email ? { id: user.id, email: user.email } : null
      return { member, unreachable: !member && isAuthRetryableFetchError(error) }
    },

    /**
     * Hears about sign-ins and sign-outs wherever they happen (a token that
     * could not be refreshed, a sign-out in another tab). Returns the way to
     * stop listening.
     */
    onMemberChange(listener: (member: Member | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user
        listener(user?.email ? { id: user.id, email: user.email } : null)
      })
      return () => data.subscription.unsubscribe()
    },

    /** Ends the session on this device and revokes it on the server. */
    async signOut(): Promise<void> {
      await client.auth.signOut()
    },
  }
}

export type Auth = ReturnType<typeof createAuth>

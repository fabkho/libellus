/**
 * `waitlist-invite`: the owner's Invite button on her Waitlist screen (issue #171).
 *
 *   POST /functions/v1/waitlist-invite        { "id": "<waitlist entry uuid>" }
 *   Authorization: Bearer <the owner's access token>
 *
 *   200 { code, expiresAt, emailed: true }                                    mailed and marked invited
 *   200 { code, expiresAt, emailed: false, reason: 'not_configured' }         no SMTP secrets: nothing sent
 *   200 { code, expiresAt, emailed: false, reason: 'send_failed' }            the SMTP server refused or was away
 *   200 { code, expiresAt, emailed: true, invited: false }                    mailed, but the marking failed
 *   400 { error: 'bad_request' }      no JSON body, or no entry id in it
 *   401 { error: 'unauthorized' }     no session
 *   403 { error: 'not_owner' }        the database says she is not the instance's owner
 *   404 { error: 'not_found' }        no entry with that id (deleted meanwhile)
 *   405 { error: 'method_not_allowed' }
 *   502 { error: 'database_failed' }
 *
 * The database decides everything about who may and which code: the function asks
 * `owner_waitlist_prepare_invite` with the caller's own session (so it holds no service-role
 * key), which answers the address and a one-use code (the entry's own while it is still usable).
 * Then the mail goes out, and only then is the entry marked invited (`owner_waitlist_set_invited`).
 * When mail is not configured or the send fails, the entry stays waiting and the code still comes
 * back, so the owner can copy it and send it another way; her next Invite gets the same code.
 *
 * Nothing logged ever carries the address or the code: a failed send logs the kind of failure only.
 * Everything it talks to is injected (index.ts wires the real ones), so the tests run offline.
 */
import { inviteMail, type Mailer } from './mail.ts'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What `owner_waitlist_prepare_invite` answers. */
export type PreparedInvite = { email: string; code: string; expiresAt: string }

/**
 * Why the database said no: the caller is not the owner, or the entry is gone; anything else is
 * `failed`, with the database's error code (never its message) for the log.
 */
export class DatabaseRefusal extends Error {
  constructor(readonly reason: 'not_owner' | 'not_found' | 'failed', readonly code?: string) {
    super(reason)
    this.name = 'DatabaseRefusal'
  }
}

/** The two database functions, asked as the caller. They throw a `DatabaseRefusal`. */
export type Database = {
  prepareInvite: (id: string) => Promise<PreparedInvite>
  setInvited: (id: string) => Promise<void>
}

export type HandlerDeps = {
  /** The database as the caller with this Authorization header sees it. */
  database: (authorization: string) => Database
  /** The SMTP mailer, or null when the SMTP secrets are not set. */
  mailer: Mailer | null
  /** `LIBELLUS_SITE_URL`, for the sign-up link in the mail; null leaves the link out. */
  siteUrl: string | null
  log?: (line: string) => void
}

export type InviteAnswer = {
  code: string
  expiresAt: string
  emailed: boolean
  reason?: 'not_configured' | 'send_failed'
  /** Only when the mail went out but the entry could not be marked invited: the app marks it then. */
  invited?: false
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * What kind of failure a send was, for the log: an SMTP reply code or a client error code, never
 * the message, which may quote the address ("<x@y>: Recipient address rejected").
 */
export function failureKind(error: unknown): string {
  if (error && typeof error === 'object') {
    const { responseCode, code, name } = error as { responseCode?: unknown; code?: unknown; name?: unknown }
    if (typeof responseCode === 'number') return `smtp ${responseCode}`
    if (typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code)) return code
    if (typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name)) return name
  }
  return 'unknown'
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((line: string) => console.error(line))

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const authorization = request.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+/i.test(authorization)) return json(401, { error: 'unauthorized' })

    let id: unknown
    try {
      id = ((await request.json()) as { id?: unknown } | null)?.id
    } catch {
      return json(400, { error: 'bad_request' })
    }
    if (typeof id !== 'string' || !UUID.test(id)) return json(400, { error: 'bad_request' })

    const database = deps.database(authorization)
    let invite: PreparedInvite
    try {
      invite = await database.prepareInvite(id)
    } catch (error) {
      const reason = error instanceof DatabaseRefusal ? error.reason : 'failed'
      if (reason === 'not_owner') return json(403, { error: 'not_owner' })
      if (reason === 'not_found') return json(404, { error: 'not_found' })
      log(`waitlist-invite: preparing the invite failed (${failureKind(error)})`)
      return json(502, { error: 'database_failed' })
    }

    const answer = (fields: Partial<InviteAnswer> & { emailed: boolean }): InviteAnswer => ({
      code: invite.code,
      expiresAt: invite.expiresAt,
      ...fields,
    })

    if (!deps.mailer) return json(200, answer({ emailed: false, reason: 'not_configured' }))

    try {
      await deps.mailer.send(inviteMail({ to: invite.email, code: invite.code, expiresAt: invite.expiresAt, siteUrl: deps.siteUrl }))
    } catch (error) {
      log(`waitlist-invite: sending failed (${failureKind(error)})`)
      return json(200, answer({ emailed: false, reason: 'send_failed' }))
    }

    try {
      await database.setInvited(id)
    } catch (error) {
      // The mail is out: say so. The entry stays waiting in the database, and the app marks it by
      // hand (owner_waitlist_set_invited); a second Invite would mail the same code again.
      log(`waitlist-invite: marking the entry invited failed (${failureKind(error)})`)
      return json(200, answer({ emailed: true, invited: false }))
    }
    return json(200, answer({ emailed: true }))
  }
}

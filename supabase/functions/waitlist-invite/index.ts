/**
 * The `waitlist-invite` edge function (issue #171): handler.ts with the real database, asked as
 * the caller, and the real SMTP mailer. README.md says how to run, configure and deploy it.
 *
 * `verify_jwt` is on (supabase/config.toml): only a signed-in member's request reaches the
 * handler. Which member may invite is the database's call: the client below carries the caller's
 * own Authorization header and the anon key, never the service-role key, so
 * `owner_waitlist_prepare_invite` and `owner_waitlist_set_invited` refuse anyone but the instance's
 * owner (`not_owner`) exactly as they do in the app.
 *
 * Without the SMTP secrets the function still answers with the code (`emailed: false`,
 * `reason: 'not_configured'`), so the owner can send it herself.
 */
import { createClient } from '@supabase/supabase-js'
import { createHandler, DatabaseRefusal, type PreparedInvite } from './handler.ts'
import { smtpConfigFromEnv } from './mail.ts'
import { createSmtpMailer } from './smtp.ts'

const url = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
if (!url || !anonKey) throw new Error('waitlist-invite needs SUPABASE_URL and SUPABASE_ANON_KEY')

const smtp = smtpConfigFromEnv((name) => Deno.env.get(name))

/** A database error as the handler reads it: the owner check and an entry that is not there. */
function refusal(error: { code?: string; message?: string }): DatabaseRefusal {
  const message = error.message ?? ''
  if (error.code === '42501' || message.includes('not_owner')) return new DatabaseRefusal('not_owner')
  if (error.code === 'P0002' || message.includes('waitlist_entry_not_found')) return new DatabaseRefusal('not_found')
  return new DatabaseRefusal('failed', error.code ?? 'failed')
}

type PreparedRow = { email: string; code: string; expires_at: string }

Deno.serve(createHandler({
  database(authorization) {
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return {
      async prepareInvite(id): Promise<PreparedInvite> {
        const { data, error } = await supabase.rpc('owner_waitlist_prepare_invite', { p_id: id })
        if (error) throw refusal(error)
        const row = (data as PreparedRow[] | null)?.[0]
        if (!row) throw new DatabaseRefusal('failed')
        return { email: row.email, code: row.code, expiresAt: row.expires_at }
      },
      async setInvited(id) {
        const { error } = await supabase.rpc('owner_waitlist_set_invited', { p_ids: [id], p_invited: true })
        if (error) throw refusal(error)
      },
    }
  },
  mailer: smtp ? createSmtpMailer(smtp) : null,
  siteUrl: Deno.env.get('LIBELLUS_SITE_URL') ?? null,
}))

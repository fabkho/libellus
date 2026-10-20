/**
 * "Import done" as a Web Push: what the `notify` action does (handler.ts) when the database says a job ended
 * (`private.import_push_kick`, a trigger on `import_jobs`).
 *
 *   claim the job's push (`import_job_claim_push`: once a job, whatever is kicked twice) → her subscriptions → one message each
 *
 * What the Push service answers decides what becomes of the subscription: 201 it took it (`last_ok_at`), 404 / 410 the browser
 * is gone (the subscription is deleted), anything else is no fault of hers: a refusal is logged, and when NOBODY could be
 * reached for a reason that may pass (a timeout, a 429, a 5xx) the claim is given back, so the next kick (pg_cron, a minute
 * later) tries again. The words are the app's own (`import.ambient.done` …), in the language she agreed in.
 */
import type { PushAnswer, PushTarget } from './webpush.ts'

/** What the job came to (`import_job_claim_push`). */
export type PushJob = { member_id: string; state: 'done' | 'failed'; added: number; kept: number; failed: number }

export type Subscription = PushTarget & { id: string; locale: string }

export type PushStore = {
  /** Claims the job's push; null when it is not over, ended cancelled, or was claimed already. */
  claim: (job: string) => Promise<PushJob | null>
  /** Gives the claim back (nobody could be reached). */
  unclaim: (job: string) => Promise<void>
  subscriptions: (member: string) => Promise<Subscription[]>
  /** The Push service took a message for it. */
  sent: (id: string) => Promise<void>
  /** The Push service says it is gone for good (404, 410). */
  gone: (id: string) => Promise<void>
}

/** The notification as the service worker shows it (`web/public/sw-push.js` reads exactly these). */
export type Message = { title: string; body: string; url: string; tag: string; lang: 'en' | 'de' }

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{count}', String(n)))

/** The words, EN and DE (the app's `import.ambient`, shorter: a notification has two lines). */
export function messageOf(job: Pick<PushJob, 'state' | 'added' | 'kept' | 'failed'>, locale: string): Message {
  const lang = locale === 'de' ? 'de' : 'en'
  const base = { url: '/import', tag: 'import-job', lang } as const
  if (job.state === 'failed') {
    return lang === 'de'
      ? { ...base, title: 'Import gestoppt', body: 'Dein Import wurde gestoppt – tippen und nochmal versuchen' }
      : { ...base, title: 'Import stopped', body: 'Your import stopped — tap to try again' }
  }
  if (lang === 'de') {
    const added = job.added
      ? count(job.added, 'Ein Buch zu deiner Bibliothek hinzugefügt', '{count} Bücher zu deiner Bibliothek hinzugefügt')
      : 'Nichts Neues in deiner Bibliothek'
    const rest = [job.kept ? `${job.kept} schon da` : '', job.failed ? `${job.failed} fehlgeschlagen` : '']
    return { ...base, title: 'Import fertig', body: [added, ...rest].filter(Boolean).join(' · ') }
  }
  const added = job.added
    ? count(job.added, 'One book added to your Library', '{count} books added to your Library')
    : 'Nothing new for your Library'
  const rest = [job.kept ? `${job.kept} kept` : '', job.failed ? `${job.failed} failed` : '']
  return { ...base, title: 'Import done', body: [added, ...rest].filter(Boolean).join(' · ') }
}

export type NotifyResult = {
  /** `claimed`: the job's push was ours to send · `taken`: somebody sent it, or the job is not over. */
  state: 'claimed' | 'taken'
  sent: number
  gone: number
  /** Answers that are no use trying again (a refusal): logged, the subscription stays. */
  refused: number
  /** Browsers the Push service could not be reached for (a timeout, 429, 5xx). */
  later: number
}

export type NotifyDeps = {
  store: PushStore
  /** One message to one browser: the encrypted request to its address (webpush.ts `sendPush`, with the VAPID key). */
  send: (target: PushTarget, payload: Uint8Array) => Promise<PushAnswer>
  log?: (message: string) => void
}

const transient = (status: number) => status === 0 || status === 429 || status >= 500

export function createNotify(deps: NotifyDeps): (job: string) => Promise<NotifyResult> {
  const log = deps.log ?? ((message: string) => console.log(message))
  const encoder = new TextEncoder()
  return async (jobId) => {
    const { store } = deps
    const job = await store.claim(jobId)
    const result: NotifyResult = { state: job ? 'claimed' : 'taken', sent: 0, gone: 0, refused: 0, later: 0 }
    if (!job) return result
    try {
      const subscriptions = await store.subscriptions(job.member_id)
      await Promise.all(
        subscriptions.map(async (subscription) => {
          const payload = encoder.encode(JSON.stringify(messageOf(job, subscription.locale)))
          const answer = await deps.send(subscription, payload)
          if (answer.status >= 200 && answer.status < 300) {
            result.sent++
            await store.sent(subscription.id).catch((error) => log(`import-job: push: last_ok_at not saved: ${error}`))
          } else if (answer.status === 404 || answer.status === 410) {
            result.gone++
            await store.gone(subscription.id).catch((error) => log(`import-job: push: gone subscription not deleted: ${error}`))
          } else if (transient(answer.status)) {
            result.later++
            log(`import-job: push for ${jobId}: ${subscription.id} not reached (${answer.status}${answer.error ? ` ${answer.error}` : ''})`)
          } else {
            result.refused++
            log(`import-job: push for ${jobId}: ${subscription.id} refused (${answer.status}${answer.error ? ` ${answer.error}` : ''})`)
          }
        }),
      )
    } catch (error) {
      // The database could not be asked: give the claim back, the next kick tries again.
      await store.unclaim(jobId).catch(() => {})
      throw error
    }
    // Nobody took it, and somebody might have: the next kick tries again.
    if (result.sent === 0 && result.later > 0) await store.unclaim(jobId)
    log(`import-job: push for ${jobId} (${job.state}): ${JSON.stringify(result)}`)
    return result
  }
}

/** The database side, over the service-role client's slice (`rpc`, `from`). */
export type PushDb = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  from: (table: 'push_subscriptions') => {
    select: (columns: string) => { eq: (column: string, value: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
    update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> }
    delete: () => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> }
  }
}

export function createPushStore(db: PushDb): PushStore {
  const check = (name: string, error: { message: string } | null) => {
    if (error) throw new Error(`${name}: ${error.message}`)
  }
  return {
    async claim(job) {
      const { data, error } = await db.rpc('import_job_claim_push', { p_job: job })
      check('import_job_claim_push', error)
      return (data as PushJob | null) ?? null
    },
    async unclaim(job) {
      const { error } = await db.rpc('import_job_unclaim_push', { p_job: job })
      check('import_job_unclaim_push', error)
    },
    async subscriptions(member) {
      const { data, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth, locale').eq('member_id', member)
      check('push_subscriptions', error)
      return (data as Subscription[] | null) ?? []
    },
    async sent(id) {
      const { error } = await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', id)
      check('push_subscriptions', error)
    },
    async gone(id) {
      const { error } = await db.from('push_subscriptions').delete().eq('id', id)
      check('push_subscriptions', error)
    },
  }
}

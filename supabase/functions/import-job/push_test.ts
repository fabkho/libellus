import { assertEquals } from '@std/assert'
import { createNotify, createPushStore, messageOf, type PushDb, type PushJob, type PushStore, type Subscription } from './push.ts'
import type { PushAnswer, PushTarget } from './webpush.ts'

/**
 * The job's push (push.ts) on an in-memory database and a stubbed Push service: one push a job however often it is kicked, the
 * words in the language she agreed in, a 404 / 410 deletes the subscription, a Push service that cannot be reached gives the
 * claim back.
 */

const ADA = 'member-ada'
const DONE: PushJob = { member_id: ADA, state: 'done', added: 12, kept: 4, failed: 2 }

const subscription = (id: string, locale = 'en'): Subscription => ({ id, endpoint: `https://push.example.test/${id}`, p256dh: 'p', auth: 'a', locale })

/** The database: jobs by id (claimed once), her subscriptions, what was saved and deleted. */
function world(jobs: Record<string, PushJob>, subscriptions: Subscription[]) {
  const state = { claimed: new Set<string>(), unclaimed: [] as string[], subscriptions: [...subscriptions], ok: [] as string[] }
  const store: PushStore = {
    claim: (job) => {
      if (!jobs[job] || state.claimed.has(job)) return Promise.resolve(null)
      state.claimed.add(job)
      return Promise.resolve(jobs[job]!)
    },
    unclaim: (job) => {
      state.claimed.delete(job)
      state.unclaimed.push(job)
      return Promise.resolve()
    },
    subscriptions: (member) => Promise.resolve(member === ADA ? state.subscriptions : []),
    sent: (id) => {
      state.ok.push(id)
      return Promise.resolve()
    },
    gone: (id) => {
      state.subscriptions = state.subscriptions.filter((one) => one.id !== id)
      return Promise.resolve()
    },
  }
  return { state, store }
}

/** A Push service that answers by endpoint (201 by default) and keeps what it was sent. */
function service(answers: Record<string, number> = {}) {
  const sent: { endpoint: string; message: Record<string, string> }[] = []
  const send = (target: PushTarget, payload: Uint8Array): Promise<PushAnswer> => {
    sent.push({ endpoint: target.endpoint, message: JSON.parse(new TextDecoder().decode(payload)) })
    return Promise.resolve({ status: answers[target.endpoint] ?? 201 })
  }
  return { sent, send }
}

Deno.test('a done job: "Import done", what it added and what else it came to, to every browser she agreed in', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('phone'), subscription('laptop', 'de')])
  const push = service()
  const result = await createNotify({ store, send: push.send, log: () => {} })('j1')
  assertEquals(result, { state: 'claimed', sent: 2, gone: 0, refused: 0, later: 0 })
  assertEquals(push.sent.map((one) => one.message), [
    { title: 'Import done', body: '12 books added to your Library · 4 kept · 2 failed', url: '/import', tag: 'import-job', lang: 'en' },
    { title: 'Import fertig', body: '12 Bücher zu deiner Bibliothek hinzugefügt · 4 schon da · 2 fehlgeschlagen', url: '/import', tag: 'import-job', lang: 'de' },
  ])
  assertEquals(state.ok.sort(), ['laptop', 'phone'], 'last_ok_at of both')
})

Deno.test('one push a job: a second kick, or two at once, sends nothing', async () => {
  const { store } = world({ j1: DONE }, [subscription('phone')])
  const push = service()
  const notify = createNotify({ store, send: push.send, log: () => {} })
  const [first, second] = await Promise.all([notify('j1'), notify('j1')])
  assertEquals([first.state, second.state].sort(), ['claimed', 'taken'])
  assertEquals((await notify('j1')).state, 'taken')
  assertEquals(push.sent.length, 1)
})

Deno.test('a job that is not over (or not hers to tell) sends nothing', async () => {
  const { store } = world({}, [subscription('phone')])
  const push = service()
  assertEquals(await createNotify({ store, send: push.send, log: () => {} })('live'), { state: 'taken', sent: 0, gone: 0, refused: 0, later: 0 })
  assertEquals(push.sent.length, 0)
})

Deno.test('the Push service says 410 or 404: the subscription is deleted, the others are told', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('old'), subscription('lost'), subscription('phone')])
  const push = service({ 'https://push.example.test/old': 410, 'https://push.example.test/lost': 404 })
  const result = await createNotify({ store, send: push.send, log: () => {} })('j1')
  assertEquals(result, { state: 'claimed', sent: 1, gone: 2, refused: 0, later: 0 })
  assertEquals(state.subscriptions.map((one) => one.id), ['phone'])
  assertEquals(state.ok, ['phone'])
  assertEquals(state.unclaimed, [], 'a browser that is gone is no reason to try again')
})

Deno.test('a Push service that cannot be reached for anybody gives the claim back: the next kick tries again', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('phone'), subscription('laptop')])
  const down = service({ 'https://push.example.test/phone': 503, 'https://push.example.test/laptop': 0 })
  const notify = createNotify({ store, send: down.send, log: () => {} })
  assertEquals(await notify('j1'), { state: 'claimed', sent: 0, gone: 0, refused: 0, later: 2 })
  assertEquals(state.unclaimed, ['j1'])
  assertEquals(state.subscriptions.length, 2, 'nothing is deleted for a service that did not answer')
  // It is back: the same job is told now.
  const back = service()
  assertEquals((await createNotify({ store, send: back.send, log: () => {} })('j1')).sent, 2)
})

Deno.test('one browser reached is enough: no claim given back (the others are not told twice)', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('phone'), subscription('laptop')])
  const push = service({ 'https://push.example.test/laptop': 500 })
  assertEquals(await createNotify({ store, send: push.send, log: () => {} })('j1'), { state: 'claimed', sent: 1, gone: 0, refused: 0, later: 1 })
  assertEquals(state.unclaimed, [])
})

Deno.test('a refusal (bad VAPID key, a 400) is logged and is no reason to try again, nor to delete', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('phone')])
  const logged: string[] = []
  const push = service({ 'https://push.example.test/phone': 403 })
  const result = await createNotify({ store, send: push.send, log: (line) => logged.push(line) })('j1')
  assertEquals(result, { state: 'claimed', sent: 0, gone: 0, refused: 1, later: 0 })
  assertEquals(state.unclaimed, [])
  assertEquals(state.subscriptions.length, 1)
  assertEquals(logged.some((line) => line.includes('refused (403')), true)
})

Deno.test('the database cannot be asked: the claim is given back and the kick fails', async () => {
  const { state, store } = world({ j1: DONE }, [subscription('phone')])
  const broken: PushStore = { ...store, subscriptions: () => Promise.reject(new Error('push_subscriptions: connection refused')) }
  let thrown = ''
  try {
    await createNotify({ store: broken, send: service().send, log: () => {} })('j1')
  } catch (error) {
    thrown = (error as Error).message
  }
  assertEquals(thrown, 'push_subscriptions: connection refused')
  assertEquals(state.unclaimed, ['j1'])
})

Deno.test('the words: done, nothing new, one book, stopped; English and German', () => {
  const at = (job: Partial<PushJob>, locale = 'en') => messageOf({ state: 'done', added: 0, kept: 0, failed: 0, ...job }, locale)
  assertEquals(at({ added: 1 }).body, 'One book added to your Library')
  assertEquals(at({ added: 30 }).body, '30 books added to your Library')
  assertEquals(at({ added: 0, kept: 5 }).body, 'Nothing new for your Library · 5 kept')
  assertEquals(at({ added: 1 }, 'de').body, 'Ein Buch zu deiner Bibliothek hinzugefügt')
  assertEquals(at({ added: 0, failed: 1 }, 'de').body, 'Nichts Neues in deiner Bibliothek · 1 fehlgeschlagen')
  assertEquals(at({ state: 'failed' } as Partial<PushJob>), { title: 'Import stopped', body: 'Your import stopped — tap to try again', url: '/import', tag: 'import-job', lang: 'en' })
  assertEquals(at({ state: 'failed' } as Partial<PushJob>, 'de').title, 'Import gestoppt')
  assertEquals(at({ added: 2 }, 'fr').lang, 'en', 'a language the notification has no words for is English')
})

Deno.test('the store: the claim, the subscriptions, last_ok_at and the delete are the database\'s own calls', async () => {
  const calls: string[] = []
  const answer = (data: unknown) => Promise.resolve({ data, error: null })
  const db: PushDb = {
    rpc: (name, args) => {
      calls.push(`rpc ${name} ${JSON.stringify(args)}`)
      return answer(name === 'import_job_claim_push' ? DONE : null)
    },
    from: () => ({
      select: (columns) => ({ eq: (column, value) => (calls.push(`select ${columns} where ${column}=${value}`), answer([subscription('phone')])) }),
      update: (values) => ({ eq: (column, value) => (calls.push(`update ${Object.keys(values)} where ${column}=${value}`), Promise.resolve({ error: null })) }),
      delete: () => ({ eq: (column, value) => (calls.push(`delete where ${column}=${value}`), Promise.resolve({ error: null })) }),
    }),
  }
  const store = createPushStore(db)
  assertEquals(await store.claim('j1'), DONE)
  await store.unclaim('j1')
  assertEquals((await store.subscriptions(ADA)).map((one) => one.id), ['phone'])
  await store.sent('phone')
  await store.gone('phone')
  assertEquals(calls, [
    'rpc import_job_claim_push {"p_job":"j1"}',
    'rpc import_job_unclaim_push {"p_job":"j1"}',
    'select id, endpoint, p256dh, auth, locale where member_id=member-ada',
    'update last_ok_at where id=phone',
    'delete where id=phone',
  ])
  const failing = createPushStore({ ...db, rpc: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) })
  let thrown = ''
  await failing.claim('j1').catch((error) => (thrown = error.message))
  assertEquals(thrown, 'import_job_claim_push: permission denied')
})

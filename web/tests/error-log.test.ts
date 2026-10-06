import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createErrorLog,
  createErrorSender,
  describeError,
  isChunkError,
  isNoise,
  keyValueErrorStorage,
  QUEUE_MAX,
  scrubRoute,
  scrubText,
  shortUserAgent,
  type ErrorContext,
  type ErrorReport,
  type ErrorSend,
} from '@/data/errorLog'
import { signUpMember } from './support/member'
import { runTag, sql, stack } from './support/stack'

/**
 * The client error log (data/errorLog.ts): what a report keeps of an error
 * (scrubbed, cut, noise left out), how the device's line folds, waits and sends,
 * and that a report sent through `log_client_error` lands in the database's own
 * log, for a member and for a signed-out device, against the local stack. The
 * database's own rules (limits, scrubbing again, who may read) are pgTAP's
 * (supabase/tests/client_errors_test.sql).
 */

const CONTEXT: ErrorContext = { appVersion: 'test-build', userAgent: 'iOS 18.2 Safari 18.2', standalone: true }

describe('what a report keeps', () => {
  it('drops e-mail addresses, tokens and the query and fragment of URLs, but keeps a frame’s line and column', () => {
    expect(scrubText('GET https://api.test/rest/v1/books?title=ilike.*Dune*#x failed for ada@example.com')).toBe(
      'GET https://api.test/rest/v1/books failed for [email]',
    )
    expect(scrubText('at load (https://app.test/_nuxt/x.js?v=1a2b:10:4)')).toBe('at load (https://app.test/_nuxt/x.js:10:4)')
    expect(scrubText('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here')).toBe('Bearer [token] here')
  })

  it('keeps a route’s path only', () => {
    expect(scrubRoute('/share?title=Dune&text=x#y')).toBe('/share')
    expect(scrubRoute('/library')).toBe('/library')
    expect(scrubRoute('https://app.test/library')).toBeNull()
    expect(scrubRoute('')).toBeNull()
  })

  it('reads any thrown value as a message and a stack', () => {
    const error = new TypeError('x is undefined')
    expect(describeError(error)).toEqual({ message: 'TypeError: x is undefined', stack: error.stack })
    expect(describeError({ message: 'permission denied', code: '42501' }).message).toBe('permission denied [42501]')
    expect(describeError('plain words').message).toBe('plain words')
    expect(describeError(undefined).message).toBe('Rejected with undefined')
    expect(describeError(42).message).toBe('Non-error value: [object Number]')
  })

  it('knows a missing chunk in every browser’s words', () => {
    expect(isChunkError('Failed to fetch dynamically imported module: https://app.test/_nuxt/a.js')).toBe(true)
    expect(isChunkError('TypeError: Importing a module script failed.')).toBe(true)
    expect(isChunkError('error loading dynamically imported module: https://app.test/_nuxt/a.js')).toBe(true)
    expect(isChunkError('Unable to preload CSS for /_nuxt/a.css')).toBe(true)
    // The shell answered in the chunk's place (Pages' fallback for an address with no file).
    expect(isChunkError("'text/html' is not a valid JavaScript MIME type for module script 'https://app.test/_nuxt/a.js'.")).toBe(true)
    expect(isChunkError('Loading module from “https://app.test/_nuxt/a.js” was blocked because of a disallowed MIME type (“text/html”).')).toBe(true)
    expect(isChunkError('Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".')).toBe(true)
    expect(isChunkError('TypeError: x is undefined')).toBe(false)
  })

  it('leaves out noise: the ResizeObserver loop, cancelled requests, no connection, extensions', () => {
    expect(isNoise('ResizeObserver loop completed with undelivered notifications.', null)).toBe(true)
    expect(isNoise('Script error.', null)).toBe(true)
    expect(isNoise('AbortError: The user aborted a request.', null)).toBe(true)
    expect(isNoise('cancelled', null)).toBe(true)
    expect(isNoise('TypeError: Failed to fetch', null)).toBe(true)
    expect(isNoise('TypeError: Load failed', null)).toBe(true)
    expect(isNoise('x is undefined', 'at f (chrome-extension://abc/content.js:1:1)')).toBe(true)
    expect(isNoise('x is undefined', null, 'safari-web-extension://abc/script.js')).toBe(true)
    expect(isNoise('TypeError: Failed to fetch dynamically imported module: https://app.test/_nuxt/a.js', null)).toBe(false)
    expect(isNoise('TypeError: x is undefined', 'at f (https://app.test/_nuxt/a.js:1:1)')).toBe(false)
  })

  it('names the browser in a few words', () => {
    expect(
      shortUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'),
    ).toBe('iOS 18.2 Safari 18.2')
    expect(shortUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')).toBe(
      'iOS 18.2 WebKit',
    )
    expect(
      shortUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'),
    ).toBe('Android 15 Chrome 140')
    expect(shortUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('macOS Firefox 133')
    expect(shortUserAgent('')).toBeNull()
  })
})

describe('the line on the device', () => {
  function memoryStorage() {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }
  }

  function setup({ send, online = true }: { send: ErrorSend | null; online?: boolean }) {
    const storage = keyValueErrorStorage(memoryStorage(), 'libellus.errorLog')
    let connected = online
    const scheduled: (() => void)[] = []
    const log = createErrorLog({
      send,
      storage,
      online: () => connected,
      context: () => CONTEXT,
      route: () => '/library?q=secret',
      schedule: (run) => scheduled.push(run),
    })
    return { log, storage, scheduled, connect: (value: boolean) => (connected = value) }
  }

  it('folds the same error into one report with a count, sends it once and forgets it', async () => {
    const sent: ErrorReport[] = []
    const { log, storage, scheduled } = setup({ send: async (report) => (sent.push(report), 'done') })
    const error = new Error('boom')
    expect(log.report('error', error)).toBe(true)
    expect(log.report('error', error)).toBe(true)
    expect(log.report('vue', error)).toBe(true)
    expect(log.pending().map((report) => [report.kind, report.count, report.route])).toEqual([
      ['error', 2, '/library'],
      ['vue', 1, '/library'],
    ])
    expect(storage.read()).toHaveLength(2)
    expect(scheduled).toHaveLength(1)

    scheduled[0]!()
    await log.flush()
    expect(sent.map((report) => [report.kind, report.count])).toEqual([
      ['error', 2],
      ['vue', 1],
    ])
    expect(log.pending()).toEqual([])
    expect(storage.read()).toBeNull()
  })

  it('leaves noise out', () => {
    const { log } = setup({ send: async () => 'done' })
    expect(log.report('error', new Error('ResizeObserver loop limit exceeded'))).toBe(false)
    expect(log.pending()).toEqual([])
  })

  it('waits while offline and on a send that does not get through, and outlives a reload', async () => {
    let answer: 'done' | 'retry' = 'retry'
    const sent: string[] = []
    const send: ErrorSend = async (report) => (sent.push(report.message), answer)
    const { log, storage, connect } = setup({ send, online: false })
    log.report('outbox', 'start_reading refused: not_reading')
    await log.flush()
    expect(sent).toEqual([])

    connect(true)
    await log.flush()
    expect(sent).toEqual(['start_reading refused: not_reading'])
    expect(log.pending()).toHaveLength(1)

    // The app starts again: the line is read back and sent.
    answer = 'done'
    const again = createErrorLog({ send, storage, online: () => true, context: () => CONTEXT, route: () => null, schedule: () => undefined })
    expect(again.pending()).toHaveLength(1)
    await again.flush()
    expect(sent).toHaveLength(2)
    expect(again.pending()).toEqual([])
  })

  it('never throws, whatever the sender or the storage does', async () => {
    const log = createErrorLog({
      send: async () => {
        throw new Error('the sender broke')
      },
      storage: {
        read: () => {
          throw new Error('unreadable')
        },
        write: () => {
          throw new Error('full')
        },
      },
      online: () => true,
      context: () => CONTEXT,
      route: () => null,
      schedule: () => undefined,
    })
    expect(log.report('error', new Error('boom'))).toBe(true)
    await expect(log.flush()).resolves.toBeUndefined()
    expect(log.pending()).toHaveLength(1)
  })

  it('holds a bounded number of different reports', () => {
    const { log } = setup({ send: async () => 'done' })
    for (let index = 0; index < QUEUE_MAX + 5; index++) log.report('error', new Error(`boom ${index}`))
    expect(log.pending()).toHaveLength(QUEUE_MAX)
  })

  it('in development without sending, only tells what it would have', () => {
    const heard: ErrorReport[] = []
    const log = createErrorLog({
      send: null,
      online: () => true,
      context: () => CONTEXT,
      route: () => '/',
      onReport: (report) => heard.push(report),
    })
    expect(log.report('shelf', 'library file invalid')).toBe(true)
    expect(heard.map((report) => report.message)).toEqual(['library file invalid'])
    expect(log.pending()).toEqual([])
  })
})

describe('sent to the local stack', () => {
  const tag = `T-ERRLOG ${runTag()}-${randomInt(1e9)}`

  afterAll(async () => {
    // A member's rows go with her (the run's teardown); a signed-out device's carry the tag.
    await sql('delete from private.client_errors where user_id is null and message like $1', [`${tag}%`])
  })

  it('lands in the log as the member’s, scrubbed, and the same again is counted', async () => {
    const member = await signUpMember()
    const send = createErrorSender(member.client)
    const report: ErrorReport = {
      kind: 'error',
      message: `${tag} member for ada@example.com`,
      stack: 'at f (https://app.test/_nuxt/a.js?v=1:2:3)',
      route: '/book/1?x=2',
      online: true,
      count: 2,
    }
    expect(await send(report, CONTEXT)).toBe('done')
    expect(await send(report, CONTEXT)).toBe('done')

    const rows = await sql<{ kind: string; message: string; stack: string; route: string; app_version: string; user_agent: string; standalone: boolean; count: number }>(
      `select kind, message, stack, route, app_version, user_agent, standalone, count
         from private.client_errors where user_id = $1`,
      [member.id],
    )
    expect(rows).toEqual([
      {
        kind: 'error',
        message: `${tag} member for [email]`,
        stack: 'at f (https://app.test/_nuxt/a.js:2:3)',
        route: '/book/1',
        app_version: 'test-build',
        user_agent: 'iOS 18.2 Safari 18.2',
        standalone: true,
        count: 4,
      },
    ])
    // And the member cannot read it back.
    const read = await member.client.schema('private' as 'public').from('client_errors').select('id')
    expect(read.error).not.toBeNull()
  })

  it('lands in the log from a signed-out device, as nobody’s', async () => {
    // A made-up address of its own, so the run never meets the per-address limit of another.
    const address = `198.18.${randomInt(256)}.${randomInt(256)}`
    const anon = createClient(stack.url, stack.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-forwarded-for': address } },
    })
    const message = `${tag} signed out`
    expect(await createErrorSender(anon)({ kind: 'chunk', message, stack: null, route: '/sign-in', online: true, count: 1 }, CONTEXT)).toBe(
      'done',
    )
    const rows = await sql<{ user_id: string | null; caller_key: string; route: string }>(
      'select user_id, caller_key, route from private.client_errors where message = $1',
      [message],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBeNull()
    expect(rows[0]!.caller_key).toMatch(/^anon:[0-9a-f]{32}$/)
    expect(rows[0]!.caller_key).not.toContain(address)
    expect(rows[0]!.route).toBe('/sign-in')
  })
})

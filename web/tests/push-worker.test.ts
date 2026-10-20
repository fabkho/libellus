import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * public/sw-push.js (the real file, run on a fake worker scope): a push shows the notification the server made, whatever
 * arrives; a tap opens the app at /import: an open window of the app is brought to the front and sent there, else a new
 * one opens; and nothing but one of the app's own paths is ever opened.
 */

const ORIGIN = 'https://libellus.example'
type Listener = (event: Record<string, unknown>) => void

type FakeWindow = { url: string; focus: () => Promise<void>; navigate?: (url: string) => Promise<void> }

function worker(windows: FakeWindow[] = []) {
  const listeners: Record<string, Listener> = {}
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const opened: string[] = []
  const scope = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => void (listeners[type] = listener),
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
      clients: { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
    },
    URL,
  } as Record<string, unknown>
  runInNewContext(readFileSync(new URL('../public/sw-push.js', import.meta.url), 'utf8'), scope)
  /** Delivers a push; `data` is what the browser decrypted: JSON text, nothing, or something unreadable. */
  async function push(data: string | null) {
    const waits: Promise<unknown>[] = []
    listeners.push!({ data: data === null ? null : { json: () => JSON.parse(data) }, waitUntil: (done: Promise<unknown>) => void waits.push(done) })
    await Promise.all(waits)
  }
  async function tap(url: string | undefined) {
    const waits: Promise<unknown>[] = []
    let closed = false
    listeners.notificationclick!({
      notification: { close: () => void (closed = true), data: url === undefined ? undefined : { url } },
      waitUntil: (done: Promise<unknown>) => void waits.push(done),
    })
    await Promise.all(waits)
    return closed
  }
  return { push, tap, shown, opened, listeners }
}

const message = { title: 'Import done', body: '12 books added to your Library · 4 kept', url: '/import', tag: 'import-job', lang: 'en' }

describe('a push', () => {
  it('shows the notification the server made, and keeps the app\u2019s own icon', async () => {
    const w = worker()
    await w.push(JSON.stringify(message))
    expect(w.shown).toHaveLength(1)
    expect(w.shown[0]!.title).toBe('Import done')
    expect(w.shown[0]!.options).toMatchObject({ body: '12 books added to your Library · 4 kept', tag: 'import-job', lang: 'en', icon: '/icon-192.png', data: { url: '/import' } })
  })

  it('shows one even for a push with no message or one it cannot read (a browser that shows nothing loses the subscription)', async () => {
    const w = worker()
    await w.push(null)
    await w.push('{not json')
    await w.push('"just a string"')
    expect(w.shown.map((one) => one.title)).toEqual(['BetterReads', 'BetterReads', 'BetterReads'])
    expect(w.shown.every((one) => (one.options.data as { url: string }).url === '/import')).toBe(true)
  })

  it('the German message keeps its language, and an address that is not the app\u2019s own becomes /import', async () => {
    const w = worker()
    await w.push(JSON.stringify({ ...message, title: 'Import fertig', lang: 'de', url: 'https://evil.example/phish' }))
    await w.push(JSON.stringify({ ...message, url: '//evil.example/x' }))
    expect(w.shown[0]!.options).toMatchObject({ lang: 'de', data: { url: '/import' } })
    expect(w.shown[1]!.options).toMatchObject({ data: { url: '/import' } })
  })
})

describe('a tap on the notification', () => {
  it('closes it and opens /import in a new window when the app is not open', async () => {
    const w = worker()
    expect(await w.tap('/import')).toBe(true)
    expect(w.opened).toEqual([`${ORIGIN}/import`])
  })

  it('brings an open window of the app to the front and sends it to /import', async () => {
    const calls: string[] = []
    const w = worker([
      { url: 'https://another.example/', focus: async () => void calls.push('other focus') },
      { url: `${ORIGIN}/library`, focus: async () => void calls.push('focus'), navigate: async (url) => void calls.push(`navigate ${url}`) },
    ])
    await w.tap('/import')
    expect(calls).toEqual(['focus', `navigate ${ORIGIN}/import`])
    expect(w.opened).toEqual([])
  })

  it('a window already on /import is only brought to the front; one that cannot navigate too', async () => {
    const calls: string[] = []
    const w = worker([{ url: `${ORIGIN}/import`, focus: async () => void calls.push('focus'), navigate: async () => void calls.push('navigate') }])
    await w.tap('/import')
    const bare = worker([{ url: `${ORIGIN}/library`, focus: async () => void calls.push('bare focus') }])
    await bare.tap('/import')
    expect(calls).toEqual(['focus', 'bare focus'])
    expect(w.opened.concat(bare.opened)).toEqual([])
  })

  it('a window that will not move gives way to a new one', async () => {
    const w = worker([{ url: `${ORIGIN}/library`, focus: async () => Promise.reject(new Error('gone')) }])
    await w.tap('/import')
    expect(w.opened).toEqual([`${ORIGIN}/import`])
  })

  it('a notification without an address, or with one that is not the app\u2019s, opens /import', async () => {
    const w = worker()
    await w.tap(undefined)
    await w.tap('https://evil.example/')
    expect(w.opened).toEqual([`${ORIGIN}/import`, `${ORIGIN}/import`])
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate,
  canInterrupt,
  checkForUpdate,
  dueForForegroundCheck,
  isOutdated,
  isTyping,
  latestBuildUrl,
  parseBuildId,
  whenInstalled,
  type RegistrationLike,
  type WorkerLike,
} from '../app/utils/appUpdate'

/**
 * A new release of the installed app (docs/parity.md "App update"): when the page counts a build as
 * outdated, when it may raise the sheet, what a look and "Update now" do with the service worker
 * registration, and the setup the whole thing rests on. Pure rules with a stand-in registration, no stack
 * (the data-layer suite's conventions, docs/TESTING.md).
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** A worker whose state can be driven; `statechange` listeners are kept. */
function worker(state: string): WorkerLike & { move(to: string): void } {
  const listeners = new Set<() => void>()
  const w = {
    state,
    addEventListener: (_: 'statechange', fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: 'statechange', fn: () => void) => void listeners.delete(fn),
    move(to: string) {
      w.state = to
      for (const fn of [...listeners]) fn()
    },
  }
  return w
}

/** A registration that, on `update()`, finds `next` (a worker that is installing, waiting, or nothing). */
function registration(opts: { next?: 'installing' | 'waiting' | null; fails?: boolean; waiting?: boolean } = {}) {
  const reg = {
    waiting: opts.waiting ? worker('installed') : (null as WorkerLike | null),
    installing: null as (WorkerLike & { move(to: string): void }) | null,
    updates: 0,
    async update() {
      reg.updates++
      if (opts.fails) throw new Error('offline')
      if (opts.next === 'waiting') reg.waiting = worker('installed')
      if (opts.next === 'installing') {
        const w = worker('installing')
        reg.installing = w
        // the worker finishes installing a moment later and then waits for her go
        setTimeout(() => {
          reg.waiting = w
          reg.installing = null
          w.move('installed')
        }, 50)
      }
    },
  }
  return reg
}

const deployed = (id: string | null) => async () => id

describe('the build id', () => {
  it('reads the id of Nuxt’s latest.json and nothing else', () => {
    expect(parseBuildId({ id: '6fd96ab7-802f', timestamp: 1 })).toBe('6fd96ab7-802f')
    expect(parseBuildId({ id: ' x ' })).toBe('x')
    for (const bad of [null, undefined, 'x', 3, {}, { id: '' }, { id: 7 }]) expect(parseBuildId(bad)).toBeNull()
  })

  it('counts any other deployed id as outdated, an unreadable answer or an unknown own id never', () => {
    expect(isOutdated('a', 'b')).toBe(true)
    expect(isOutdated('a', 'a')).toBe(false)
    expect(isOutdated('a', null)).toBe(false)
    expect(isOutdated('', 'b')).toBe(false)
  })

  it('finds latest.json under the build assets directory', () => {
    expect(latestBuildUrl('/', '/_nuxt/')).toBe('/_nuxt/builds/latest.json')
    expect(latestBuildUrl('/app/', '/_nuxt')).toBe('/app/_nuxt/builds/latest.json')
    expect(latestBuildUrl('', '')).toBe('/_nuxt/builds/latest.json')
  })
})

describe('when the app looks and when it may ask', () => {
  it('looks again on the foreground only after a minute', () => {
    expect(dueForForegroundCheck(1_000_000, null)).toBe(true)
    expect(dueForForegroundCheck(1_000_000, 1_000_000 - 30_000)).toBe(false)
    expect(dueForForegroundCheck(1_000_000, 1_000_000 - 60_000)).toBe(true)
  })

  it('counts a cursor in a text field, a textarea or an editable element as typing; a button or a switch is not', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as Element
    expect(isTyping(null)).toBe(false)
    expect(isTyping(el('TEXTAREA'))).toBe(true)
    expect(isTyping(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTyping(el('INPUT', { type: 'tel' }))).toBe(true)
    expect(isTyping(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTyping(el('BUTTON'))).toBe(false)
    expect(isTyping(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isTyping(el('BODY'))).toBe(false)
  })

  it('never takes the screen from typing or from another layer (a sheet, a confirm, the reader)', () => {
    expect(canInterrupt({ typing: false, modalOpen: false })).toBe(true)
    expect(canInterrupt({ typing: true, modalOpen: false })).toBe(false)
    expect(canInterrupt({ typing: false, modalOpen: true })).toBe(false)
  })
})

describe('whenInstalled', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns at once for a worker that is not installing', async () => {
    await expect(whenInstalled(worker('installed'))).resolves.toBeUndefined()
    await expect(whenInstalled(null)).resolves.toBeUndefined()
  })

  it('waits for the install to end, and gives up after the wait', async () => {
    const done = worker('installing')
    const spy = vi.fn()
    void whenInstalled(done, 1_000).then(spy)
    await vi.advanceTimersByTimeAsync(10)
    expect(spy).not.toHaveBeenCalled()
    done.move('installed')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalled()

    const stuck = worker('installing')
    const gaveUp = vi.fn()
    void whenInstalled(stuck, 1_000).then(gaveUp)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(gaveUp).toHaveBeenCalled()
  })
})

describe('checkForUpdate', () => {
  it('finds a worker that installs while it looks (and waits for it)', async () => {
    const reg = registration({ next: 'installing' })
    const found = await checkForUpdate({ registration: reg, fetchDeployedBuildId: deployed('same'), runningBuildId: 'same' })
    expect(found).toEqual({ waiting: true, outdated: false, failed: false })
    expect(reg.updates).toBe(1)
  })

  it('reports a worker that already waits', async () => {
    const found = await checkForUpdate({
      registration: registration({ waiting: true }),
      fetchDeployedBuildId: deployed('same'),
      runningBuildId: 'same',
    })
    expect(found.waiting).toBe(true)
  })

  it('has nothing to report when the worker and the build are current', async () => {
    const found = await checkForUpdate({ registration: registration(), fetchDeployedBuildId: deployed('same'), runningBuildId: 'same' })
    expect(found).toEqual({ waiting: false, outdated: false, failed: false })
  })

  it('catches a new build by its id alone, and asks the browser once more for the worker', async () => {
    const reg = registration()
    const found = await checkForUpdate({ registration: reg, fetchDeployedBuildId: deployed('new'), runningBuildId: 'old' })
    expect(found).toEqual({ waiting: false, outdated: true, failed: false })
    expect(reg.updates).toBe(2)
  })

  it('works without a registration (dev, no service worker): the id still says it', async () => {
    const found = await checkForUpdate({ registration: undefined, fetchDeployedBuildId: deployed('new'), runningBuildId: 'old' })
    expect(found).toEqual({ waiting: false, outdated: true, failed: false })
  })

  it('has learned nothing offline: failed, and neither signal set', async () => {
    const found = await checkForUpdate({
      registration: registration({ fails: true }),
      fetchDeployedBuildId: async () => {
        throw new Error('offline')
      },
      runningBuildId: 'old',
    })
    expect(found).toEqual({ waiting: false, outdated: false, failed: true })
  })

  it('is not failed when only one of the two answered', async () => {
    const found = await checkForUpdate({ registration: registration({ fails: true }), fetchDeployedBuildId: deployed('old'), runningBuildId: 'old' })
    expect(found.failed).toBe(false)
  })
})

describe('applyUpdate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const deps = (reg: RegistrationLike | undefined) => {
    const calls: string[] = []
    return {
      calls,
      registration: reg,
      activateWaiting: vi.fn(() => void calls.push('skipWaiting')),
      reload: vi.fn(() => void calls.push('reload')),
      check: vi.fn(async () => {
        calls.push('check')
        return { waiting: false, outdated: false, failed: false }
      }),
    }
  }

  it('lets the waiting worker take over, then reloads (after the fallback, if the worker does not reload first)', async () => {
    const d = deps(registration({ waiting: true }))
    const done = applyUpdate(d)
    await vi.advanceTimersByTimeAsync(10)
    expect(d.calls).toEqual(['skipWaiting'])
    await vi.advanceTimersByTimeAsync(4_000)
    await done
    expect(d.calls).toEqual(['skipWaiting', 'reload'])
    expect(d.check).not.toHaveBeenCalled()
  })

  it('looks once more when no worker waits, and activates the one it finds', async () => {
    const reg = registration()
    const d = deps(reg)
    d.check.mockImplementation(async () => {
      d.calls.push('check')
      reg.waiting = worker('installed')
      return { waiting: true, outdated: true, failed: false }
    })
    const done = applyUpdate(d)
    await vi.advanceTimersByTimeAsync(5_000)
    await done
    expect(d.calls).toEqual(['check', 'skipWaiting', 'reload'])
  })

  it('still reloads with no worker to activate (dev, or a deploy the browser has not picked up)', async () => {
    const d = deps(undefined)
    await applyUpdate(d)
    expect(d.calls).toEqual(['check', 'reload'])
    expect(d.activateWaiting).not.toHaveBeenCalled()
  })
})

describe('the service worker setup', () => {
  const config = read('../nuxt.config.ts')

  it('asks before an update takes over: prompt mode, no skipWaiting on install, and the first install claims the page', () => {
    expect(config).toMatch(/registerType:\s*'prompt'/)
    expect(config).toMatch(/clientsClaim:\s*true/)
    expect(config).not.toMatch(/skipWaiting:\s*true/)
  })

  it('leaves Nuxt’s own hourly outdated-build reload off: it would land on the old cached shell', () => {
    expect(config).toMatch(/checkOutdatedBuildInterval:\s*false/)
  })

  it('keeps background sync, the share target and Web Push in the generated worker', () => {
    expect(config).toMatch(/importScripts:\s*\['\/sw-sync\.js', '\/sw-share\.js', '\/sw-push\.js'\]/)
    expect(read('../public/sw-sync.js')).toContain("addEventListener('sync'")
    expect(read('../public/sw-push.js')).toContain("addEventListener('push'")
  })

  it('keeps the reader’s chunks out of the precache (#341: they are fetched, and guarded, when they are needed)', () => {
    expect(config).toMatch(/globIgnores:.*'\*\*\/ebook-reader\*\.js'/)
  })
})

describe('the Cloudflare Pages headers (public/_headers)', () => {
  /** `{ '/sw.js': { 'Cache-Control': 'no-cache' } }` */
  const rules: Record<string, Record<string, string>> = {}
  let current = ''
  for (const raw of read('../public/_headers').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) rules[(current = line.trim())] = {}
    else {
      const [name, ...value] = line.trim().split(':')
      rules[current]![name!.trim()] = value.join(':').trim()
    }
  }

  // The worker and the scripts it imports have fixed names, and `importScripts` goes through the HTTP
  // cache: without `no-cache` a change to one of them could take hours to be seen, and the app would
  // never learn that a release is waiting (docs/parity.md "App update"). Live on libellus.fabkho.dev,
  // read 2026-10-14: `curl -sI https://libellus.fabkho.dev/sw.js` answers `cache-control: no-cache`.
  it('revalidates the worker, what it imports and the manifest every time', () => {
    for (const path of ['/sw.js', '/sw-sync.js', '/sw-share.js', '/sw-push.js', '/manifest.webmanifest']) {
      expect(rules[path]?.['Cache-Control'], path).toBe('no-cache')
    }
  })

  it('leaves every /_nuxt/ answer, and with it the cache, to Nitro’s Cloudflare preset', () => {
    // The preset appends its own rules for the hashed chunks and for `builds/*`; Pages merges the values
    // of rules that match one URL, so a `Cache-Control` of ours on the catch-all would fight them.
    expect(Object.keys(rules).filter((path) => path.startsWith('/_nuxt'))).toEqual([])
    expect(rules['/*']?.['Cache-Control']).toBeUndefined()
  })
})

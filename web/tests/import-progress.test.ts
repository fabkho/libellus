import { describe, expect, it } from 'vitest'
import { IMPORT_FILE_DAYS, IMPORT_FILE_MAX_BYTES, memoryImportFiles } from '@/data/importFile'
import { createScreenWake, type VisibilitySource, type WakeLockApi } from '@/data/screenWake'
import { ambientFraction, importAmbient, type ImportAmbientInput } from '@/utils/importProgress'

/**
 * The import seen from the rest of the app (utils/importProgress.ts: what the pill above the tab bar says in each
 * state), the file kept so that a closed app resumes the import (data/importFile.ts) and the screen kept on while
 * the lookups run (data/screenWake.ts). Fakes only: nothing here needs a browser.
 */

const input = (over: Partial<ImportAmbientInput>): ImportAmbientInput => ({
  phase: 'pick',
  queued: null,
  progress: { done: 0, total: 0 },
  coverProgress: null,
  added: 0,
  ...over,
})

describe('what the app says about the import', () => {
  it('says nothing before a file is read, or while one is being read', () => {
    expect(importAmbient(input({ phase: 'pick' }))).toBeNull()
    expect(importAmbient(input({ phase: 'reading' }))).toBeNull()
  })

  it('the lookups: how many of how many', () => {
    expect(importAmbient(input({ phase: 'matching', progress: { done: 120, total: 340 } }))).toEqual({ kind: 'matching', done: 120, total: 340 })
  })

  it('waiting in line: how many are ahead (and no count of books); her own import elsewhere is its own state', () => {
    expect(importAmbient(input({ phase: 'matching', progress: { done: 0, total: 340 }, queued: { kind: 'waiting', ahead: 2 } }))).toEqual({ kind: 'queued', ahead: 2 })
    expect(importAmbient(input({ phase: 'matching', queued: { kind: 'elsewhere' } }))).toEqual({ kind: 'elsewhere' })
  })

  it('the write, then the cover fill that goes on after the lookups, then "ready" once the covers are in', () => {
    expect(importAmbient(input({ phase: 'importing', progress: { done: 30, total: 90 } }))).toEqual({ kind: 'importing', done: 30, total: 90 })
    expect(importAmbient(input({ phase: 'preview', coverProgress: { done: 4, total: 20 } }))).toEqual({ kind: 'covers', done: 4, total: 20 })
    expect(importAmbient(input({ phase: 'preview', coverProgress: { done: 20, total: 20 } }))).toEqual({ kind: 'ready' })
    expect(importAmbient(input({ phase: 'preview', coverProgress: null }))).toEqual({ kind: 'ready' })
    expect(importAmbient(input({ phase: 'preview', coverProgress: { done: 0, total: 0 } }))).toEqual({ kind: 'ready' })
  })

  it('done carries how many books were added', () => {
    expect(importAmbient(input({ phase: 'done', added: 12 }))).toEqual({ kind: 'done', added: 12 })
    expect(importAmbient(input({ phase: 'done', added: 0 }))).toEqual({ kind: 'done', added: 0 })
  })

  it('the thin bar: a fraction for what has a count, none for waiting, ready and done', () => {
    expect(ambientFraction({ kind: 'matching', done: 50, total: 200 })).toBe(0.25)
    expect(ambientFraction({ kind: 'importing', done: 5, total: 0 })).toBe(0)
    expect(ambientFraction({ kind: 'covers', done: 9, total: 3 })).toBe(1)
    for (const none of [{ kind: 'queued', ahead: 1 }, { kind: 'elsewhere' }, { kind: 'ready' }, { kind: 'done', added: 3 }] as const) expect(ambientFraction(none)).toBeNull()
  })
})

describe('the file kept for a closed app', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(65).buffer
  const DAY = 86_400_000

  it('keeps one file per member, and gives it back with its name', async () => {
    const keeper = memoryImportFiles()
    await keeper.write('ada', { name: 'goodreads.csv', bytes: bytes(10) }, 1_000)
    await keeper.write('bo', { name: 'other.csv', bytes: bytes(5) }, 1_000)
    expect((await keeper.read('ada', 2_000))?.name).toBe('goodreads.csv')
    expect((await keeper.read('ada', 2_000))?.bytes.byteLength).toBe(10)
    expect((await keeper.read('bo', 2_000))?.name).toBe('other.csv')
    expect(await keeper.read('cy', 2_000)).toBeNull()
  })

  it('forgets it when asked, and after a week', async () => {
    const keeper = memoryImportFiles()
    await keeper.write('ada', { name: 'a.csv', bytes: bytes(10) }, 0)
    expect(await keeper.read('ada', IMPORT_FILE_DAYS * DAY)).not.toBeNull()
    expect(await keeper.read('ada', IMPORT_FILE_DAYS * DAY + 1)).toBeNull()
    await keeper.write('ada', { name: 'a.csv', bytes: bytes(10) }, 0)
    await keeper.clear('ada')
    expect(await keeper.read('ada', 1)).toBeNull()
  })

  it('does not keep what is far larger than any export, nor an empty file', async () => {
    const keeper = memoryImportFiles()
    await keeper.write('ada', { name: 'huge.csv', bytes: bytes(IMPORT_FILE_MAX_BYTES + 1) }, 0)
    expect(await keeper.read('ada', 1)).toBeNull()
    await keeper.write('ada', { name: 'empty.csv', bytes: bytes(0) }, 0)
    expect(await keeper.read('ada', 1)).toBeNull()
  })

  it('a second file replaces the first', async () => {
    const keeper = memoryImportFiles()
    await keeper.write('ada', { name: 'one.csv', bytes: bytes(3) }, 0)
    await keeper.write('ada', { name: 'two.csv', bytes: bytes(4) }, 0)
    expect((await keeper.read('ada', 1))?.name).toBe('two.csv')
  })
})

describe('the screen kept on while the lookups run', () => {
  function page(state = 'visible') {
    const listeners = new Set<() => void>()
    const doc: VisibilitySource & { state: string } = {
      state,
      get visibilityState() {
        return this.state
      },
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    }
    return {
      doc,
      listeners: () => listeners.size,
      /** The page is hidden or shown again (the browser lets the lock go when it is hidden). */
      set(next: string) {
        doc.state = next
        for (const listener of [...listeners]) listener()
      },
    }
  }
  function lockApi(options: { refuse?: boolean } = {}) {
    const log = { requested: 0, released: 0 }
    const api: WakeLockApi = {
      async request() {
        log.requested++
        if (options.refuse) throw new DOMException('Not allowed', 'NotAllowedError')
        return { release: async () => void log.released++ }
      },
    }
    return { api, log }
  }
  const settle = async () => {
    for (let n = 0; n < 10; n++) await Promise.resolve()
  }

  it('asks for the lock when wanted, and lets it go when not', async () => {
    const { api, log } = lockApi()
    const wake = createScreenWake(api, page().doc)
    wake.want(true)
    await settle()
    expect(wake.held()).toBe(true)
    expect(log).toEqual({ requested: 1, released: 0 })
    wake.want(true)
    await settle()
    expect(log.requested).toBe(1)
    wake.want(false)
    await settle()
    expect(wake.held()).toBe(false)
    expect(log.released).toBe(1)
  })

  it('asks again when the page comes back from the background (the browser dropped the lock), but only while wanted', async () => {
    const { api, log } = lockApi()
    const { doc, set } = page()
    const wake = createScreenWake(api, doc)
    wake.want(true)
    await settle()
    set('hidden')
    set('visible')
    await settle()
    expect(log.requested).toBe(2)
    expect(wake.held()).toBe(true)
    wake.want(false)
    set('hidden')
    set('visible')
    await settle()
    expect(log.requested).toBe(2)
  })

  it('does not ask while the page is hidden; the lock comes when it is shown', async () => {
    const { api, log } = lockApi()
    const { doc, set } = page('hidden')
    const wake = createScreenWake(api, doc)
    wake.want(true)
    await settle()
    expect(log.requested).toBe(0)
    set('visible')
    await settle()
    expect(log.requested).toBe(1)
  })

  it('a refusal (battery saver) or a browser without the API changes nothing: the screen turns off as usual', async () => {
    const refused = lockApi({ refuse: true })
    const wake = createScreenWake(refused.api, page().doc)
    wake.want(true)
    await settle()
    expect(wake.held()).toBe(false)
    const none = createScreenWake(undefined, page().doc)
    none.want(true)
    await settle()
    expect(none.held()).toBe(false)
  })

  it('a lock granted after it was no longer wanted is let go at once; dispose lets go and stops listening', async () => {
    let grant: (value: { release: () => Promise<void> }) => void = () => {}
    let released = 0
    const api: WakeLockApi = { request: () => new Promise((resolve) => (grant = resolve)) }
    const { doc, listeners } = page()
    const wake = createScreenWake(api, doc)
    wake.want(true)
    wake.want(false)
    grant({ release: async () => void released++ })
    await settle()
    expect(released).toBe(1)
    expect(wake.held()).toBe(false)
    wake.dispose()
    expect(listeners()).toBe(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { EbookRecord } from '@/data/ebooks/ebooks'
import { createReaderPrefetch, firstEbookLinked, hasOpenableEbook, mayPrefetch } from '@/data/reader/prefetch'

/**
 * When the ebook reader is fetched ahead (data/reader/prefetch.ts, docs/perf/bundle.md F6): only for a member
 * who has an ebook that opens on this device, never offline or with Save-Data, once, and again after a failure.
 */
const record = (id: string, state: EbookRecord['state']) => ({ id, state }) as EbookRecord
const online = { online: true, saveData: false }

describe('mayPrefetch', () => {
  it('needs a connection and a member who did not ask to save data', () => {
    expect(mayPrefetch(online)).toBe(true)
    expect(mayPrefetch({ online: false, saveData: false })).toBe(false)
    expect(mayPrefetch({ online: true, saveData: true })).toBe(false)
  })
})

describe('hasOpenableEbook', () => {
  it('is true for a linked ebook whose copy is on the device', () => {
    expect(hasOpenableEbook({ records: [record('a', 'linked')], missing: [] })).toBe(true)
    expect(hasOpenableEbook({ records: [record('a', 'linked')], missing: new Set<string>() })).toBe(true)
  })

  it('is false without a snapshot, without records, and for files that wait for a Book or are ignored', () => {
    expect(hasOpenableEbook(null)).toBe(false)
    expect(hasOpenableEbook({ records: [], missing: [] })).toBe(false)
    expect(hasOpenableEbook({ records: [record('a', 'unlinked'), record('b', 'ignored')], missing: [] })).toBe(false)
  })

  it('is false when the only linked copy is gone from the device', () => {
    expect(hasOpenableEbook({ records: [record('a', 'linked')], missing: ['a'] })).toBe(false)
    expect(hasOpenableEbook({ records: [record('a', 'linked'), record('b', 'linked')], missing: new Set(['a']) })).toBe(true)
  })
})

describe('firstEbookLinked', () => {
  it('fires when the first ebook appears after the records were read', () => {
    expect(firstEbookLinked(false, true, true)).toBe(true)
  })

  it('does not fire for the records the first read finds (the idle plugin does that), a second ebook, or a removal', () => {
    expect(firstEbookLinked(false, true, false)).toBe(false)
    expect(firstEbookLinked(true, true, true)).toBe(false)
    expect(firstEbookLinked(true, false, true)).toBe(false)
    expect(firstEbookLinked(false, false, true)).toBe(false)
  })
})

describe('createReaderPrefetch', () => {
  it('loads once, however often it is asked', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const ahead = createReaderPrefetch(load, () => online)
    ahead.prefetch()
    ahead.prefetch()
    await Promise.resolve()
    ahead.prefetch()
    expect(load).toHaveBeenCalledTimes(1)
    expect(ahead.started).toBe(true)
  })

  it('loads nothing offline or with Save-Data, and starts once the device allows it', () => {
    const load = vi.fn().mockResolvedValue(undefined)
    let connection = { online: false, saveData: false }
    const ahead = createReaderPrefetch(load, () => connection)
    ahead.prefetch()
    connection = { online: true, saveData: true }
    ahead.prefetch()
    expect(load).not.toHaveBeenCalled()
    expect(ahead.started).toBe(false)
    connection = online
    ahead.prefetch()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed attempt, never throws, and tries again on the next ask', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const ahead = createReaderPrefetch(load, () => online)
    ahead.prefetch()
    await new Promise((resolve) => setTimeout(resolve))
    expect(ahead.started).toBe(false)
    ahead.prefetch()
    expect(load).toHaveBeenCalledTimes(2)
    await new Promise((resolve) => setTimeout(resolve))
    expect(ahead.started).toBe(true)
  })
})

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

/** A scheduler the test drives: `later` queues, `tick` runs what is due in order. */
function clock() {
  const queue: { run: () => void; ms: number }[] = []
  return { later: (run: () => void, ms: number) => void queue.push({ run, ms }), queue, tick: () => queue.shift()?.run() }
}
const settle = () => new Promise((resolve) => setTimeout(resolve))

describe('createReaderPrefetch', () => {
  it('loads once, however often it is asked', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const ahead = createReaderPrefetch(load, () => online)
    ahead.prefetch()
    ahead.prefetch()
    await settle()
    ahead.prefetch()
    await ahead.ensure()
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

  it('never keeps a rejected load: the next call loads again', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('dropped')).mockResolvedValue(undefined)
    const ahead = createReaderPrefetch(load, () => online, { later: () => {} })
    await expect(ahead.ensure()).rejects.toThrow('dropped')
    expect(ahead.started).toBe(false)
    await expect(ahead.ensure()).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    await ahead.ensure()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('tries a failed prefetch again later, later each time, and gives up after a few', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const time = clock()
    const ahead = createReaderPrefetch(load, () => online, { delays: [10, 20, 30], later: time.later })
    ahead.prefetch()
    for (const ms of [10, 20, 30]) {
      await settle()
      expect(time.queue.map((entry) => entry.ms)).toEqual([ms])
      time.tick()
    }
    await settle()
    expect(load).toHaveBeenCalledTimes(4)
    expect(time.queue).toEqual([])
  })

  it('stops retrying once it works, and does not retry offline or with Save-Data', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('dropped')).mockResolvedValue(undefined)
    const time = clock()
    let connection = online
    const ahead = createReaderPrefetch(load, () => connection, { delays: [10, 20], later: time.later })
    ahead.prefetch()
    await settle()
    connection = { online: false, saveData: false }
    time.tick()
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    connection = online
    ahead.prefetch()
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(time.queue).toEqual([])
  })

  it('Read now loads what was never fetched or failed earlier, with any connection, and joins a load on its way', async () => {
    let finish!: () => void
    const load = vi.fn().mockRejectedValueOnce(new Error('dropped')).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const ahead = createReaderPrefetch(load, () => ({ online: true, saveData: true }), { later: () => {} })
    ahead.prefetch() // Save-Data: nothing
    expect(load).not.toHaveBeenCalled()
    await expect(ahead.ensure()).rejects.toThrow('dropped')
    const first = ahead.ensure()
    const second = ahead.ensure()
    expect(load).toHaveBeenCalledTimes(2)
    finish()
    await Promise.all([first, second])
    await ahead.ensure()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { isbnFromBarcode, startScanLoop, type DetectedCode } from '@/utils/barcode'

describe('a barcode read as an ISBN', () => {
  it('takes an EAN-13 starting 978 or 979 as the ISBN-13 it is', () => {
    expect(isbnFromBarcode('9780141036144')).toBe('9780141036144')
    expect(isbnFromBarcode('9791032305690')).toBe('9791032305690')
  })

  it('refuses an EAN-13 whose check digit does not add up (a misread)', () => {
    expect(isbnFromBarcode('9780141036145')).toBeNull()
    expect(isbnFromBarcode('9791032305691')).toBeNull()
  })

  it('refuses an EAN-13 that is not Bookland: groceries, a magazine ISSN', () => {
    expect(isbnFromBarcode('4006381333931')).toBeNull()
    expect(isbnFromBarcode('9771234567003')).toBeNull()
    expect(isbnFromBarcode('5901234123457')).toBeNull()
  })

  it('converts an ISBN-10 to its ISBN-13, the X check digit too', () => {
    expect(isbnFromBarcode('0141036141')).toBe('9780141036144')
    expect(isbnFromBarcode('080442957X')).toBe('9780804429573')
    expect(isbnFromBarcode('080442957x')).toBe('9780804429573')
    expect(isbnFromBarcode('0-14-103614-1')).toBe('9780141036144')
  })

  it('refuses an ISBN-10 with a wrong check digit, and anything else', () => {
    expect(isbnFromBarcode('0141036140')).toBeNull()
    expect(isbnFromBarcode('')).toBeNull()
    expect(isbnFromBarcode('hello')).toBeNull()
    expect(isbnFromBarcode('978014103614')).toBeNull()
    expect(isbnFromBarcode('97801410361440')).toBeNull()
    // A UPC-A (12 digits) or an EAN-8 is no book.
    expect(isbnFromBarcode('036000291452')).toBeNull()
    expect(isbnFromBarcode('96385074')).toBeNull()
  })
})

/** Timers the test steps by hand, in place of the clock. */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  let id = 0
  return {
    timers: {
      set: (callback: () => void) => {
        pending.set(++id, callback)
        return id
      },
      clear: (handle: unknown) => void pending.delete(handle as number),
    },
    pending: () => pending.size,
    /** Fires the one waiting look and lets its detection settle. */
    async tick() {
      const [first] = [...pending]
      if (!first) throw new Error('no look waiting')
      pending.delete(first[0])
      first[1]()
      await vi.waitFor(() => undefined)
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('the scan loop', () => {
  const frame = { readyState: 4 }
  const code = (rawValue: string): DetectedCode => ({ rawValue, format: 'ean_13' })

  it('looks once per interval and stops at the first ISBN, which it hands over', async () => {
    const clock = fakeTimers()
    const answers: DetectedCode[][] = [[], [code('4006381333931')], [code('4006381333931'), code('9780141036144')]]
    const detect = vi.fn(async () => answers.shift() ?? [])
    const onIsbn = vi.fn()
    const onOther = vi.fn()
    startScanLoop({ reader: { read: detect }, source: frame, onIsbn, onOther, timers: clock.timers })

    // Nothing is detected before the first interval has passed.
    expect(detect).not.toHaveBeenCalled()
    await clock.tick()
    expect(detect).toHaveBeenCalledTimes(1)
    expect(onIsbn).not.toHaveBeenCalled()

    // Another code (a grocery's): reported, the loop goes on.
    await clock.tick()
    expect(onOther).toHaveBeenCalledExactlyOnceWith('4006381333931')
    expect(onIsbn).not.toHaveBeenCalled()

    // A book among them: handed over once, and no look is left waiting.
    await clock.tick()
    expect(onIsbn).toHaveBeenCalledExactlyOnceWith('9780141036144')
    expect(clock.pending()).toBe(0)
  })

  it('turns an ISBN-10 it sees into the ISBN-13', async () => {
    const clock = fakeTimers()
    const onIsbn = vi.fn()
    startScanLoop({ reader: { read: async () => [{ rawValue: '0141036141', format: 'code_128' }] }, source: frame, onIsbn, timers: clock.timers })
    await clock.tick()
    expect(onIsbn).toHaveBeenCalledExactlyOnceWith('9780141036144')
  })

  it('skips a frame the detector cannot read, and a video with no frame yet', async () => {
    const clock = fakeTimers()
    const source = { readyState: 0 }
    const detect = vi
      .fn<() => Promise<DetectedCode[]>>()
      .mockRejectedValueOnce(new Error('InvalidStateError'))
      .mockResolvedValue([code('9780141036144')])
    const onIsbn = vi.fn()
    startScanLoop({ reader: { read: detect }, source, onIsbn, timers: clock.timers })

    await clock.tick()
    expect(detect).not.toHaveBeenCalled()
    source.readyState = 4
    await clock.tick()
    expect(onIsbn).not.toHaveBeenCalled()
    expect(clock.pending()).toBe(1)
    await clock.tick()
    expect(onIsbn).toHaveBeenCalledExactlyOnceWith('9780141036144')
  })

  it('stops on request: no further look, and nothing reported for one in flight', async () => {
    const clock = fakeTimers()
    let release: (codes: DetectedCode[]) => void = () => undefined
    const detect = vi.fn(() => new Promise<DetectedCode[]>((resolve) => (release = resolve)))
    const onIsbn = vi.fn()
    const loop = startScanLoop({ reader: { read: detect }, source: frame, onIsbn, timers: clock.timers })
    await clock.tick()
    expect(detect).toHaveBeenCalledTimes(1)
    loop.stop()
    release([code('9780141036144')])
    await Promise.resolve()
    await Promise.resolve()
    expect(onIsbn).not.toHaveBeenCalled()
    expect(clock.pending()).toBe(0)

    // Stopped before the first look: the waiting look is cancelled.
    const again = startScanLoop({ reader: { read: detect }, source: frame, onIsbn, timers: clock.timers })
    expect(clock.pending()).toBe(1)
    again.stop()
    expect(clock.pending()).toBe(0)
  })

  it('does not start a read while the last one is still running', async () => {
    const clock = fakeTimers()
    const detect = vi.fn(() => new Promise<DetectedCode[]>(() => undefined))
    startScanLoop({ reader: { read: detect }, source: frame, onIsbn: vi.fn(), timers: clock.timers })
    await clock.tick()
    expect(clock.pending()).toBe(0)
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('looks at the pace its reader asks for', async () => {
    const waited: number[] = []
    const timers = { set: (_: () => void, ms: number) => (waited.push(ms), 1), clear: () => undefined }
    startScanLoop({ reader: { read: async () => [], intervalMs: 330 }, source: frame, onIsbn: vi.fn(), timers })
    startScanLoop({ reader: { read: async () => [] }, source: frame, onIsbn: vi.fn(), timers })
    startScanLoop({ reader: { read: async () => [], intervalMs: 330 }, source: frame, onIsbn: vi.fn(), intervalMs: 100, timers })
    expect(waited).toEqual([330, 250, 100])
  })
})

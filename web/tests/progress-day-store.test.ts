import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, type Library, type LibraryEntry } from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage } from '@/data/outbox'
import type { WriteQueue } from '@/data/queuedWrites'
import { addDays } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { bookDays, dayBook, daysOf, stateOf, utcToday } from './support/progressDays'

/**
 * The reading store's earlier-day sheet and the days store's overlay (stores/reading.ts, stores/progressDays.ts) over
 * the real repository and the real outbox against the local stack: the other stores (library, sync, session) are
 * the smallest stand-ins that hold the entry and the outbox the repository writes into. The day to be saved is
 * UTC-based here (the stores send the member's own day); the database accepts either within a day.
 */

const today = utcToday()
const ago = (n: number) => addDays(today, -n)
const page = (n: number) => ({ page: n })

type Phone = { member: TestMember; offline: { value: boolean }; library: Library; outbox: ReturnType<typeof createOutbox>; copy: Map<string, LibraryEntry>; calls: string[]; changed: LibraryEntry[] }
let phone: Phone

const session = reactive({ member: { id: 'ada' } as { id: string } | null })
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('~/stores/library', () => ({
  useLibraryStore: () => ({ library: () => phone.library, entryChanged: (entry: LibraryEntry) => { phone.copy.set(entry.id, entry); phone.changed.push(entry) } }),
}))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => reactive({ get items() { return phone.outbox.items() } }) }))

let pinia: ReturnType<typeof createPinia> | null = null
async function stores() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  pinia = createPinia()
  setActivePinia(pinia)
  const { useReadingStore } = await import('~/stores/reading')
  const { useProgressDaysStore } = await import('~/stores/progressDays')
  return { reading: useReadingStore(), days: useProgressDaysStore() }
}
afterEach(() => {
  ;(pinia as unknown as { _e: { stop(): void } } | null)?._e.stop()
  vi.unstubAllGlobals()
})

/** A phone for a member with a read of 300 pages begun 20 days ago, days booked on it: 6 ago 0>40, 4 ago 40>90, 1 ago 90>140. */
async function readerPhone(rows: [number, number | null, number][] = [[6, null, 40], [4, 40, 90], [1, 90, 140]], current: number | null = 140) {
  const member = await signUpMember()
  const copy = new Map<string, LibraryEntry>()
  const offline = { value: false }
  const calls: string[] = []
  const outbox = createOutbox({ memberId: member.id, storage: memoryOutboxStorage(), send: createSender(member.client) })
  const queue: WriteQueue = {
    open: () => true,
    holds: () => offline.value || outbox.items().length > 0,
    entry: (id) => copy.get(id) ?? null,
    entryForBook: () => null,
    collection: () => null,
    add: (write) => outbox.add(write),
  }
  const real = createLibrary(member.client, { online: () => !offline.value, queue })
  // The repository the stores call, with a record of the day writes that were asked for.
  const library: Library = new Proxy(real, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (key !== 'setProgressDay' && key !== 'deleteProgressDay' && key !== 'updateProgress') return value
      return (...args: unknown[]) => {
        calls.push(String(key))
        return (value as (...a: unknown[]) => unknown)(...args)
      }
    },
  })
  phone = { member, offline, library, outbox, copy, calls, changed: [] }
  const added = await real.addToLibrary(dayBook('Piranesi', 300), { status: 'reading', startedOn: ago(20) })
  const first = added.data as LibraryEntry
  await bookDays(first.latestSession!.id, rows, current)
  const entry = (await real.entry(first.id)).data as LibraryEntry
  copy.set(entry.id, entry)
  return { entry, sessionId: entry.latestSession!.id }
}

/** The read's days in the store, once they have come back from the database. */
async function loaded(days: { bySession: Record<string, unknown> }, sessionId: string) {
  for (let i = 0; i < 100 && !days.bySession[sessionId]; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  expect(days.bySession[sessionId]).toBeDefined()
}
const ends = (days: { day: string; end: unknown }[] | undefined) => days?.map((d) => [d.day, d.end])

describe('the sheet on an earlier day', () => {
  it('opens on a day between its neighbours, the wheel on where the day before ended', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)

    reading.openProgress(entry, { day: ago(3) })
    expect(reading.progressDay).toBe(ago(3))
    expect(reading.progressBounds).toMatchObject({ lo: 90, hi: 140, start: 90, end: null, leads: true })
    expect(reading.progressValue).toBe(90)
    expect(reading.progressFloor).toBe(90)
    expect(reading.progressLimit).toBe(140)

    // A day that has a row opens on where it ended.
    reading.chooseProgressDay(ago(4))
    expect(reading.progressBounds).toMatchObject({ lo: 40, hi: 140, end: 90 })
    expect(reading.progressValue).toBe(90)
    // Back to Today: the read's value and no bounds.
    reading.chooseProgressDay(null)
    expect(reading.progressDay).toBeNull()
    expect(reading.progressBounds).toBeNull()
    expect(reading.progressFloor).toBe(0)
    expect(reading.progressLimit).toBe(300)
    expect(reading.progressValue).toBe(140)
  })

  it('has no bounds while the read\'s days are not loaded, and seeds the wheel when they arrive', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    reading.openProgress(entry, { day: ago(3) })
    expect(reading.progressDay).toBe(ago(3))
    expect(reading.progressBounds).toBeNull()
    expect(reading.progressFloor).toBe(0)
    await loaded(days, sessionId)
    await nextTick()
    expect(reading.progressBounds).toMatchObject({ lo: 90, hi: 140 })
    expect(reading.progressValue).toBe(90)
  })

  it('keeps the wheel inside the day\'s range when the unit changes', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    reading.openProgress(entry, { day: ago(3) })
    reading.progressValue = 139
    reading.chooseProgressMode('percent')
    // 139 of 300 is 46 %; the day's range in percent is 30 to 47.
    expect(reading.progressBounds).toMatchObject({ lo: 30, hi: 47 })
    expect(reading.progressValue).toBe(46)
    reading.chooseProgressMode('page')
    expect(reading.progressValue).toBeGreaterThanOrEqual(reading.progressFloor)
    expect(reading.progressValue).toBeLessThanOrEqual(reading.progressLimit)
  })

  it('saves a day through set_progress_day: the entry changes, the days are read again, Home\'s Undo is forgotten', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    // A Today save leaves Undo on Home's card.
    reading.openProgress(entry)
    reading.progressValue = 150
    expect(await reading.confirmProgress()).not.toBeNull()
    expect(reading.progressUndo).not.toBeNull()
    const afterToday = phone.copy.get(entry.id)!

    reading.openProgress(afterToday, { day: ago(3) })
    reading.progressValue = 110
    const saved = await reading.confirmProgress()
    expect(saved).not.toBeNull()
    expect(phone.calls).toContain('setProgressDay')
    expect(reading.progressing).toBeNull()
    expect(reading.progressUndo).toBeNull()
    // Always: Profile's record and the figures read again even though a day in the middle moves no value.
    expect(phone.changed.at(-1)).toMatchObject({ id: entry.id })
    expect(phone.changed.at(-1)!.latestSession).toMatchObject({ progressPage: 150 })
    await vi.waitFor(() => expect(ends(days.bySession[sessionId])).toContainEqual([ago(3), page(110)]))
    expect(await daysOf(phone.library, sessionId)).toEqual(days.bySession[sessionId])
  })

  it('sends nothing when the wheel stands where the day already is (a row, or no row at its start)', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    reading.openProgress(entry, { day: ago(4) })
    expect(await reading.confirmProgress()).toMatchObject({ id: entry.id })
    expect(reading.progressing).toBeNull()
    reading.openProgress(entry, { day: ago(3) })
    expect(await reading.confirmProgress()).toMatchObject({ id: entry.id })
    expect(phone.calls).toEqual([])
  })

  it('stays open on a refusal with the code, and tries again with the same button', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    // 25 days ago is before the read began.
    reading.openProgress(entry, { day: ago(25) })
    reading.progressValue = 10
    expect(await reading.confirmProgress()).toBeNull()
    expect(reading.progressError).toBe('date_invalid')
    expect(reading.progressing).not.toBeNull()
    expect(reading.progressBusy).toBe(false)
    reading.chooseProgressDay(ago(3))
    expect(reading.progressError).toBeNull()
  })

  it('removes a day in the middle (the next one absorbs it) and the latest (her progress goes back)', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)

    reading.openProgress(entry, { day: ago(4) })
    const middle = await reading.removeProgressDay()
    expect(middle).toMatchObject({ id: entry.id })
    expect(reading.progressing).toBeNull()
    expect(phone.changed.at(-1)!.latestSession).toMatchObject({ progressPage: 140 })
    await vi.waitFor(() => expect(days.bySession[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(1)]))
    expect(days.bySession[sessionId]![1]).toEqual({ day: ago(1), start: page(40), end: page(140) })

    reading.openProgress(phone.copy.get(entry.id)!, { day: ago(1) })
    const latest = await reading.removeProgressDay()
    expect(latest!.latestSession).toMatchObject({ progressPage: 40 })
    expect(await stateOf(sessionId)).toMatchObject({ current: page(40) })
    expect(reading.progressUndo).toBeNull()
  })

  it('does not finish or give up from an earlier day', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    reading.openProgress(entry, { day: ago(3) })
    expect(await reading.finishFromProgress()).toBeNull()
    expect(await reading.abandonFromProgress()).toBeNull()
    expect(reading.finishing).toBeNull()
    expect(reading.abandoning).toBeNull()
  })
})

describe('the overlay while a write waits', () => {
  it('shows the day at once offline, holds it while the outbox has it, and drops it when the days come back', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)

    phone.offline.value = true
    reading.openProgress(entry, { day: ago(3) })
    reading.progressValue = 110
    expect(await reading.confirmProgress()).not.toBeNull()
    expect(phone.outbox.items()).toHaveLength(1)
    // The sheet is closed; the entry is shown; the log has the day, the database does not.
    expect(reading.progressing).toBeNull()
    expect(ends(days.shown[sessionId])).toContainEqual([ago(3), page(110)])
    // The day after starts where it ends (R4), as the database will leave it.
    expect(days.shown[sessionId]!.find((d) => d.day === ago(1))!.start).toEqual(page(110))
    expect(days.bySession[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(4), ago(1)])

    // A second write waits behind it: laid over the first.
    reading.openProgress(phone.copy.get(entry.id)!, { day: ago(2) })
    reading.progressValue = 120
    await reading.confirmProgress()
    expect(ends(days.shown[sessionId])).toEqual([[ago(6), page(40)], [ago(4), page(90)], [ago(3), page(110)], [ago(2), page(120)], [ago(1), page(140)]])
    // And a Remove of the first on top of them.
    reading.openProgress(phone.copy.get(entry.id)!, { day: ago(3) })
    await reading.removeProgressDay()
    expect(days.shown[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(4), ago(2), ago(1)])
    expect(phone.outbox.items().map((item) => item.action)).toEqual(['set_progress_day', 'set_progress_day', 'delete_progress_day'])

    // The days come back while the writes still wait (offline: it fails; online but behind a write: no days of its own): held.
    days.refresh(sessionId)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(days.pending[sessionId]).toBeDefined()
    expect(days.shown[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(4), ago(2), ago(1)])

    // Back online: the outbox sends them, the screens ask again (stores/sync.ts, settle): the overlay is gone, the database's days stand.
    phone.offline.value = false
    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    days.refreshAll()
    await vi.waitFor(() => expect(days.pending[sessionId]).toBeUndefined())
    expect(days.shown[sessionId]).toEqual(days.bySession[sessionId])
    expect(days.shown[sessionId]).toEqual(await daysOf(phone.library, sessionId))
    expect(days.shown[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(4), ago(2), ago(1)])
  })

  it('has nothing to show over days that were never loaded', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    phone.offline.value = true
    reading.openProgress(entry, { day: ago(3) })
    reading.progressValue = 110
    expect(await reading.confirmProgress()).not.toBeNull()
    expect(days.shown[sessionId]).toBeUndefined()
  })

  it('holds nothing for a write that went straight to the database', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    reading.openProgress(entry, { day: ago(3) })
    reading.progressValue = 110
    await reading.confirmProgress()
    expect(days.pending).toEqual({})
  })

  it('drops a write the database refused when the days come back', async () => {
    const { entry, sessionId } = await readerPhone()
    const { reading, days } = await stores()
    days.want(sessionId)
    await loaded(days, sessionId)
    phone.offline.value = true
    reading.openProgress(entry, { day: ago(3) })
    reading.progressValue = 110
    await reading.confirmProgress()
    // On another device the read ends before the write is sent.
    await createLibrary(phone.member.client).finish(entry.id, { endedOn: today })
    phone.offline.value = false
    const report = await phone.outbox.flush()
    expect(report.refused.map((failure) => failure.code)).toEqual(['not_reading'])
    days.refreshAll()
    await vi.waitFor(() => expect(days.pending[sessionId]).toBeUndefined())
    expect(days.shown[sessionId]!.map((d) => d.day)).toEqual([ago(6), ago(4), ago(1)])
  })
})

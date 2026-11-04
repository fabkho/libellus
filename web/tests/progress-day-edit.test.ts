import { describe, expect, it } from 'vitest'
import { createLibrary, type LibraryEntry } from '@/data/library'
import type { ProgressValue } from '@/data/progress'
import { dayBoundsOf, dayEdit, type ProgressDay } from '@/data/progressDays'
import { addDays } from '@/utils/dates'
import { signUpMember } from './support/member'
import { sql } from './support/stack'
import { bookDays, dayBook, daysOf, stateOf, utcToday } from './support/progressDays'

/**
 * Progress on an earlier day (docs/plans/backdated-progress.md) through the repository, against the local stack as a
 * real signed-in member: `setProgressDay` and `deleteProgressDay` call the database's own functions, and the pure rules
 * in `data/progressDays.ts` (what the sheet draws and the offline overlay shows) are run against them on random
 * sequences of edits: after every edit the days and the read's value must be the same either way.
 *
 * `PROGRESS_DAY_SEED=<n>` replays one run; `PROGRESS_DAY_SEQUENCES=<n>` sets how many (200 and more by default).
 */

const today = utcToday()

async function memberWithReads() {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const startedOn = addDays(today, -30)
  const counted = (await library.addToLibrary(dayBook('Counted', 300), { status: 'reading', startedOn })).data as LibraryEntry
  const uncounted = (await library.addToLibrary(dayBook('Uncounted', null), { status: 'reading', startedOn })).data as LibraryEntry
  return { member, library, counted, uncounted, startedOn }
}

const page = (n: number) => ({ page: n })
const percent = (n: number) => ({ percent: n })

describe('setProgressDay and deleteProgressDay, through the repository', () => {
  it('adds a day, moves its end, removes it, and the entry comes back each time', async () => {
    const { library, counted } = await memberWithReads()
    const session = counted.latestSession!.id
    await bookDays(session, [[1, null, 100], [0, 100, 150]], 150)

    const added = await library.setProgressDay(counted.id, addDays(today, -4), page(40))
    expect(added.error).toBeNull()
    // A day in the past leaves the read's value where it is (R5).
    expect(added.data!.latestSession).toMatchObject({ progressPage: 150 })
    expect(await daysOf(library, session)).toEqual([
      { day: addDays(today, -4), start: null, end: page(40) },
      { day: addDays(today, -1), start: page(40), end: page(100) },
      { day: today, start: page(100), end: page(150) },
    ])

    await library.setProgressDay(counted.id, addDays(today, -4), page(60))
    expect((await daysOf(library, session))[1]).toEqual({ day: addDays(today, -1), start: page(60), end: page(100) })

    const removed = await library.deleteProgressDay(counted.id, addDays(today, -4))
    expect(removed.error).toBeNull()
    expect(await daysOf(library, session)).toEqual([
      { day: addDays(today, -1), start: null, end: page(100) },
      { day: today, start: page(100), end: page(150) },
    ])
  })

  it('takes the read\'s value back when the latest day goes, and forward when it moves', async () => {
    const { library, counted } = await memberWithReads()
    const session = counted.latestSession!.id
    await bookDays(session, [[1, null, 100], [0, 100, 150]], 150)

    const moved = await library.setProgressDay(counted.id, today, page(170))
    expect(moved.data!.latestSession).toMatchObject({ progressPage: 170 })
    const removed = await library.deleteProgressDay(counted.id, today)
    expect(removed.data!.latestSession).toMatchObject({ progressPage: 100 })
    expect(await stateOf(session)).toMatchObject({ current: page(100) })
  })

  it('refuses what the database refuses, with the codes the screens word, and changes nothing', async () => {
    const { library, counted, uncounted, startedOn } = await memberWithReads()
    const session = counted.latestSession!.id
    expect((await library.setProgressDay(counted.id, addDays(startedOn, -1), page(10))).error).toBe('date_invalid')
    expect((await library.setProgressDay(counted.id, addDays(today, 5), page(10))).error).toBe('date_invalid')
    expect((await library.setProgressDay(counted.id, 'soon', page(10))).error).toBe('date_invalid')
    expect((await library.setProgressDay(counted.id, addDays(today, -2), page(301))).error).toBe('progress_invalid')
    expect((await library.setProgressDay(counted.id, addDays(today, -2), percent(101))).error).toBe('progress_invalid')
    // A page on a read with no page count cannot be placed between its days.
    expect((await library.setProgressDay(uncounted.id, addDays(today, -2), page(10))).error).toBe('progress_invalid')
    expect((await library.setProgressDay('00000000-0000-4000-8000-000000000000', addDays(today, -2), page(10))).error).toBe('entry_not_found')
    expect((await library.deleteProgressDay('00000000-0000-4000-8000-000000000000', addDays(today, -2))).error).toBe('entry_not_found')
    expect(await daysOf(library, session)).toEqual([])
  })

  it('refuses a finished read (open reads only, R10) and an entry that is not being read', async () => {
    const { library, counted } = await memberWithReads()
    await bookDays(counted.latestSession!.id, [[1, null, 100]], 100)
    await library.finish(counted.id, { endedOn: today })
    expect((await library.setProgressDay(counted.id, addDays(today, -2), page(10))).error).toBe('not_reading')
    expect((await library.deleteProgressDay(counted.id, addDays(today, -1))).error).toBe('not_reading')
  })

  it('answers only for the member\'s own entries', async () => {
    const hers = await memberWithReads()
    const his = await memberWithReads()
    expect((await his.library.setProgressDay(hers.counted.id, addDays(today, -2), page(10))).error).toBe('entry_not_found')
    expect((await his.library.deleteProgressDay(hers.counted.id, addDays(today, -2))).error).toBe('entry_not_found')
  })

  it('removing a day without a row succeeds and changes nothing', async () => {
    const { library, counted } = await memberWithReads()
    const removed = await library.deleteProgressDay(counted.id, addDays(today, -3))
    expect(removed.error).toBeNull()
    expect(removed.data!.id).toBe(counted.id)
  })
})

// ---------------------------------------------------------- the random comparison

/** A small seeded generator (mulberry32), so a failure can be replayed from its seed. */
function generator(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (from: number, to: number) => from + Math.floor(next() * (to - from + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  }
}
type Random = ReturnType<typeof generator>

/** The positions a read's days run through: strictly more than before, mostly (a day that went back is rare). */
function positionsOf(random: Random, count: number, whole: number): number[] {
  const out: number[] = []
  let at = random.chance(0.3) ? random.int(0, Math.floor(whole / 5)) : 0
  const base = at
  for (let i = 0; i < count; i++) {
    at = random.chance(0.08) ? Math.max(0, at - random.int(1, 10)) : Math.min(whole, at + random.int(1, Math.max(1, Math.floor(whole / (count + 1)))))
    out.push(at)
  }
  return [base, ...out]
}

type Scenario = { session: string; description: string }

/**
 * One read's starting state, written as the database owner does (the members cannot write days): a chain of rows,
 * pages or percent, a value that follows them, lags them (an import, a clamp, a late first value) or is none.
 */
async function seed(random: Random, session: string, entryId: string, counted: boolean, startedOn: string): Promise<string> {
  const whole = counted ? 300 : 100
  await sql('delete from public.reading_progress_days where session_id = $1', [session])
  await sql('update public.library_entries set page_count_override = null where id = $1', [entryId])
  await sql('update public.reading_sessions set progress_page = null, progress_percent = null, progress_updated_at = null, started_on = $2 where id = $1', [session, startedOn])
  const rows = random.chance(0.12) ? 0 : random.int(1, 6)
  const span = 30
  const days = [...new Set(Array.from({ length: rows }, () => random.int(1, span - 1)))].sort((a, b) => b - a)
  const positions = positionsOf(random, days.length, whole)
  const stored = (n: number, kind: 'page' | 'percent') => (kind === 'page' ? { page: n } : { percent: Math.min(100, Math.round((n / whole) * 100)) })
  const describe: string[] = []
  let last: { page?: number; percent?: number } | null = null
  for (let i = 0; i < days.length; i++) {
    const kind: 'page' | 'percent' = counted && random.chance(0.6) ? 'page' : 'percent'
    const end = counted ? stored(positions[i + 1]!, kind) : { percent: positions[i + 1]! }
    const start = i === 0 ? (positions[0]! > 0 || random.chance(0.2) ? (counted ? stored(positions[0]!, random.chance(0.5) ? 'page' : 'percent') : { percent: positions[0]! }) : null) : last
    await sql(
      `insert into public.reading_progress_days (session_id, day, start_page, start_percent, end_page, end_percent)
       values ($1, $2, $3, $4, $5, $6)`,
      [session, addDays(today, -days[i]!), (start as { page?: number } | null)?.page ?? null, (start as { percent?: number } | null)?.percent ?? null, (end as { page?: number }).page ?? null, (end as { percent?: number }).percent ?? null],
    )
    describe.push(`${addDays(today, -days[i]!)} ${JSON.stringify(start)}>${JSON.stringify(end)}`)
    last = end
  }
  // The value: where the last day ended (the days lead it), somewhere else, or none.
  const lead = random.next()
  let current: { page?: number; percent?: number } | null = null
  if (lead < 0.6 && last) current = last
  else if (lead < 0.75 || (lead < 0.9 && !last)) current = counted && random.chance(0.5) ? { page: random.int(0, whole) } : { percent: random.int(0, 100) }
  else if (lead < 0.85 && last) current = counted ? { page: random.int(0, whole) } : { percent: random.int(0, 100) }
  if (current) {
    await sql('update public.reading_sessions set progress_page = $2, progress_percent = $3, progress_updated_at = now() where id = $1', [session, current.page ?? null, current.percent ?? null])
  }
  return `${describe.join(' | ')} || P ${JSON.stringify(current)}`
}

type Op = { kind: 'set'; day: string; value: ProgressValue } | { kind: 'remove'; day: string } | { kind: 'total'; pageCount: number | null }

function opFor(random: Random, counted: boolean, days: readonly ProgressDay[], current: ProgressValue | null, pageCount: number | null, startedOn: string): Op {
  if (counted && random.chance(0.06)) return { kind: 'total', pageCount: random.int(1, 400) }
  const existing = days.map((d) => d.day)
  const day = existing.length && random.chance(0.5) ? random.pick(existing) : addDays(today, -random.int(0, 31))
  if (random.chance(0.3) && existing.length) return { kind: 'remove', day: random.chance(0.8) ? random.pick(existing) : day }
  // A value that is likely to meet a bound: a neighbour's end, the read's value, the start, or anything.
  const kind: 'page' | 'percent' = counted && random.chance(0.6) ? 'page' : 'percent'
  const unit = kind
  const bounds = pageCount !== null || unit === 'percent' ? dayBoundsOf(days, day, current, pageCount, unit) : null
  const whole = unit === 'page' ? (pageCount ?? 300) : 100
  const n = bounds && random.chance(0.6) ? random.pick([bounds.lo, bounds.hi, bounds.start, bounds.end ?? bounds.lo, bounds.lo + 1, bounds.hi - 1, Math.floor((bounds.lo + bounds.hi) / 2)]) : random.int(0, whole + (random.chance(0.05) ? 5 : 0))
  const clamped = Math.max(0, n)
  return { kind: 'set', day: day < startedOn && random.chance(0.5) ? addDays(startedOn, random.int(0, 3)) : day, value: kind === 'page' ? page(clamped) : percent(clamped) }
}

const SEQUENCES = Number(process.env.PROGRESS_DAY_SEQUENCES ?? 240)
const SEED = Number(process.env.PROGRESS_DAY_SEED ?? Math.floor(Math.random() * 2 ** 31))

describe('the pure rules against the database\'s own functions', () => {
  it(`agree on ${SEQUENCES} random sequences of edits (seed ${SEED})`, { timeout: 900_000 }, async () => {
    const { library, counted, uncounted, startedOn } = await memberWithReads()
    let edits = 0
    const kinds = { set: 0, remove: 0, total: 0, changed: 0, refused: 0, valueMoved: 0 }
    for (let n = 0; n < SEQUENCES; n++) {
      const seedOf = SEED + n
      const random = generator(seedOf)
      const useCounted = random.chance(0.65)
      const entry = useCounted ? counted : uncounted
      const session = entry.latestSession!.id
      const readStart = random.chance(0.15) ? addDays(today, -random.int(5, 20)) : startedOn
      const starting = await seed(random, session, entry.id, useCounted, readStart)
      const trace: string[] = [`start: ${starting} (read began ${readStart})`]
      const fail = (message: string, extra: unknown): never => {
        throw new Error(`${message}\nseed ${seedOf} (PROGRESS_DAY_SEED=${seedOf} PROGRESS_DAY_SEQUENCES=1)\n${trace.join('\n')}\n${JSON.stringify(extra, null, 1)}`)
      }
      for (let step = 0, steps = random.int(3, 8); step < steps; step++) {
        const days = await daysOf(library, session)
        const state = await stateOf(session)
        const op = opFor(random, useCounted, days, state.current, state.pageCount, readStart)
        trace.push(`op: ${JSON.stringify(op)}`)
        let expected = { days, current: state.current }
        let result: { error: string | null }
        if (op.kind === 'total') {
          result = await library.updateProgress(entry.id, null, { pageCount: op.pageCount })
          kinds.total++
          // A total changes no day (clamp_session_progress cuts the value to it): the rows stay, the value may not.
          expected = { days, current: state.current && 'page' in state.current && op.pageCount !== null ? page(Math.min(state.current.page, op.pageCount)) : state.current }
        } else {
          const edit = dayEdit(days, op.day, op.kind === 'set' ? op.value : null, { current: state.current, pageCount: state.pageCount, startedOn: readStart })
          expected = { days: edit.days, current: edit.current }
          result = op.kind === 'set' ? await library.setProgressDay(entry.id, op.day, op.value) : await library.deleteProgressDay(entry.id, op.day)
          kinds[op.kind]++
          if (result.error) {
            // A refusal changes nothing, and the pure rules refuse the same writes (they leave the days as they are).
            kinds.refused++
            expect(['date_invalid', 'progress_invalid']).toContain(result.error)
            expected = { days, current: state.current }
          } else if (JSON.stringify(edit.days) !== JSON.stringify(days) || edit.currentChanged) kinds.changed++
          if (edit.currentChanged) kinds.valueMoved++
        }
        const after = { days: await daysOf(library, session), ...(await stateOf(session)) }
        edits++
        if (JSON.stringify(after.days) !== JSON.stringify(expected.days)) fail('the days differ', { op, before: days, current: state.current, pageCount: state.pageCount, error: result.error, database: after.days, pure: expected.days })
        if (JSON.stringify(after.current) !== JSON.stringify(expected.current)) fail('the read\'s value differs', { op, before: days, current: state.current, pageCount: state.pageCount, error: result.error, database: after.current, pure: expected.current })
      }
    }
    // The run did what it says: edits of every kind, many that changed something, some the database refused.
    expect(edits).toBeGreaterThanOrEqual(SEQUENCES * 3)
    expect(kinds.set).toBeGreaterThan(SEQUENCES / 2)
    expect(kinds.remove).toBeGreaterThan(SEQUENCES / 8)
    expect(kinds.changed).toBeGreaterThan(SEQUENCES / 2)
    expect(kinds.valueMoved).toBeGreaterThan(0)
    console.log(`progress-day-edit: ${SEQUENCES} sequences, ${edits} edits, seed ${SEED}`, kinds)
  })
})

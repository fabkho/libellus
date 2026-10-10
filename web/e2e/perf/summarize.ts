/**
 * Sums up the runs flight-soak.spec.ts wrote to FLIGHT_OUT: per measure, each run's median over its
 * first and its last ten rounds, then the median of those over the runs and their spread (min–max).
 * A flight that gets worse with use shows as a last ten above the first ten in every run.
 *
 *   pnpm tsx e2e/perf/summarize.ts /tmp/flight-soak
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type Flight = { start: number; fly: number; hero?: number; dropped: number; worst: number; loafs: number; loafMs: number; loafMax: number }
type Round = { round: number; push: Flight; pop: Flight; animations: number; elements: number; nodes: number; listeners: number; heapMb: number; leftovers: number; requests?: number; failed?: number; kb?: number; inFlightAtPush?: number; inFlightAtPop?: number; loafRoundMs?: number }

const dir = process.argv[2] ?? '/tmp/flight-soak'
const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
const runs = files.map((name) => (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { rounds: Round[] }).rounds)
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
/** Per window of ten rounds: the median, or for what is mostly 0 (dropped frames, long frames) the sum. */
const measures: [string, (r: Round) => number, 'median' | 'sum'?][] = [
  ['push start ms', (r) => r.push.start],
  ['push hero drawn ms', (r) => r.push.hero ?? -1],
  ['push fly ms', (r) => r.push.fly],
  ['push dropped (sum)', (r) => r.push.dropped, 'sum'],
  ['push worst gap ms', (r) => r.push.worst],
  ['push LoAF ms (sum)', (r) => r.push.loafMs, 'sum'],
  ['pop start ms', (r) => r.pop.start],
  ['pop fly ms', (r) => r.pop.fly],
  ['pop dropped (sum)', (r) => r.pop.dropped, 'sum'],
  ['pop worst gap ms', (r) => r.pop.worst],
  ['pop LoAF ms (sum)', (r) => r.pop.loafMs, 'sum'],
  ['animations', (r) => r.animations],
  ['elements', (r) => r.elements],
  ['DOM nodes (all)', (r) => r.nodes],
  ['listeners', (r) => r.listeners],
  ['JS heap MB', (r) => r.heapMb],
  ['left behind', (r) => r.leftovers],
  ['stack requests', (r) => r.requests ?? -1],
  ['stack requests failed (sum)', (r) => r.failed ?? -1, 'sum'],
  ['stack kB', (r) => r.kb ?? -1],
  ['in flight at push tap', (r) => r.inFlightAtPush ?? -1],
  ['in flight at pop tap', (r) => r.inFlightAtPop ?? -1],
  ['LoAF ms in round (sum)', (r) => r.loafRoundMs ?? -1, 'sum'],
]
const round = (value: number) => Math.round(value * 10) / 10
const cell = (values: number[]) => values.some(Number.isNaN) ? 'n/a' : `${round(median(values))} [${round(Math.min(...values))}–${round(Math.max(...values))}]`
console.log(`${runs.length} runs of ${runs.map((rounds) => rounds.length).join('/')} rounds (${dir})`)
console.log('| measure | rounds 2–11 | last 10 rounds |')
console.log('|---|---|---|')
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
for (const [name, of, how = 'median'] of measures) {
  const take = (rounds: Round[]) => (how === 'sum' ? sum : median)(rounds.map(of).filter((v) => v >= 0))
  // Rounds 2–11 for the first ten: round 1 loads the Book page's code and data for the first time.
  const first = runs.map((rounds) => take(rounds.slice(1, 11)))
  const last = runs.map((rounds) => take(rounds.slice(-10)))
  console.log(`| ${name} | ${cell(first)} | ${cell(last)} |`)
}

// Per run, over all its rounds: what a median of ten hides (a pile that rises and drains in between).
console.log('\n| run | most stack requests in flight at a tap | requests failed | rounds that asked the stack nothing | frames dropped in all flights | LoAF ms |')
console.log('|---|---|---|---|---|---|')
runs.forEach((rounds, i) => {
  const total = (of: (r: Round) => number) => sum(rounds.map(of).filter((v) => v >= 0))
  const peak = Math.max(...rounds.map((r) => Math.max(r.inFlightAtPush ?? -1, r.inFlightAtPop ?? -1)))
  const idle = rounds.filter((r) => r.requests === 0).length
  console.log(`| ${files[i]} | ${peak} | ${total((r) => r.failed ?? -1)} | ${idle} | ${total((r) => r.push.dropped + r.pop.dropped)} | ${total((r) => r.loafRoundMs ?? -1)} |`)
})

/**
 * Perf harness: prints the saved results of `pnpm perf` as tables, one per profile.
 *
 *   pnpm perf:report [.data/perf/<label>]        the latest run when no directory is given
 *
 * Each cell is the median over the runs; `~` marks a cell whose spread ((max − min) / median) is
 * above 15 %, a series to repeat at a lower load. A final block lists what is not a number: the
 * largest layout shifts, the slowest interactions and the Long Animation Frame culprits.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { median, round, spread } from './measure'
import type { StepResult } from './run'

type Saved = { meta: Record<string, unknown> & { profile: string; describe: string; runs: number; loadAtStart: number[]; browser: string; commit: string }; results: { run: number; steps: StepResult[] }[] }

const fmt = (xs: (number | null | undefined)[], digits = 0, unit = '') => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (!v.length) return '—'
  const m = median(v)
  const noisy = v.length > 2 && spread(v) > 0.15 && m > 0
  return `${noisy ? '~' : ''}${digits ? round(m, digits) : Math.round(m)}${unit}`
}

export function printReport(dir: string) {
  if (!existsSync(dir)) throw new Error(`no results in ${dir}`)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const saved = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Saved
    const m = saved.meta
    console.log(`### ${m.profile} — ${m.describe}`)
    console.log(`${m.browser}, ${m.runs} runs, commit ${m.commit}, load average at start ${m.loadAtStart.join(' ')}. Median per cell, ~ = spread above 15 %.\n`)
    const ids = [...new Set(saved.results.flatMap((r) => r.steps.map((s) => s.id)))].sort()
    const rows: string[][] = [['step', 'ready ms', 'LCP ms', 'CLS', 'INP ms', 'TBT ms', 'LoAF n', 'LoAF ms', 'worst frame', 'frames>50', 'req', 'KB', 'heap MB']]
    for (const id of ids) {
      const steps = saved.results.map((r) => r.steps.find((s) => s.id === id)).filter((s): s is StepResult => Boolean(s))
      const ok = steps.filter((s) => s.ok)
      const pick = <T>(f: (s: StepResult) => T) => ok.map(f)
      rows.push([
        `${id}${ok.length < steps.length ? ` (${ok.length}/${steps.length} ok)` : ''}`,
        fmt(pick((s) => s.readyMs)),
        fmt(pick((s) => s.stats.lcp?.ms ?? null)),
        fmt(pick((s) => s.stats.cls.value), 3),
        fmt(pick((s) => s.stats.inp?.ms ?? null)),
        fmt(pick((s) => s.stats.tbt)),
        fmt(pick((s) => s.stats.loaf.n)),
        fmt(pick((s) => s.stats.loaf.totalMs)),
        fmt(pick((s) => s.stats.frames?.worstMs ?? null)),
        fmt(pick((s) => s.stats.frames?.over50 ?? null)),
        fmt(pick((s) => s.net.requests)),
        fmt(pick((s) => s.net.transferKb)),
        fmt(pick((s) => s.cdp?.heapMB ?? null), 1),
      ])
    }
    const width = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)))
    for (const [i, r] of rows.entries()) {
      console.log(`| ${r.map((c, j) => (j === 0 ? c.padEnd(width[j]!) : c.padStart(width[j]!))).join(' | ')} |`)
      if (i === 0) console.log(`| ${width.map((w, j) => (j === 0 ? '-'.repeat(w) : '-'.repeat(w - 1) + ':')).join(' | ')} |`)
    }
    // The worst of each kind, from the median-ish run (the run whose LoAF total is the median).
    console.log('')
    for (const id of ids) {
      const steps = saved.results.map((r) => r.steps.find((s) => s.id === id)).filter((s): s is StepResult => Boolean(s) && s!.ok)
      if (!steps.length) continue
      const mid = [...steps].sort((a, b) => a.stats.loaf.totalMs - b.stats.loaf.totalMs)[Math.floor(steps.length / 2)]!
      const notes: string[] = []
      if (mid.stats.cls.value > 0.02 && mid.stats.cls.worst) notes.push(`CLS ${mid.stats.cls.value}: ${mid.stats.cls.worst.sources.map((s) => `${s.node} ${s.from.join(',')}→${s.to.join(',')}`).join('; ')}`)
      if (mid.stats.inp && mid.stats.inp.ms >= 100) notes.push(`INP ${mid.stats.inp.ms} ms on ${mid.stats.inp.target} (${mid.stats.inp.type}): delay ${mid.stats.inp.delay}, processing ${mid.stats.inp.processing}, presentation ${mid.stats.inp.presentation}`)
      if (mid.stats.loaf.top.length && mid.stats.loaf.totalMs >= 100) notes.push(`LoAF: ${mid.stats.loaf.top.join(' | ')}`)
      if (mid.stats.lcp && id.startsWith('a-')) notes.push(`LCP element ${mid.stats.lcp.element} ${mid.stats.lcp.url}`)
      if (notes.length) console.log(`- ${id}: ${notes.join(' — ')}`)
    }
    console.log('')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../../.data/perf', import.meta.url).pathname
  const dir = process.argv[2] ?? join(root, readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory() && readdirSync(join(root, d)).some((f) => f.endsWith('.json'))).sort().at(-1) ?? '')
  printReport(dir)
}

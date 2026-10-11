/**
 * Perf harness: cutting a step's numbers out of what the collectors saw (perf/browser.ts COLLECT,
 * the network log, CDP's Performance.getMetrics). Pure functions on plain data, so a saved
 * result can be re-summarised without a browser (perf/report.ts).
 */
import type { NetEntry } from './browser'

export type Snapshot = {
  now: number
  lcp: { startTime: number; size: number; element: string | null; url: string }[]
  cls: { startTime: number; value: number; hadRecentInput: boolean; sources: { node: string | null; from: number[]; to: number[] }[] }[]
  events: { type: string; startTime: number; duration: number; inputDelay: number; processing: number; presentation: number; interactionId: number; target: string | null }[]
  longtasks: { startTime: number; duration: number }[]
  loaf: { startTime: number; duration: number; blocking: number; renderStart: number; styleAndLayoutStart: number; scripts: { src: string; fn: string; invoker: string; type: string; d: number; forced: number; pos: number }[] }[]
  paints: { name: string; startTime: number }[]
  frames: number[]
  seen: Record<string, number>
}

export type Metrics = Record<string, number>

export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
/** Spread as (max − min) / median, the harness's noise measure: above 15 % a series is repeated at a lower load. */
export const spread = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x))
  const m = median(s)
  return !s.length || !m ? NaN : (Math.max(...s) - Math.min(...s)) / m
}

/** Cumulative layout shift of a window: the worst session window (shifts less than 1 s apart, at most 5 s long), as web-vitals counts it. */
export function cls(shifts: Snapshot['cls'], from: number, to: number) {
  const list = shifts.filter((s) => !s.hadRecentInput && s.startTime >= from && s.startTime <= to).sort((a, b) => a.startTime - b.startTime)
  let best = 0
  let cur = 0
  let first = 0
  let prev = 0
  for (const s of list) {
    if (!cur || s.startTime - prev > 1000 || s.startTime - first > 5000) {
      cur = 0
      first = s.startTime
    }
    cur += s.value
    prev = s.startTime
    best = Math.max(best, cur)
  }
  const worst = [...list].sort((a, b) => b.value - a.value)[0]
  return { value: round(best, 4), sum: round(list.reduce((a, s) => a + s.value, 0), 4), n: list.length, worst: worst ? { value: round(worst.value, 4), at: Math.round(worst.startTime), sources: worst.sources } : null }
}

export const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits

/** Everything a step reports, from the entries that fall into [from, to] (page time, ms). */
export function windowStats(snap: Snapshot, from: number, to: number, opts: { tbtFrom?: number } = {}) {
  const inside = <T extends { startTime: number }>(xs: T[]) => xs.filter((x) => x.startTime >= from && x.startTime <= to)
  const tasks = inside(snap.longtasks)
  const tbtFrom = opts.tbtFrom ?? from
  const loaf = inside(snap.loaf).filter((l) => l.duration >= 50)
  // Interactions: one per interactionId (the slowest of its events), as INP counts them.
  const byId = new Map<number, Snapshot['events'][number]>()
  for (const e of inside(snap.events))
    if (e.interactionId) {
      const had = byId.get(e.interactionId)
      if (!had || e.duration > had.duration) byId.set(e.interactionId, e)
    }
  const interactions = [...byId.values()].sort((a, b) => b.duration - a.duration)
  const frames = snap.frames
  const sortedFrames = [...frames].sort((a, b) => a - b)
  const scriptTotals = new Map<string, number>()
  for (const l of loaf) for (const s of l.scripts) scriptTotals.set(`${s.src || '(none)'} ${s.fn || s.invoker}`, (scriptTotals.get(`${s.src || '(none)'} ${s.fn || s.invoker}`) ?? 0) + s.d)
  const lcpEntries = inside(snap.lcp)
  const lcp = lcpEntries.at(-1)
  return {
    fcp: snap.paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null,
    lcp: lcp ? { ms: Math.round(lcp.startTime), element: lcp.element, size: lcp.size, url: lcp.url?.split('/').slice(-2).join('/') ?? '' } : null,
    cls: cls(snap.cls, from, to),
    inp: interactions[0]
      ? { ms: Math.round(interactions[0].duration), delay: Math.round(interactions[0].inputDelay), processing: Math.round(interactions[0].processing), presentation: Math.round(interactions[0].presentation), type: interactions[0].type, target: interactions[0].target, n: interactions.length }
      : null,
    tbt: Math.round(tasks.filter((t) => t.startTime >= tbtFrom).reduce((a, t) => a + Math.max(0, t.duration - 50), 0)),
    longTasks: { n: tasks.length, totalMs: Math.round(tasks.reduce((a, t) => a + t.duration, 0)), maxMs: Math.round(Math.max(0, ...tasks.map((t) => t.duration))) },
    loaf: {
      n: loaf.length,
      totalMs: Math.round(loaf.reduce((a, l) => a + l.duration, 0)),
      maxMs: Math.round(Math.max(0, ...loaf.map((l) => l.duration))),
      blockingMs: Math.round(loaf.reduce((a, l) => a + l.blocking, 0)),
      styleLayoutMs: Math.round(loaf.reduce((a, l) => a + Math.max(0, l.startTime + l.duration - l.styleAndLayoutStart), 0)),
      top: [...scriptTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}ms`),
      worst: [...loaf].sort((a, b) => b.duration - a.duration).slice(0, 2).map((l) => ({ at: Math.round(l.startTime), ms: Math.round(l.duration), scripts: l.scripts.filter((s) => s.d > 4).slice(0, 4) })),
    },
    frames: frames.length
      ? { n: frames.length, over50: frames.filter((g) => g > 50).length, over100: frames.filter((g) => g > 100).length, worstMs: Math.round(sortedFrames.at(-1) ?? 0), p95: Math.round(sortedFrames[Math.floor(sortedFrames.length * 0.95)] ?? 0) }
      : null,
  }
}

export function netStats(entries: NetEntry[], from: number, to: number) {
  const list = entries.filter((e) => e.at >= from && e.at <= to)
  const sum = (xs: NetEntry[], k: 'transfer' | 'decoded') => xs.reduce((a, e) => a + e[k], 0)
  const group = (key: (e: NetEntry) => string) => {
    const out: Record<string, { n: number; kb: number }> = {}
    for (const e of list) {
      const k = key(e)
      out[k] ??= { n: 0, kb: 0 }
      out[k]!.n++
      out[k]!.kb += e.transfer / 1024
    }
    for (const v of Object.values(out)) v.kb = round(v.kb, 1)
    return out
  }
  const seen = new Map<string, number>()
  for (const e of list) seen.set(e.url, (seen.get(e.url) ?? 0) + 1)
  return {
    requests: list.length,
    transferKb: round(sum(list, 'transfer') / 1024, 1),
    decodedKb: round(sum(list, 'decoded') / 1024, 1),
    cached: list.filter((e) => e.fromCache).length,
    fromSW: list.filter((e) => e.fromSW).length,
    byType: group((e) => e.type),
    byHost: group((e) => e.host),
    duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([u, n]) => `${n}x ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110)}`),
  }
}

/** CDP Performance.getMetrics, as the milliseconds and counts a step moved. */
export function metricsDelta(a: Metrics, b: Metrics) {
  const ms = (k: string) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000)
  return {
    scriptMs: ms('ScriptDuration'),
    layoutMs: ms('LayoutDuration'),
    styleMs: ms('RecalcStyleDuration'),
    taskMs: ms('TaskDuration'),
    layouts: Math.round((b.LayoutCount ?? 0) - (a.LayoutCount ?? 0)),
    styles: Math.round((b.RecalcStyleCount ?? 0) - (a.RecalcStyleCount ?? 0)),
    heapMB: round((b.JSHeapUsedSize ?? 0) / 1048576, 1),
    heapDeltaMB: round(((b.JSHeapUsedSize ?? 0) - (a.JSHeapUsedSize ?? 0)) / 1048576, 1),
    nodes: Math.round(b.Nodes ?? 0),
  }
}

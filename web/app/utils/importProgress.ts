import type { ImportJob } from '../data/importJob'

/**
 * What the app says about the import job (the progress pill on every screen, components/shell/ImportStatus.vue, and the import
 * page): one thing at a time, from the job's own state. Pure, so Vitest pins every state in plain Node.
 *
 * queued — waiting in line behind `ahead` imports · paused — the server stopped for a while (a source was down) and goes on by
 * itself · matching / covers / writing — the server's three phases over the file's books (`done` of `total`) · done — "Import
 * done · N books added" with the books that were there already and the ones that failed · failed — the job gave up (retry).
 * Nothing for a cancelled job, or before a job exists.
 */

export type ImportAmbient =
  | { kind: 'queued'; ahead: number }
  | { kind: 'paused' }
  | { kind: 'matching'; done: number; total: number }
  | { kind: 'covers'; done: number; total: number }
  | { kind: 'writing'; done: number; total: number }
  | { kind: 'done'; added: number; kept: number; failed: number }
  | { kind: 'failed' }

/** The phases a running job goes through, in order: the first that is not through every row is the one it is in. */
export function importAmbient(job: ImportJob | null, ahead = 0): ImportAmbient | null {
  if (!job) return null
  switch (job.state) {
    case 'queued':
      return { kind: 'queued', ahead }
    case 'paused':
      return { kind: 'paused' }
    case 'running': {
      const total = job.total
      if (job.matched < total) return { kind: 'matching', done: job.matched, total }
      if (job.covered < total) return { kind: 'covers', done: job.covered, total }
      return { kind: 'writing', done: Math.min(job.written, total), total }
    }
    case 'done':
      return { kind: 'done', added: job.added, kept: job.kept, failed: job.failed }
    case 'failed':
      return { kind: 'failed' }
    default:
      return null
  }
}

/** How far the running phase is, 0–1, for the thin bar; null when there is no count (waiting, paused, done, failed). */
export function ambientFraction(ambient: ImportAmbient): number | null {
  if (ambient.kind !== 'matching' && ambient.kind !== 'covers' && ambient.kind !== 'writing') return null
  return ambient.total > 0 ? Math.min(1, ambient.done / ambient.total) : 0
}

/** The three phases as steps of one import (1 of 3 …), for the page's quiet "step" line. */
export function ambientStep(ambient: ImportAmbient): number | null {
  return ambient.kind === 'matching' ? 1 : ambient.kind === 'covers' ? 2 : ambient.kind === 'writing' ? 3 : null
}

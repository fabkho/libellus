/**
 * What the rest of the app says about the import while it runs (components/shell/ImportStatus.vue): one small
 * thing at a time, from the import store's state. Pure, so Vitest pins every state in plain Node.
 *
 * queued — waiting in line behind `ahead` imports · elsewhere — her own import runs on another device ·
 * matching — the lookups (`done` of `total` books) · importing — the write · covers — the cover fill that goes on
 * after the lookups · ready — the lookups are done and the preview waits for her · done — the summary is ready.
 * Nothing before a file is read, and nothing once she has chosen another file.
 */

export type ImportAmbient =
  | { kind: 'queued'; ahead: number }
  | { kind: 'elsewhere' }
  | { kind: 'matching'; done: number; total: number }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'covers'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'done'; added: number }

export type ImportAmbientInput = {
  phase: 'pick' | 'reading' | 'matching' | 'preview' | 'importing' | 'done'
  queued: { kind: 'waiting'; ahead: number } | { kind: 'elsewhere' } | null
  progress: { done: number; total: number }
  coverProgress: { done: number; total: number } | null
  added: number
}

export function importAmbient(input: ImportAmbientInput): ImportAmbient | null {
  switch (input.phase) {
    case 'matching':
      if (input.queued?.kind === 'waiting') return { kind: 'queued', ahead: input.queued.ahead }
      if (input.queued?.kind === 'elsewhere') return { kind: 'elsewhere' }
      return { kind: 'matching', done: input.progress.done, total: input.progress.total }
    case 'importing':
      return { kind: 'importing', done: input.progress.done, total: input.progress.total }
    case 'preview': {
      const covers = input.coverProgress
      return covers && covers.total > 0 && covers.done < covers.total ? { kind: 'covers', done: covers.done, total: covers.total } : { kind: 'ready' }
    }
    case 'done':
      return { kind: 'done', added: input.added }
    default:
      return null
  }
}

/** How far the running thing is, 0–1, for the thin bar; null when it has no count (waiting, ready, done). */
export function ambientFraction(ambient: ImportAmbient): number | null {
  if (ambient.kind !== 'matching' && ambient.kind !== 'importing' && ambient.kind !== 'covers') return null
  return ambient.total > 0 ? Math.min(1, ambient.done / ambient.total) : 0
}

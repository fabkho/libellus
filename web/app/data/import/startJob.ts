import type { SupabaseClient } from '@supabase/supabase-js'
import { deviceOf, languagesOf, startImportJob, type ImportJobError } from '../importJob'
import { prepareUpload, type FileError, type FileErrorDetail } from '../importUpload'

/**
 * The device's own key-value storage, read here so that the screen need not know a device id exists (`deviceOf` keeps it):
 * the app is an SPA, so this is the browser; a test or a native port hands `device` in instead. Storage that cannot even be
 * reached (a browser that refuses the property) is no storage, and `deviceOf` then makes an id it cannot keep.
 */
function deviceStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * The device's whole part of an import behind one door (proposal #329, plan import-seam): read the file she picked
 * (`data/importUpload.ts`: which app wrote it is told by its header, and the rows worth uploading are the ones she does not
 * hold already, `data/import/dedupe.ts`), then hand them to the server job (`start_import_job`, `data/importJob.ts`).
 *
 * One function, so `stores/import.ts` holds screen state and not the file: it knows no key, no title index, no row, no
 * `deviceOf` and no `languagesOf`. Framework-free like every repository (the client, the day and the two device facts come
 * in), so Vitest drives it in plain Node and a native port reimplements it as it stands.
 *
 * The refusals are the two files' own, unchanged: the file's (`FileError`, copy under `import.fileError.<code>`) and the
 * server's (`ImportJobError`, copy under `import.startError.<code>`); the screen words whichever came back.
 */
/**
 * The codes the server answered (`ImportJobError`), so a screen knows which of the two files' copy to use for a refusal. The
 * file's own codes are the other family (`FileError`: `notSupported`, `notCsv`, `missingColumns`, `empty`, the zip's …). Two
 * codes mean the same thing in both — `unknown` — and it is worded identically in both files ("Something went wrong"), so it is
 * read as the server's.
 */
const JOB_ERRORS: readonly ImportJobError[] = ['import_too_soon', 'device_import_running', 'import_running', 'rows_invalid', 'job_unknown', 'offline', 'unknown']

/** Whether a refusal came from the server rather than from the file. */
export const isJobError = (code: FileError | ImportJobError): code is ImportJobError => JOB_ERRORS.some((one) => one === code)

export type StartedJob =
  | { ok: true; jobId: string; already: number; total: number }
  | { ok: false; error: FileError | ImportJobError; detail?: FileErrorDetail }

/**
 * The whole device part of an import. `opts.today` is the day the books are added on; `opts.zip` whether a Hardcover zip is
 * taken as well as a CSV (the build's flag, `composables/useImportZip.ts`); `opts.languages` the app's, first first (the
 * lookups rank editions by them). `opts.device` is an override for this device's id (`deviceOf`, kept in `localStorage`): the
 * default is this browser's, so the screen passes none and a test or a native port its own.
 *
 * Never throws. `already` counts the file's books the device kept back (imported before, or hers under another edition);
 * `total` counts the rows that went up. A file whose every book is in her Library already starts no job: it answers
 * `{ ok: true, total: 0 }` with an empty `jobId`, which the screen shows as "nothing new", not as a refusal.
 */
export async function startJobFromFile(
  client: SupabaseClient,
  bytes: Uint8Array,
  opts: { today: string; zip?: boolean; device?: () => string; languages: readonly string[] },
): Promise<StartedJob> {
  const prepared = await prepareUpload(client, bytes, opts.today, { zip: opts.zip })
  if (!prepared.ok) return prepared.detail ? { ok: false, error: prepared.error, detail: prepared.detail } : { ok: false, error: prepared.error }
  if (!prepared.rows.length) return { ok: true, jobId: '', already: prepared.already, total: 0 }
  const started = await startImportJob(client, {
    rows: prepared.rows,
    source: prepared.source,
    device: opts.device ? opts.device() : (deviceOf(deviceStorage(), () => crypto.randomUUID()) ?? ''),
    already: prepared.already,
    languages: languagesOf(opts.languages),
    collectionOrder: prepared.collectionOrder,
    emptyCollections: prepared.emptyCollections,
  })
  if (started.error) return { ok: false, error: started.error }
  return { ok: true, jobId: started.data, already: prepared.already, total: prepared.rows.length }
}

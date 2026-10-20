import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createLibrary } from '@/data/library'
import {
  addedEntryIds,
  cancelImportJob,
  importJobAhead,
  isLive,
  latestImportJob,
  retryImportJob,
  startImportJob,
  type StartArguments,
} from '@/data/importJob'
import { prepareUpload } from '@/data/importUpload'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The app's side of the import job (data/importJob.ts), as a signed-in member against the local stack: she starts a job with her rows,
 * reads her own job and its place in line, is refused what the server refuses (`import_too_soon`, `device_import_running`,
 * `import_running`), retries a failed job from its own rows and cancels a live one. The device's reading of a real export
 * (data/importUpload.ts): which rows go up, which are left out as there already. The job's own work (matching, covers, write)
 * is the edge function's, tested in supabase/functions/import-job and by pgTAP.
 */

const rows = (count: number, prefix = 'goodreads') =>
  Array.from({ length: count }, (_, at) => ({ key: `${prefix}:${runTitle(String(at + 1))}`, title: `Book ${at + 1}`, authors: ['A. Author'], collections: ['favourites'] }))

const start = (count = 3, over: Partial<StartArguments> = {}): StartArguments => ({ rows: rows(count), source: 'goodreads', device: 'dev-test-device-1', already: 0, languages: ['en'], ...over })

/** The job's rows are written by the runner, not a member: a test plays the runner. */
async function finish(job: string, state: 'done' | 'failed') {
  await sql(`update public.import_job_rows set state = 'done', outcome = case when idx = 0 then 'added' else outcome end where job_id = $1 and idx = 0`, [job])
  await sql(
    `update public.import_jobs set state = $2, finished_at = now(), error = case when $2 = 'failed' then 'stalled' end, added = 1,
       created_at = created_at - interval '1 hour' where id = $1`,
    [job, state],
  )
  await sql(`delete from public.import_queue where holder = 'job:' || $1`, [job])
}

describe('starting an import job', () => {
  it('uploads the rows, and she reads her own job (queued, nothing done)', async () => {
    const ada = await signUpMember()
    const started = await startImportJob(ada.client, start(3, { already: 2 }))
    expect(started.error).toBeNull()
    const job = await latestImportJob(ada.client)
    expect(job.data).toMatchObject({ id: started.data, state: 'queued', total: 3, matched: 0, covered: 0, written: 0, kept: 2, failed: 0 })
    expect(isLive(job.data)).toBe(true)
    await cancelImportJob(ada.client, started.data!)
  })

  it('says how many imports are in line before hers: none when she has the slot, the one running when she waits', async () => {
    // The queue is the database's, one for every test run on this stack: an empty one first.
    await sql('delete from public.import_queue')
    const bea = await signUpMember()
    const ada = await signUpMember()
    const first = await startImportJob(bea.client, start())
    const second = await startImportJob(ada.client, start())
    expect((await importJobAhead(bea.client, first.data!)).data).toBe(0)
    expect((await importJobAhead(ada.client, second.data!)).data).toBe(1)
    await cancelImportJob(bea.client, first.data!)
    expect((await importJobAhead(ada.client, second.data!)).data).toBe(0)
    await cancelImportJob(ada.client, second.data!)
  })

  it('one live job at a time, one start a minute or two: the refusals come back as the app\'s words', async () => {
    const ada = await signUpMember()
    const first = await startImportJob(ada.client, start())
    expect((await startImportJob(ada.client, start())).error).toBe('import_running')
    expect((await cancelImportJob(ada.client, first.data!)).data).toBe(true)
    // Cancelled: nothing is live, but a start within 2 minutes of any job is still too soon.
    expect((await startImportJob(ada.client, start())).error).toBe('import_too_soon')
  })

  it('refuses while her device import (the old app) still holds a place in line', async () => {
    const ada = await signUpMember()
    expect((await ada.client.rpc('import_slot_take', { p_holder: 'device:old-app-0001', p_rows: 5, p_device: 'dev-old' })).error).toBeNull()
    expect((await startImportJob(ada.client, start())).error).toBe('device_import_running')
    await ada.client.rpc('import_slot_leave', { p_holder: 'device:old-app-0001' })
    expect((await startImportJob(ada.client, start())).error).toBeNull()
  })

  it('refuses rows the server cannot take (none, or a key twice)', async () => {
    const ada = await signUpMember()
    expect((await startImportJob(ada.client, start(0))).error).toBe('rows_invalid')
    expect((await startImportJob(ada.client, { ...start(), rows: [{ key: 'a' }, { key: 'a' }] })).error).toBe('rows_invalid')
  })

  it('a visitor cannot start one', async () => {
    const ada = await signUpMember()
    await ada.client.auth.signOut()
    expect((await startImportJob(ada.client, start())).error).toBe('unknown')
  })
})

describe('her job is hers alone', () => {
  it('another member reads nothing of it, and cannot cancel or retry it', async () => {
    const ada = await signUpMember()
    const bea = await signUpMember()
    const started = await startImportJob(ada.client, start())
    expect((await latestImportJob(bea.client)).data).toBeNull()
    expect((await cancelImportJob(bea.client, started.data!)).data).toBe(false)
    expect((await retryImportJob(bea.client, started.data!)).error).toBe('job_unknown')
    await cancelImportJob(ada.client, started.data!)
  })
})

describe('a failed job', () => {
  it('is retried from its own rows: no file, the rows written already counted as there', async () => {
    const ada = await signUpMember()
    const failed = (await startImportJob(ada.client, start(4))).data!
    expect((await retryImportJob(ada.client, failed)).error).toBe('job_unknown')
    await finish(failed, 'failed')
    const retried = await retryImportJob(ada.client, failed)
    expect(retried.error).toBeNull()
    expect(retried.data).not.toBe(failed)
    expect((await latestImportJob(ada.client)).data).toMatchObject({ id: retried.data, state: 'queued', total: 3, kept: 1 })
    await cancelImportJob(ada.client, retried.data!)
  })
})

describe('the books a done job added', () => {
  it('are the entries of its rows with the outcome `added`, never the ones she had', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const entry = (
      await library.addToLibrary({
        title: runTitle('Added by the job'), authors: ['A. Author'], isbn13: null, isbn10: null, pageCount: null, year: null, language: null,
        publisher: TEST_PUBLISHER, description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'apple',
        appleId: uniqueAppleId(), openLibraryEditionKey: null, openLibraryWorkKey: null,
      })
    ).data!
    const job = (await startImportJob(ada.client, start(3))).data!
    await sql(`update public.import_job_rows set outcome = 'added', entry_id = $2, state = 'done' where job_id = $1 and idx = 0`, [job, entry.id])
    await sql(`update public.import_job_rows set outcome = 'in_library', entry_id = $2, state = 'done' where job_id = $1 and idx = 1`, [job, entry.id])
    expect((await addedEntryIds(ada.client, job)).data).toEqual([entry.id])
    await cancelImportJob(ada.client, job)
  })
})

describe('reading a real export on the device', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/goodreads/library_export.csv', import.meta.url)))

  it('sends every book, with its shelves as Collections, to a member with an empty Library', async () => {
    const ada = await signUpMember()
    const prepared = await prepareUpload(ada.client, bytes, '2026-11-05')
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.source).toBe('goodreads')
    expect(prepared.already).toBe(0)
    expect(prepared.rows.length).toBe(prepared.books)
    expect(prepared.rows[0]).toMatchObject({ source: 'goodreads' })
    expect(prepared.rows[0]).toHaveProperty('collections')
    // What the server takes, byte for byte: it is accepted as it is.
    expect((await startImportJob(ada.client, { rows: prepared.rows, source: prepared.source, device: null, already: 0, languages: ['en'] })).error).toBeNull()
  })

  it('says why a file cannot be used, and leaves out nothing it cannot decide', async () => {
    const ada = await signUpMember()
    expect(await prepareUpload(ada.client, new TextEncoder().encode('a,b\n1,2\n'), '2026-11-05')).toMatchObject({ ok: false, error: 'notSupported' })
    expect(await prepareUpload(ada.client, new Uint8Array(0), '2026-11-05')).toMatchObject({ ok: false })
  })
})

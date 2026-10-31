import { defineStore } from 'pinia'
import {
  addedEntryIds,
  cancelImportJob,
  deviceOf,
  hasSeen,
  importJobAhead,
  isLive,
  latestImportJob,
  markSeen,
  retryImportJob,
  startImportJob,
  worthShowing,
  type ImportJob,
  type ImportJobError,
} from '~/data/importJob'
import { createRealtimePort, type RealtimeModule } from '~/data/importJobFeed'
import { createJobWatch, type JobWatch } from '~/data/importJobWatch'
import type { FileError, FileErrorDetail } from '~/data/importUpload'
import { useCoverUpgradeStore } from '~/stores/coverUpgrade'
import { prepareUpload } from '~/data/importUpload'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { isoDay } from '~/utils/dates'
import { writeImportHint } from '~/utils/importHint'
import { UPGRADE_LISTS_KEY } from '~/utils/coverUpgradeList'
import { importAmbient } from '~/utils/importProgress'
import { parseAppConfig } from '~/utils/appConfig'

/** Jobs whose books the one-time Apple cover upgrade has been made a list for (once per job, on this device). */
const UPGRADED_KEY = 'libellus.import-jobs-upgraded'

/** Where the device-side import kept its lookups and its place in line (#371): gone with that path, cleaned once. */
const LEGACY_KEYS = ['libellus.import-matches', 'libellus.import-matches.v2', 'libellus.import-holder', 'libellus.import-device-slot']

export type { FileError }

/**
 * pick: no file yet, or the one chosen was not usable · reading: the file is being read on the device and her Library checked for
 * what is there · starting: the rows are going up to the server · job: a job of hers is on show (live, or its result).
 */
export type ImportPhase = 'pick' | 'reading' | 'starting' | 'job'

/**
 * The import screen (issues #40, #111) and the pill on every other screen, on the server job (proposal #329).
 *
 * The member picks a file; the app reads it on the device (data/importUpload.ts: which app wrote it is told by its header) and checks
 * what is in her Library already; the rows go up (`start_import_job`) and the app only watches from then on: the server looks the books
 * up, decides their covers and writes them, while she uses the app, or closes it. There is no review step and no choice to
 * make: "Choose edition" lives on each Book's own page. What the screen and the pill show is the JOB's state (utils/importProgress.ts),
 * live over Supabase Realtime (data/importJobWatch.ts, data/importJobFeed.ts): the real client is loaded only while a job of hers is
 * live, and the app reads the job once when it opens and again after every reconnect and when the server has her changes subscribed. Nothing polls;
 * the one fallback is the silence net (a read when the socket said nothing for 30 s while the job is live, data/importJobWatch.ts).
 *
 * A done job makes the one-time Apple cover upgrade's list on this device (stores/coverUpgrade.ts) from the books it added.
 */
export const useImportStore = defineStore('import', () => {
  const backend = useBackend()
  const libraryStore = useLibraryStore()
  const session = useSessionStore()
  // Composables need the app (the config, the language); asked here, not after an `await`.
  const config = parseAppConfig(useRuntimeConfig().public)
  const searchLanguages = useSearchLanguages()
  // Whether a Hardcover zip is taken as well as a CSV (a build's flag, composables/useImportZip.ts).
  const zip = useImportZip()

  const phase = ref<ImportPhase>('pick')
  const fileName = ref<string | null>(null)
  const fileError = ref<FileError | null>(null)
  /** For `missingColumns`: the app the file is from and the columns it lacks; for `zipMissing`: the files. */
  const fileErrorDetail = ref<FileErrorDetail | null>(null)
  /** The server refused the start (or the retry): `import_too_soon`, `device_import_running` … */
  const startError = ref<ImportJobError | null>(null)
  /** Every book of the file is in her Library already: nothing was uploaded. */
  const nothingNew = ref(false)
  /** The job on show: live, or finished and not seen yet. */
  const job = shallowRef<ImportJob | null>(null)
  /** Imports in line before a queued job (the one running included). */
  const ahead = ref(0)
  /** A retry or a cancel is on its way. */
  const busy = ref(false)

  const storage = () => (import.meta.client ? window.localStorage : null)
  const live = computed(() => isLive(job.value))
  const ambient = computed(() => (phase.value === 'job' ? importAmbient(job.value, ahead.value) : null))
  /** The job's phase says what the screen's stage is. */
  const counts = computed(() => (job.value ? { added: job.value.added, kept: job.value.kept, failed: job.value.failed } : null))

  // ------------------------------------------------------------------ the job, watched

  let jobWatch: JobWatch | null = null
  function watcher(): JobWatch | null {
    if (!backend || !config.ok) return null
    const app = config.config
    return (jobWatch ??= createJobWatch({
      read: () => latestImportJob(backend),
      ahead: (id) => importJobAhead(backend, id),
      member: () => session.member?.id ?? null,
      worth: (found) => worthShowing(found, (id) => hasSeen(storage(), id)),
      onJob(found, place) {
        // A cancelled job is nothing to show.
        const next = found?.state === 'cancelled' ? null : found
        job.value = next
        ahead.value = place
        if (next && phase.value !== 'reading' && phase.value !== 'starting') phase.value = 'job'
        else if (!next && phase.value === 'job') phase.value = 'pick'
        blockUpgrade(live.value)
        if (next?.state === 'done') void finished(next)
      },
      port: createRealtimePort({
        url: app.supabaseUrl,
        anonKey: app.supabaseAnonKey,
        token: async () => (await backend.auth.getSession()).data.session?.access_token ?? null,
        // The real Realtime client, in a chunk of its own: only a live job of hers loads it (the app's client is built with the stub).
        load: () => import('#realtime-client') as unknown as Promise<RealtimeModule>,
      }),
    }))
  }

  /** The upgrade's store (and what it asks Apple through) is only built when there is something to do. */
  let upgrader: ReturnType<typeof useCoverUpgradeStore> | null = null
  async function upgraderOf() {
    return (upgrader ??= useCoverUpgradeStore())
  }
  function upgradeWaiting(): boolean {
    const member = session.member?.id
    const store = storage()
    if (!member || !store) return false
    try {
      return Boolean(store.getItem(UPGRADE_LISTS_KEY)?.includes(member))
    } catch {
      return false
    }
  }
  /** A job of hers is live (the upgrade waits for it) or not (it goes on with what is left). */
  function blockUpgrade(liveNow: boolean) {
    if (upgrader || liveNow || upgradeWaiting()) void upgraderOf().then((store) => store.block(liveNow))
  }

  /** A job that is done: the Library shows the new books, Home stops offering the import, the Apple upgrade lists what was added (once). */
  async function finished(done: ImportJob) {
    const store = storage()
    const member = session.member?.id
    if (!store || !member || hasSeenUpgrade(store, done.id)) return
    markUpgrade(store, done.id)
    if (done.added > 0) writeImportHint(store, member, 'imported')
    void libraryStore.load()
    if (!backend || !done.added) return
    const ids = await addedEntryIds(backend, done.id)
    if (ids.data && session.member?.id === member) void upgraderOf().then((store) => store.start(done.id, ids.data!))
  }
  function hasSeenUpgrade(store: Storage, id: string): boolean {
    try {
      return (JSON.parse(store.getItem(UPGRADED_KEY) ?? '[]') as string[]).includes(id)
    } catch {
      return false
    }
  }
  function markUpgrade(store: Storage, id: string) {
    try {
      const kept = JSON.parse(store.getItem(UPGRADED_KEY) ?? '[]') as string[]
      store.setItem(UPGRADED_KEY, JSON.stringify([...kept.filter((one) => one !== id), id].slice(-20)))
    } catch {
      // Storage refused: the list may be made twice, which `makeUpgradeList` and the list's id make harmless.
    }
  }

  // ---------------------------------------------------------------------- actions

  /** Back to the start: no file, no error, no job on show (her live job, if any, is read again). */
  function clear() {
    phase.value = 'pick'
    fileName.value = null
    fileError.value = null
    fileErrorDetail.value = null
    startError.value = null
    nothingNew.value = false
    busy.value = false
  }

  /** Reads the file on the device, uploads the rows and starts the job. */
  async function choose(file: File) {
    if (!backend || phase.value === 'reading' || phase.value === 'starting' || live.value) return
    clear()
    fileName.value = file.name
    phase.value = 'reading'
    const bytes = new Uint8Array(await file.arrayBuffer().catch(() => new ArrayBuffer(0)))
    const prepared = await prepareUpload(backend, bytes, isoDay(), { zip })
    if (!prepared.ok) {
      fileError.value = prepared.error
      if (prepared.detail) fileErrorDetail.value = prepared.detail
      phase.value = 'pick'
      return
    }
    if (!prepared.rows.length) {
      nothingNew.value = true
      phase.value = 'pick'
      return
    }
    phase.value = 'starting'
    const started = await startImportJob(backend, {
      rows: prepared.rows,
      source: prepared.source,
      device: deviceOf(storage(), () => crypto.randomUUID()),
      already: prepared.already,
      languages: searchLanguages(),
      collectionOrder: prepared.collectionOrder,
      emptyCollections: prepared.emptyCollections,
    })
    await settle(started)
  }

  /** The start's (or the retry's) answer: the job is shown and followed, or the refusal is told. */
  async function settle(started: Awaited<ReturnType<typeof startImportJob>>) {
    if (started.error) {
      startError.value = started.error
      phase.value = 'pick'
      // A job of hers is live already (another device started it, or this was pressed twice): that one is what to show.
      if (started.error === 'import_running') void refresh()
      return
    }
    job.value = null
    phase.value = 'job'
    await watcher()?.adopt(started.data)
  }

  /** Starts a new job from the failed one's own rows ("Try again"). */
  async function retry() {
    const failed = job.value
    if (!backend || busy.value || !failed || failed.state !== 'failed') return
    busy.value = true
    startError.value = null
    try {
      await settle(await retryImportJob(backend, failed.id))
    } finally {
      busy.value = false
    }
  }

  /** Stops her live job: what it wrote stays. */
  async function cancel() {
    const live_ = job.value
    if (!backend || busy.value || !live_ || !isLive(live_)) return
    busy.value = true
    try {
      const answer = await cancelImportJob(backend, live_.id)
      if (!answer.error) {
        // Cancelled: nothing of it is shown. Not cancelled (it was over already): the read says what became of it.
        jobWatch?.stop()
        job.value = null
        ahead.value = 0
        clear()
        blockUpgrade(false)
        if (!answer.data) await refresh()
      }
    } finally {
      busy.value = false
    }
  }

  /** The result has been seen (the pill's ×, leaving the done page): it is not told again. */
  function acknowledge() {
    const seen = job.value
    if (!seen || isLive(seen)) return
    markSeen(storage(), seen.id)
    job.value = null
    clear()
  }

  /** Looks at her newest job once (app start, member change, a refused start): a live one is followed over Realtime. */
  async function refresh() {
    await watcher()?.check()
  }

  function reset() {
    jobWatch?.stop()
    job.value = null
    ahead.value = 0
    clear()
  }

  // The app comes back to the front: the socket may have slept, one read says where the job stands.
  if (import.meta.client) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) jobWatch?.nudge()
    })
    // The connection is back after the app opened without it: the one read it missed.
    window.addEventListener('online', () => {
      if (session.member && !job.value) void refresh()
    })
  }

  // Another member, or nobody: nothing of the last one's job stays.
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      const store = storage()
      if (store) for (const key of LEGACY_KEYS) store.removeItem(key)
      if (now) {
        void refresh()
        // The upgrade left unfinished by an earlier import goes on (it waits for a live job).
        if (upgradeWaiting()) void upgraderOf().then((store) => store.work())
      } else upgrader?.stop()
    },
    { immediate: true },
  )

  return {
    phase,
    fileName,
    fileError,
    fileErrorDetail,
    startError,
    nothingNew,
    job,
    ahead,
    busy,
    live,
    ambient,
    counts,
    choose,
    retry,
    cancel,
    acknowledge,
    refresh,
    reset: clear,
  }
})

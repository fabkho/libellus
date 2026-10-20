import { defineStore } from 'pinia'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import { runCoverUpgrade, type UpgradeList } from '~/data/coverUpgrade'
import { createUpgradeCatalogue, type UpgradeCatalogue } from '~/data/coverUpgradeCatalogue'
import { probeImageInBrowser } from '~/data/covers'
import { createDnb, DNB_IMPORT_GAP_MS } from '~/data/dnb'
import { pacedFetch, type PacedFetch } from '~/data/bookImport'
import { accessTokenOf, viaOwnServer } from '~/data/openLibraryProxy'
import { createSearch, type Search } from '~/data/search'
import { useSessionStore } from '~/stores/session'
import { makeUpgradeList, readUpgradeLists, writeUpgradeLists } from '~/utils/coverUpgradeList'
import { parseAppConfig } from '~/utils/appConfig'

/** An Apple upgrade that paused (a refusal) is tried again after this long, while the app stays open. */
const UPGRADE_RETRY_MS = 600_000

/**
 * The one-time Apple cover upgrade (data/coverUpgrade.ts, issue #366), after an import. The server job (#329) adds the books and never
 * asks Apple; when it is done, the Catalogue Books that import ADDED (never one she held already or imported before) whose cover
 * is small, linked or missing are listed on this device (utils/coverUpgradeList.ts, from the job's own rows:
 * `data/importJob.ts` `addedEntryIds`), the list is worked off in the background, once, and resumes on the next app start until it is.
 * It runs only while no import job of hers is live. Nothing of it is shown: no pill, no error; an Apple refusal pauses it and it tries
 * again later. The device that read the file is the one that asks (Apple's limit is per address).
 */
export const useCoverUpgradeStore = defineStore('coverUpgrade', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const searchLanguages = useSearchLanguages()

  let searcher: Search | null = null
  let liveFetch: PacedFetch | null = null
  let languageKey = ''
  let upgradeCatalogue: UpgradeCatalogue | null = null
  let upgrading = false
  let abort: AbortController | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  /** Lists that paused this session (Apple refused): not asked again until the retry. */
  const paused = new Set<string>()
  /** Whether a job of hers is live: nothing else needs Apple, but the job is her import's, so the upgrade waits for it. */
  let blocked = false

  const storage = () => (import.meta.client ? window.localStorage : null)

  /** The searcher and the paced `fetch` the upgrade asks Apple through (one pace, identified to Open Library). */
  function search(): { search: Search; paced: PacedFetch } | null {
    const config = parseAppConfig(useRuntimeConfig().public)
    if (!backend || !config.ok) return null
    const languages = searchLanguages()
    if (languageKey !== languages.join(',')) searcher = null
    languageKey = languages.join(',')
    // Apple refuses a burst; a little room between its requests keeps it answering.
    liveFetch ??= pacedFetch(
      viaOwnServer((url, init) => fetch(url, init), {
        functionUrl: `${config.config.supabaseUrl}/functions/v1/openlibrary`,
        apikey: config.config.supabaseAnonKey,
        token: accessTokenOf(backend),
      }),
      { gapMs: { 'itunes.apple.com': 250, 'openlibrary.org': 340 } },
    )
    searcher ??= createSearch({
      fetch: liveFetch,
      languages,
      catalogue: createCatalogueSearch(backend),
      dnb: createDnb(backend, { online: isOnline, purpose: 'import', gapMs: DNB_IMPORT_GAP_MS }),
    })
    return { search: searcher, paced: liveFetch }
  }

  function stop() {
    abort?.abort()
    abort = null
    if (retry) clearTimeout(retry)
    retry = null
    paused.clear()
  }

  /** Keeps one list as it is now (a worked-off one is dropped: done for good). */
  function keep(list: UpgradeList) {
    const member = session.member?.id
    const store = storage()
    if (!member || !store) return
    writeUpgradeLists(store, member, [...readUpgradeLists(store, member).filter((kept) => kept.id !== list.id), list])
  }

  /** Whether a list waits for work on this device (cheap: nothing is built to know). */
  function waiting(): boolean {
    const member = session.member?.id
    const store = storage()
    return Boolean(member && store && readUpgradeLists(store, member).some((list) => !paused.has(list.id)))
  }

  /** Works the member's lists off, one after the other, and resolves when there is none left to try. Guarded: one run at a time. */
  async function work() {
    const member = session.member?.id
    const store = storage()
    if (upgrading || blocked || !member || !store || !backend || !isOnline() || !waiting()) return
    const asked = search()
    if (!asked) return
    upgrading = true
    const controller = new AbortController()
    abort = controller
    upgradeCatalogue ??= createUpgradeCatalogue(backend)
    const covers = upgradeCatalogue
    try {
      for (;;) {
        const list = readUpgradeLists(store, member).find((one) => !paused.has(one.id))
        if (!list || controller.signal.aborted) break
        const run = await runCoverUpgrade(list, {
          search: asked.search,
          probe: probeImageInBrowser,
          currentCovers: covers.currentCovers,
          write: covers.write,
          hostBlockedFor: (host) => asked.paced.blockedFor(host),
          signal: controller.signal,
          onSave: keep,
        })
        keep(list)
        if (run.paused && !controller.signal.aborted) {
          // Apple refused (or the Catalogue could not be reached): quietly, later.
          paused.add(list.id)
          retry ??= setTimeout(() => {
            retry = null
            paused.clear()
            void work()
          }, UPGRADE_RETRY_MS)
        }
      }
    } finally {
      upgrading = false
      if (abort === controller) abort = null
    }
    // Stopped for a job that started before this run let go: nothing else will start it again.
    if (controller.signal.aborted && !blocked) void work()
  }

  /**
   * The import is done: its list is made from the new entries it added (`entryIds`) and worked off. A list is only made from an
   * import's own added rows, so a later import, or a book she adds, never makes or restarts one.
   */
  async function start(jobId: string, entryIds: string[]) {
    const member = session.member?.id
    const store = storage()
    if (!member || !store || !backend || !entryIds.length) return void work()
    upgradeCatalogue ??= createUpgradeCatalogue(backend)
    const rows = await upgradeCatalogue.rowsForEntries(entryIds).catch(() => null)
    const list = rows && session.member?.id === member ? makeUpgradeList(`import-${jobId}`, rows) : null
    if (list) keep(list)
    void work()
  }

  /** A job of hers is live (the upgrade waits) or not (it goes on with what is left). */
  function block(live: boolean) {
    blocked = live
    if (live) stop()
    else void work()
  }

  return { start, work, stop, block }
})

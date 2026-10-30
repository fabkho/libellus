import { defineStore } from 'pinia'
import { forgetBothRead, readBothRead, sameBothRead, saveBothRead } from '~/data/bothReadDevice'
import { createMemberStats, type MemberRecord, type MemberStats } from '~/data/memberStats'
import type { BothRead, MemberProfile, SocialBook, SocialErrorCode } from '~/data/social'
import type { StatsYear } from '~/data/stats'
import { defaultRange, type ChartRange } from '~/data/statsChart'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'
import { profileAfter, yearIn, type RelationChange } from '~/utils/memberProfile'
import { isoDay } from '~/utils/dates'
import { createRereads } from '~/utils/rereads'

/** Her whole Want to read, newest first (*See all*). */
export type MemberWant = { book: SocialBook; addedOn: string }[]

/** The key of `MemberView.bothRead`: one year, or `all`. */
export const bothReadKey = (year: number | null): string => (year === null ? 'all' : String(year))

/** What the page knows of one member. */
export type MemberView = {
  /** Her profile; `null`: there is nobody to show (a missing member, or one who blocked her). */
  profile: MemberProfile | null
  /** Her reading record (her figures); null while it is on its way, or when it is not for her. */
  record: MemberRecord | null
  /** Whether the record is still being asked for. */
  recordLoading: boolean
  /** The last refusal of reading her record, with none on screen: her figures are missing, not "not for you". */
  recordError: SocialErrorCode | null
  /** Her whole Want to read, once asked for. */
  want: MemberWant | null
  /**
   * The Books she and the member both finished ("You both read"), by `bothReadKey`: all her years, or one.
   * An extra section: never an error, a refusal or being offline leaves what was read, or nothing.
   */
  bothRead: Record<string, BothRead[]>
  /** The answer for "You both read" is on its way and none is held yet: the page holds the section's box meanwhile. */
  bothReadLoading: boolean
  /** The year in the pills. */
  year: StatsYear
  /** The chart's mode and window (data/statsChart.ts): kept while the member opens a book from a bar's sheet and comes back. */
  chart: ChartRange
  /** The last refusal of reading her, with no copy to show instead: `offline`, or something else (a retry). */
  error: SocialErrorCode | null
  /** The first answer has come (the profile, or that there is none). */
  loaded: boolean
  /** A follow or a withdrawal on its way. */
  busy: boolean
  /** The last refusal of a follow or a withdrawal. */
  failed: SocialErrorCode | null
}

const fresh = (): MemberView => ({
  profile: null,
  record: null,
  recordLoading: false,
  recordError: null,
  want: null,
  bothRead: {},
  bothReadLoading: false,
  year: 'all',
  chart: defaultRange(isoDay()),
  error: null,
  loaded: false,
  busy: false,
  failed: null,
})

/**
 * Another member's profile and her year in review (social v1, U4): per member id her profile
 * (`social.profile`), her reading record (`createMemberStats(...).record`), her whole Want to read
 * (`social.want`, for *See all*) and the year in the pills. Read each time the page shows, online
 * only: offline the last copy this session loaded stays on screen, or the page says it is offline.
 * Nothing of her is kept on the device but the last "You both read" answer per friend (`data/bothReadDevice.ts`,
 * a whitelist under `libellus.`, this member's, bounded; it goes when her finished section goes off, her profile
 * closes or the relation ends, and with the rest on signing out): her section is drawn from it at once on a return
 * visit and read afresh behind it. Signing out, or another member signing in, forgets every other copy. That answer
 * can also be asked for before her page opens (`prefetchBothRead`: a tap on a friend, a row that comes into view):
 * one request in flight per friend, which the page's own read then takes instead of asking again; held in memory
 * only, and shown only once her profile says it is hers to show. Read only apart from Follow, Ask to follow and its withdrawal, which are the social store's and are
 * followed by a fresh read of her profile (a follow of a public account opens it at once).
 */
export const useMemberProfileStore = defineStore('memberProfile', () => {
  const nuxtApp = useNuxtApp()
  const backend = useBackend()
  const session = useSessionStore()
  const social = useSocialStore()

  let stats: MemberStats | null = null
  function statsRepo(): MemberStats | null {
    if (!backend) return null
    stats ??= createMemberStats(backend, { online: isOnline, outside: () => nuxtApp.$i18n.t('book.outsideCatalogue') })
    return stats
  }

  /** Members whose follow or withdrawal got no answer: her profile is read again when back online. */
  const rereads = createRereads<string>()

  /**
   * "You both read" asked for ahead of her page (`prefetchBothRead`, or the page's own load, started in parallel with her
   * profile), one answer per friend for `ASKED_FOR_MS`: a tap, a row in view and the page itself all reuse it, so
   * a tap a minute after her row warmed does not fetch it again. Held in this store only (forgotten with the member),
   * a few friends at most; never shown by itself.
   */
  const asked = new Map<string, { at: number; answer: ReturnType<typeof social.bothRead> }>()
  const ASKED_FOR_MS = 3 * 60_000
  const ASKED_KEEP = 12
  /** The answer for all her years: the one asked for lately, else a request of its own (and kept for the next). */
  function askBothRead(id: string) {
    const held = asked.get(id)
    if (held && Date.now() - held.at < ASKED_FOR_MS) return held.answer
    const answer = social.bothRead(id, null)
    // A refusal or a connection that dropped is not kept: the next ask tries again.
    void answer.then((result) => {
      if (result.error && asked.get(id)?.answer === answer) asked.delete(id)
    })
    asked.delete(id)
    asked.set(id, { at: Date.now(), answer })
    while (asked.size > ASKED_KEEP) asked.delete(asked.keys().next().value as string)
    return answer
  }
  /**
   * Starts asking for the Books you both read with her, before her page is open (a tap on her, her row coming into
   * view). Online only; one request per friend however many ask. Resolves with the answer (null: offline or nothing
   * came), which the caller may use to warm what it draws (the reel's covers). Nothing is shown from it by itself.
   */
  async function prefetchBothRead(id: string): Promise<BothRead[] | null> {
    if (!isOnline() || !session.member) return null
    const answer = await askBothRead(id)
    return answer.error ? null : answer.data
  }

  const views = ref<Record<string, MemberView>>({})
  /** Bumped when the member changes: an answer that began before it is thrown away. */
  let generation = 0

  const viewOf = (id: string): MemberView => views.value[id] ?? fresh()
  function patch(id: string, change: Partial<MemberView>) {
    views.value = { ...views.value, [id]: { ...viewOf(id), ...change } }
  }

  /**
   * Her profile, then what it opens (her record, her whole Want to read and the Books you both read) while it shows.
   * `year`: her year page, which wants the Books you both read in that year rather than in all her years.
   */
  async function load(id: string, year: number | null = null): Promise<void> {
    const run = generation
    const member = session.member?.id
    const had = viewOf(id)
    if (!isOnline()) {
      if (!had.loaded) patch(id, { error: 'offline' })
      return
    }
    // Her answer for "You both read" starts with her profile, not after it: the database refuses what is not hers to show
    // (it answers nothing then), and nothing of it is used before her profile says it is (below).
    if (year === null && member) void askBothRead(id)
    const answer = await social.profile(id)
    if (run !== generation || member !== session.member?.id) return
    if (answer.error) {
      // The copy this session holds stays; with none, the page says why.
      if (!had.loaded) patch(id, { error: answer.error })
      return
    }
    const profile = answer.data
    if (!profile) return patch(id, { ...fresh(), loaded: true })
    const open = profile.visible
    const mine = session.member?.id
    const wantsRecord = open && profile.sections.year && profile.sections.finished
    const wantsAll = open && profile.sections.want && (profile.counts.want ?? 0) > profile.want.length
    const finished = open && profile.sections.finished
    // Hers to show only while her finished section is on and the profile open: otherwise her copy on this device goes too.
    if (!finished) asked.delete(id)
    if (!finished && mine && import.meta.client) forgetBothRead(window.localStorage, mine, id)
    // The device's copy of the answer, in the same render as the profile: the section is there at once, read afresh behind it.
    const copy = finished && year === null && !viewOf(id).bothRead[bothReadKey(year)] && mine && import.meta.client ? readBothRead(window.localStorage, mine, id, new Date()) : null
    patch(id, {
      profile,
      error: null,
      loaded: true,
      recordError: null,
      recordLoading: wantsRecord && !had.record,
      // A private account she does not follow has none of it.
      ...(open ? {} : { record: null, want: null }),
      ...(open && !profile.sections.year ? { record: null } : {}),
      ...(open && !wantsAll ? { want: null } : {}),
      // "You both read" is hers to show only while her finished section is on and the profile open (privacy review L4).
      ...(finished ? (copy ? { bothRead: { ...viewOf(id).bothRead, [bothReadKey(year)]: copy } } : {}) : { bothRead: {} }),
      // Pending from the same render as the profile (no frame between), when an answer is asked for and none is held.
      bothReadLoading: finished && !viewOf(id).bothRead[bothReadKey(year)] && !copy,
    })
    await Promise.all([wantsRecord ? loadRecord(id, run) : null, wantsAll ? loadWant(id, run) : null, open && profile.sections.finished ? loadBothRead(id, year, run) : null])
  }

  /** "You both read" with her, for all her years or one (the year page): online only, nothing shown on a refusal. */
  async function loadBothRead(id: string, year: number | null, run = generation): Promise<void> {
    if (!isOnline()) return patch(id, { bothReadLoading: false })
    const mine = session.member?.id
    const answer = await (year === null ? askBothRead(id) : social.bothRead(id, year))
    if (run !== generation) return
    if (answer.error) {
      // A refusal (not a connection that dropped) says it is not hers to show: nothing stays, here or on the device.
      if (answer.error !== 'offline' && year === null) {
        if (mine && import.meta.client) forgetBothRead(window.localStorage, mine, id)
        return patch(id, { ...(viewOf(id).bothRead.all ? { bothRead: { ...viewOf(id).bothRead, all: [] } } : {}), bothReadLoading: false })
      }
      return patch(id, { bothReadLoading: false })
    }
    const key = bothReadKey(year)
    const held = viewOf(id).bothRead[key]
    if (year === null && mine && import.meta.client && !(held && answer.data && sameBothRead(held, answer.data))) saveBothRead(window.localStorage, mine, id, answer.data ?? [], new Date())
    // The same Books and ratings as the copy on screen: nothing is replaced (the reel keeps its Library, nothing redraws).
    if (held && answer.data && sameBothRead(held, answer.data)) return patch(id, { bothReadLoading: false })
    patch(id, { bothRead: { ...viewOf(id).bothRead, [key]: answer.data }, bothReadLoading: false })
  }

  async function loadRecord(id: string, run: number) {
    const answer = await statsRepo()?.record(id)
    if (run !== generation) return
    // A refusal keeps the record already on screen; without one the figures give way, and the page says why
    // (a record that is "not for her" answers null without an error: only that reads as a dead link).
    const record = answer?.error ? viewOf(id).record : (answer?.data ?? null)
    patch(id, { record, recordError: answer?.error ?? null, recordLoading: false, year: record ? yearIn(viewOf(id).year, record.reads) : 'all' })
  }

  async function loadWant(id: string, run: number) {
    const answer = await social.want(id)
    if (run !== generation || answer.error) return
    patch(id, { want: answer.data })
  }

  /** The year in the pills (All, or a year she has finished a read in). */
  function setYear(id: string, year: StatsYear) {
    patch(id, { year })
  }

  /** The chart's mode and window. */
  function setChart(id: string, chart: ChartRange) {
    patch(id, { chart })
  }

  /** Follow, or ask to: then her profile is read again (a public account opens at once). */
  async function follow(id: string): Promise<boolean> {
    return change(id, () => social.follow(id))
  }

  /** Withdraw a request still waiting. */
  async function withdraw(id: string): Promise<boolean> {
    return change(id, () => social.withdraw(id))
  }

  async function change(id: string, run: () => Promise<{ error: SocialErrorCode | null }>): Promise<boolean> {
    if (viewOf(id).busy) return false
    const generationThen = generation
    patch(id, { busy: true, failed: null })
    const sent = isOnline()
    const result = await run()
    if (generationThen !== generation) return false
    rereads.note(sent, result.error, [id])
    if (result.error) {
      patch(id, { busy: false, failed: result.error })
      return false
    }
    await load(id)
    patch(id, { busy: false })
    return true
  }

  /**
   * The caller changed the relation with her (told by the social store, which makes the change): her view
   * follows the action's answer at once (`profileAfter`), so it is right even when the read after it fails
   * or the connection drops. Nothing to patch where her profile was never read.
   */
  function relationChanged(id: string, change: RelationChange) {
    const had = views.value[id]
    if (!had?.loaded) return
    const profile = profileAfter(had.profile, change)
    // She is blocked, unfollowed or no longer follows her: nothing of what was read of her stays (her figures,
    // her Want to read, her year), the view is only what the action's answer makes of her profile.
    if (change.kind === 'block' || change.kind === 'unfollow' || change.kind === 'removeFollower') {
      if (session.member && import.meta.client) forgetBothRead(window.localStorage, session.member.id, id)
      views.value = { ...views.value, [id]: { ...fresh(), loaded: true, profile } }
      return
    }
    if (!profile) return patch(id, { ...fresh(), loaded: true })
    // A closed card has no figures or Want to read of hers to keep.
    patch(id, { profile, ...(profile.visible ? {} : { record: null, want: null, recordLoading: false }) })
  }

  function forget() {
    generation++
    views.value = {}
    asked.clear()
    rereads.clear()
  }

  watch(
    () => session.member?.id ?? null,
    (now, before) => now !== before && forget(),
  )

  // Back online with a profile that could not be read, or whose follow got no answer: read it again.
  const online = useOnline()
  watch(online, (now) => {
    if (!now) return
    for (const id of rereads.take()) void load(id)
    for (const [id, view] of Object.entries(views.value)) if (view.error === 'offline' && !view.loaded) void load(id)
  })

  return { views, viewOf, load, loadBothRead, prefetchBothRead, setYear, setChart, follow, withdraw, relationChanged, forget }
})

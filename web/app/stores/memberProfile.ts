import { defineStore } from 'pinia'
import { createMemberStats, type MemberRecord, type MemberStats } from '~/data/memberStats'
import type { BothRead, MemberProfile, SocialBook, SocialErrorCode } from '~/data/social'
import type { StatsYear } from '~/data/stats'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'
import { profileAfter, yearIn, type RelationChange } from '~/utils/memberProfile'
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
  /** The year in the pills. */
  year: StatsYear
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
  year: 'all',
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
 * Nothing is kept on the device: signing out, or another member signing in, forgets every copy. Read
 * only apart from Follow, Ask to follow and its withdrawal, which are the social store's and are
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
    const wantsRecord = open && profile.sections.year && profile.sections.finished
    const wantsAll = open && profile.sections.want && (profile.counts.want ?? 0) > profile.want.length
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
    })
    await Promise.all([wantsRecord ? loadRecord(id, run) : null, wantsAll ? loadWant(id, run) : null, open && profile.sections.finished ? loadBothRead(id, year, run) : null])
  }

  /** "You both read" with her, for all her years or one (the year page): online only, nothing shown on a refusal. */
  async function loadBothRead(id: string, year: number | null, run = generation): Promise<void> {
    if (!isOnline()) return
    const answer = await social.bothRead(id, year)
    if (run !== generation || answer.error) return
    patch(id, { bothRead: { ...viewOf(id).bothRead, [bothReadKey(year)]: answer.data } })
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

  return { views, viewOf, load, loadBothRead, setYear, follow, withdraw, relationChanged, forget }
})

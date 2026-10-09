import { defineStore } from 'pinia'
import { createMemberStats, type MemberRecord, type MemberStats } from '~/data/memberStats'
import type { MemberProfile, SocialBook, SocialErrorCode } from '~/data/social'
import type { StatsYear } from '~/data/stats'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'
import { yearIn } from '~/utils/memberProfile'

/** Her whole Want to read, newest first (*See all*). */
export type MemberWant = { book: SocialBook; addedOn: string }[]

/** What the page knows of one member. */
export type MemberView = {
  /** Her profile; `null`: there is nobody to show (a missing member, or one who blocked her). */
  profile: MemberProfile | null
  /** Her reading record (her figures); null while it is on its way, or when it is not for her. */
  record: MemberRecord | null
  /** Whether the record is still being asked for. */
  recordLoading: boolean
  /** Her whole Want to read, once asked for. */
  want: MemberWant | null
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
  want: null,
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
  const backend = useBackend()
  const session = useSessionStore()
  const social = useSocialStore()

  let stats: MemberStats | null = null
  function statsRepo(): MemberStats | null {
    if (!backend) return null
    stats ??= createMemberStats(backend, { online: isOnline })
    return stats
  }

  const views = ref<Record<string, MemberView>>({})
  /** Bumped when the member changes: an answer that began before it is thrown away. */
  let generation = 0

  const viewOf = (id: string): MemberView => views.value[id] ?? fresh()
  function patch(id: string, change: Partial<MemberView>) {
    views.value = { ...views.value, [id]: { ...viewOf(id), ...change } }
  }

  /** Her profile, then what it opens (her record and her whole Want to read) while it shows. */
  async function load(id: string): Promise<void> {
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
      recordLoading: wantsRecord && !had.record,
      // A private account she does not follow has none of it.
      ...(open ? {} : { record: null, want: null }),
      ...(open && !profile.sections.year ? { record: null } : {}),
      ...(open && !wantsAll ? { want: null } : {}),
    })
    await Promise.all([wantsRecord ? loadRecord(id, run) : null, wantsAll ? loadWant(id, run) : null])
  }

  async function loadRecord(id: string, run: number) {
    const answer = await statsRepo()?.record(id)
    if (run !== generation) return
    // A refusal keeps the record already on screen; without one the figures give way.
    const record = answer?.error ? viewOf(id).record : (answer?.data ?? null)
    patch(id, { record, recordLoading: false, year: record ? yearIn(viewOf(id).year, record.reads) : 'all' })
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
    const result = await run()
    if (generationThen !== generation) return false
    if (result.error) {
      patch(id, { busy: false, failed: result.error })
      return false
    }
    await load(id)
    patch(id, { busy: false })
    return true
  }

  function forget() {
    generation++
    views.value = {}
  }

  watch(
    () => session.member?.id ?? null,
    (now, before) => now !== before && forget(),
  )

  // Back online with a profile that could not be read: read it again.
  const online = useOnline()
  watch(online, (now) => {
    if (!now) return
    for (const [id, view] of Object.entries(views.value)) if (view.error === 'offline' && !view.loaded) void load(id)
  })

  return { views, viewOf, load, setYear, follow, withdraw, forget }
})

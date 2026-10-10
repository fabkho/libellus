import { defineStore } from 'pinia'
import { CIRCLE_BOOKS_MAX, createSocial, type CircleBook, type Social } from '~/data/social'
import { useFeedStore } from '~/stores/feed'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'
import { FRESH_MS } from '~/utils/fresh'
import type { CircleGroup } from '~/utils/circle'

/**
 * Who she follows reads, or wants to read, the same Books (social v2a, contract §1.4): Home's reading cards,
 * Up next and the Library's Want to read rows show them as small avatars on the cover (FriendsCircleAvatars).
 * `circleReading` is asked with the Book ids of her open reads and `circleWant` with those of her Want to read,
 * each at most `CIRCLE_BOOKS_MAX`, newest first; both maps are by her Book's id. Asked by the store itself
 * whenever her lists arrive or the Books in them change, again when Home or the Library shows and the answer is
 * no longer fresh (`load({ ifStale })`), and after each refresh of the feed; online only: offline, or on a
 * refusal, the last answer stays. It must not depend on a page remembering to ask (Home once did not, and no
 * avatar ever came). A member who follows nobody (her People says so) makes no call, and nothing is asked
 * for a list with no Books. Nothing is kept on the device: another member signing in forgets it.
 */
export const useCircleBooksStore = defineStore('circleBooks', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const social = useSocialStore()
  const library = useLibraryStore()
  const feed = useFeedStore()
  const online = useOnline()

  let repository: Social | null = null
  function repo(): Social | null {
    if (!backend) return null
    repository ??= createSocial(backend, { online: isOnline })
    return repository
  }

  /** Per Book of hers: who else reads it now / wants it. Only Books with somebody have a key. */
  const reading = shallowRef<Record<string, CircleGroup>>({})
  const want = shallowRef<Record<string, CircleGroup>>({})

  /** Bumped when the member changes: an answer that began before it is thrown away. */
  let generation = 0
  let loading: Promise<void> | null = null
  /** A `load` came while one was on its way: it runs once more after it, with the lists as they are then. */
  let again = false
  /** Whether a page has asked for the maps: the feed's refresh only follows once one has. */
  let wanted = false

  const byBook = (books: CircleBook[]): Record<string, CircleGroup> =>
    Object.fromEntries(books.map((b) => [b.book, { members: b.members, more: b.more }]))

  const idsOf = (entries: readonly { book: { id: string } }[]) => [...new Set(entries.map((e) => e.book.id))].slice(0, CIRCLE_BOOKS_MAX)
  /** The Books asked about, as one string: null while her lists are not there yet. */
  const signature = computed(() => (library.loaded ? `${idsOf(library.reading).join()}|${idsOf(library.wantToRead).join()}` : null))
  /** What the last ask was about, and when (`performance.now()`). */
  let askedFor: string | null = null
  let askedAt = -Infinity
  /** The run on its way has read her Books (and the generation it began in): a `load` for other Books, or after a forget, needs another run. */
  let idsRead = false
  let askedGeneration = 0

  async function ask(): Promise<void> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || !isOnline()) return
    const run = generation
    // Whom she follows: read once per sign-in. Nobody: nothing to ask. Not known (it failed): ask anyway.
    await social.loadPeople()
    if (member !== session.member?.id) return
    if (run !== generation) return
    if (social.people && social.people.followingIds.length === 0) {
      reading.value = {}
      want.value = {}
      return
    }
    askedFor = signature.value
    askedAt = performance.now()
    askedGeneration = generation
    idsRead = true
    const readingIds = idsOf(library.reading)
    const wantIds = idsOf(library.wantToRead)
    const [r1, r2] = await Promise.all([
      readingIds.length ? r.circleReading(readingIds) : Promise.resolve({ data: [] as CircleBook[], error: null }),
      wantIds.length ? r.circleWant(wantIds) : Promise.resolve({ data: [] as CircleBook[], error: null }),
    ])
    if (run !== generation || member !== session.member?.id) return
    // A refusal keeps the last answer of that list.
    if (!r1.error) reading.value = byBook(r1.data)
    if (!r2.error) want.value = byBook(r2.data)
  }

  /**
   * Asks again. Calls that come while one is on its way share its next run. `ifStale`: Home or the Library showing
   * again leaves a fresh answer to the same Books alone.
   */
  function load({ ifStale = false }: { ifStale?: boolean } = {}): Promise<void> {
    wanted = true
    if (loading) {
      // One request per set of Books: a call that comes while a run is on its way shares it, unless that run asked
      // about other Books or was begun before a forget (one that has not read her Books yet reads them as they are).
      if (idsRead && (signature.value !== askedFor || generation !== askedGeneration)) again = true
      return loading
    }
    if (ifStale && askedFor === signature.value && performance.now() - askedAt < FRESH_MS) return Promise.resolve()
    loading = (async () => {
      try {
        do {
          again = false
          idsRead = false
          await ask()
        } while (again)
      } finally {
        loading = null
        idsRead = false
      }
    })()
    return loading
  }

  function forget() {
    generation++
    reading.value = {}
    want.value = {}
    askedFor = null
    askedAt = -Infinity
  }

  // Her lists arrived, or her Books changed (one added, started, finished): who else reads or wants them.
  watch(
    signature,
    (now) => {
      if (now !== null && session.member) void load()
    },
    { immediate: true },
  )

  /**
   * A member left her circle (unfollow, block, remove as follower): she goes from the groups at once, and an answer
   * on its way (it may still name her) is thrown away; the next `load` asks again. A group with nobody left goes.
   */
  function dropMember(id: string) {
    const without = (groups: Record<string, CircleGroup>): Record<string, CircleGroup> =>
      Object.fromEntries(
        Object.entries(groups).flatMap(([book, group]) => {
          if (!group.members.some((m) => m.id === id)) return [[book, group]]
          const members = group.members.filter((m) => m.id !== id)
          return members.length ? [[book, { ...group, members }]] : []
        }),
      )
    generation++
    askedAt = -Infinity
    reading.value = without(reading.value)
    want.value = without(want.value)
  }

  watch(
    () => session.member?.id ?? null,
    (now, before) => now !== before && forget(),
  )
  // The feed was refreshed: her circle may have moved with it. Not again for the same Books within the fresh window
  // (Home's first load refreshes the feed while the answer for her lists is on its way or has just come).
  watch(
    () => feed.takenAt,
    (now) => now && wanted && void load({ ifStale: true }),
  )
  // Back online.
  watch(online, (now) => now && wanted && void load())

  return { reading, want, load, forget, dropMember }
})

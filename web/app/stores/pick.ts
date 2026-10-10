import { defineStore } from 'pinia'
import { chooseAddStatus } from '~/data/library'
import type { LibraryErrorCode } from '~/data/library'
import {
  acceptAction,
  addCandidate,
  canPick,
  declineRound,
  firstRound,
  removeCandidate,
  toggleCandidate,
  winnerOf,
  type PickCandidate,
  type PickRound,
  type PickVariant,
} from '~/data/pick'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'

/**
 * Pick my next book (issue #259, PROTOTYPE, behind `?pick=1` / LIBELLUS_PICKER=1): the picker's
 * view state. The rules are data/pick.ts; this holds the chosen candidates, the round on screen
 * and its phase, and runs Accept through the app's own actions. Nothing is written before Accept,
 * and nothing is kept: a reload starts afresh.
 *
 * Phases: `choosing` (the candidates page, /pick) → `dealing` (the animation over the page, the
 * winner already drawn) → `shown` (the winner's Book page with the Accept / Decline bar) →
 * Decline: `dealing` again over the rest (`shown` straight away when one is left), `empty` when
 * none is; Accept: `accepting` → `accepted` (or `shown` with the error).
 */
export type PickPhase = 'choosing' | 'dealing' | 'shown' | 'empty' | 'accepting' | 'accepted'

export const usePickStore = defineStore('pick', () => {
  const library = useLibraryStore()

  /** The prototype is switched on for this tab (`?pick=1`, kept for the session) or the build (LIBELLUS_PICKER=1). */
  const enabled = ref(false)
  /** Which animation deals (A deck, B stack, C wheel): `?variant=a|b|c` or the chooser. */
  const variant = ref<PickVariant>('deck')
  /** `?deal=2d`: the Libellus-only fallback even in a build with Regal (to compare). */
  const force2d = ref(false)

  // ------------------------------------------------------------- candidates

  const selection = ref<PickCandidate[]>([])
  /** The last add was refused: the list is full. */
  const full = ref(false)
  const ready = computed(() => canPick(selection.value))

  function toggle(candidate: PickCandidate) {
    const change = toggleCandidate(selection.value, candidate)
    selection.value = change.candidates
    full.value = change.refused === 'full'
  }
  function add(candidate: PickCandidate) {
    const change = addCandidate(selection.value, candidate)
    selection.value = change.candidates
    full.value = change.refused === 'full'
  }
  function remove(key: string) {
    selection.value = removeCandidate(selection.value, key)
    full.value = false
  }
  const selected = (key: string) => selection.value.some((c) => c.key === key)

  // ------------------------------------------------------------------ rounds

  const round = shallowRef<PickRound | null>(null)
  const phase = ref<PickPhase>('choosing')
  /** The Book picked last, across picks: a new pick over the same Books does not open with it. */
  let previous: string | null = null
  /** Grows with every deal: the animation's key, so a new round mounts a new one. */
  const deal = ref(0)

  const winner = computed(() => (round.value ? winnerOf(round.value) : null))

  /** Pick: the winner is drawn now, before the animation shows it. */
  function start() {
    if (!ready.value) return
    round.value = firstRound(selection.value, previous)
    previous = winner.value!.key
    acceptError.value = null
    deal.value++
    phase.value = 'dealing'
  }

  /** The Book page the round's result is shown on (the bar is there, and only there). */
  const pagePath = ref<string | null>(null)

  /** The animation landed on the winner (or was skipped): its Book page (`path`) shows it. */
  function dealt(path: string) {
    if (phase.value !== 'dealing') return
    pagePath.value = path
    phase.value = 'shown'
  }

  /** Not this one: it leaves the running, the rest are dealt again (one left: shown at once). */
  function decline() {
    if (!round.value || phase.value !== 'shown') return
    const next = declineRound(round.value)
    acceptError.value = null
    if (!next) {
      phase.value = 'empty'
      return
    }
    round.value = next
    previous = winner.value!.key
    deal.value++
    if (next.alone) {
      // The last one: no draw, no animation; its page is shown as it is (Bar.vue goes there).
      pagePath.value = `/book/${winner.value!.key}`
      phase.value = 'shown'
    } else phase.value = 'dealing'
  }

  /** Leaves the pick (Back, Escape, Done): nothing was written, the chosen Books stay chosen. */
  function leave() {
    round.value = null
    pagePath.value = null
    phase.value = 'choosing'
    acceptError.value = null
  }

  /** The end state's "Choose again": back to an empty list. */
  function chooseAgain() {
    leave()
    selection.value = []
    full.value = false
  }

  // ------------------------------------------------------------------ Accept

  const acceptError = ref<LibraryErrorCode | null>(null)
  /** A search result's Accept waits for the Add sheet (the app's add flow, Currently reading chosen). */
  const addingKey = ref<string | null>(null)

  /**
   * Start reading. An entry on Want to read: the Start reading action (`start_reading`, today) in
   * one tap, as the Start sheet's button does it. A search result: the Add sheet, opened on
   * Currently reading, so the Book is added the one way the app adds Books.
   */
  async function accept() {
    const shown = winner.value
    const repo = library.library()
    if (!shown || !repo || phase.value !== 'shown') return
    const action = acceptAction(shown)
    acceptError.value = null
    if (action.kind === 'add') {
      addingKey.value = shown.key
      library.openAdd(action.book)
      chooseAddStatus(library.addDraft, action.status, isoDay())
      return
    }
    phase.value = 'accepting'
    const result = await repo.startReading(action.entryId, isoDay())
    if (result.error) {
      acceptError.value = result.error
      phase.value = 'shown'
      return
    }
    library.entryChanged(result.data)
    phase.value = 'accepted'
  }

  // The Add sheet went away: added (her Library has the Book now) or cancelled (the round goes on).
  watch(
    () => library.adding,
    (adding) => {
      const key = addingKey.value
      if (adding || !key) return
      addingKey.value = null
      if (library.entryByKey.get(key)) phase.value = 'accepted'
    },
  )

  return {
    enabled,
    variant,
    force2d,
    selection,
    full,
    ready,
    toggle,
    add,
    remove,
    selected,
    round,
    phase,
    deal,
    pagePath,
    winner,
    start,
    dealt,
    decline,
    leave,
    chooseAgain,
    acceptError,
    accept,
  }
})

import { defineStore } from 'pinia'
import type { EntryStatus } from '~/data/library'
import {
  newLibraryViews,
  readLibraryViews,
  saveLibraryViews,
  withoutFilter,
  withoutFilters,
  type ActiveFilter,
  type GenreLookup,
  type LibraryViews,
  type ListView,
  type Sort,
} from '~/data/libraryView'
import { useSessionStore } from '~/stores/session'

/**
 * How the member looks at her Library (issue #169): the filters and the sort of each
 * Status list (data/libraryView.ts). The last choice is remembered per member on this
 * device and read back when the store is set up, before the first frame, so a Library
 * that opens filtered is filtered from its first paint (no shift). A list view is
 * replaced as a whole on every change, so a screen can hold the one it has shown
 * (`useSettled`) and the sheets can work on a copy.
 */
export const useLibraryViewStore = defineStore('libraryView', () => {
  const session = useSessionStore()

  const views = reactive<LibraryViews>(newLibraryViews())
  /** The member the views belong to; nothing is saved without one. */
  let owner: string | null = null

  /**
   * The genre filter's seam (issue #168): how a Book's genres are looked up. The genres store
   * (stores/genres.ts) provides it as soon as it holds some (the device keeps them), and takes
   * it back on sign-out. While nothing provides one, the filter stays out of sight: no facet in
   * the sheet, no chip, and a genre filter that was set filters nothing.
   */
  const genres = shallowRef<GenreLookup | null>(null)
  function provideGenres(lookup: GenreLookup | null) {
    genres.value = lookup
  }

  /** The list the Library should open on, set by a screen that sends her to it (`showGenre`) and taken by the Library. */
  const focus = ref<EntryStatus | null>(null)

  /**
   * Looks at one genre in a list (the Profile's figures, #168): that list with every other
   * filter off (its sort stays), the genre set, and the year it was read in when there is one.
   * The Library opens on it.
   */
  function showGenre(status: EntryStatus, genre: string, year: string | null = null) {
    set(status, { ...withoutFilters(views[status]), genres: [genre], years: year ? [year] : [] })
    focus.value = status
  }

  function restore() {
    const member = session.member?.id ?? null
    owner = member
    const saved = import.meta.client && member ? readLibraryViews(window.localStorage, member) : newLibraryViews()
    Object.assign(views, saved)
  }

  function save() {
    if (import.meta.client && owner) saveLibraryViews(window.localStorage, owner, { ...views })
  }

  function set(status: EntryStatus, view: ListView) {
    views[status] = view
    save()
  }

  function setSort(status: EntryStatus, sort: Sort) {
    set(status, { ...views[status], sort })
  }

  function remove(status: EntryStatus, filter: ActiveFilter) {
    set(status, withoutFilter(views[status], filter))
  }

  function clear(status: EntryStatus) {
    set(status, withoutFilters(views[status]))
  }

  // Another member, or nobody: her own choice, as this device remembers it.
  watch(
    () => session.member?.id,
    (now, before) => now !== before && restore(),
  )
  restore()

  return { views, genres, focus, provideGenres, showGenre, set, setSort, remove, clear, restore }
})

/**
 * The contract between the playground shell and a design direction.
 *
 * A direction is one folder `directions/<key>/` whose `index.ts` default-exports
 * a `Direction`. The shell finds it by glob (`registry.ts`), so adding a
 * direction never touches a shared file. See README.md.
 */
import type { Component, ComputedRef, InjectionKey } from 'vue'
import { computed, h, inject, provide } from 'vue'
import type { Sample } from './data'
import { sample } from './data'

// ---------------------------------------------------------------------------
// Screens: the fixed list every direction draws
// ---------------------------------------------------------------------------

export const screenGroups = [
  {
    key: 'start',
    title: 'Start',
    screens: [{ key: 'sign-in', title: 'Sign in', state: 'email, invite-only' }],
  },
  {
    key: 'home',
    title: 'Home',
    screens: [
      { key: 'home', title: 'Home', state: 'reading, up next, read in 2026' },
      { key: 'home-empty', title: 'Home', state: 'empty Library' },
    ],
  },
  {
    key: 'search',
    title: 'Search',
    screens: [
      { key: 'search-typing', title: 'Search', state: 'typing, OpenLibrary still loading' },
      { key: 'search-results', title: 'Search', state: 'results from three sources' },
      { key: 'search-empty', title: 'Search', state: 'no results, add manually' },
      { key: 'manual-book', title: 'Manual book', state: 'form + placeholder cover' },
    ],
  },
  {
    key: 'book',
    title: 'Book',
    screens: [
      { key: 'book-new', title: 'Book', state: 'not in Library' },
      { key: 'add-sheet', title: 'Add sheet', state: 'status choice with dates' },
      { key: 'book-reading', title: 'Book', state: 'currently reading' },
      { key: 'finish-sheet', title: 'Finish sheet', state: 'rating mid-drag, review' },
      { key: 'book-finished', title: 'Book', state: 'finished, re-read, history' },
    ],
  },
  {
    key: 'library',
    title: 'Library',
    screens: [
      { key: 'library-want', title: 'Library', state: 'Want to read' },
      { key: 'library-reading', title: 'Library', state: 'Currently reading' },
      { key: 'library-finished', title: 'Library', state: 'Finished, Not finished filter' },
    ],
  },
  {
    key: 'collections',
    title: 'Collections',
    screens: [
      { key: 'collections', title: 'Collections', state: 'list with cover mosaics' },
      { key: 'collection', title: 'Collection', state: 'Sci-fi' },
    ],
  },
] as const

export type ScreenGroupKey = (typeof screenGroups)[number]['key']
export type ScreenKey = (typeof screenGroups)[number]['screens'][number]['key']

export interface ScreenInfo {
  key: ScreenKey
  title: string
  state: string
  group: ScreenGroupKey
  groupTitle: string
}

/** Every screen in display order, with its group. */
export const screens: ScreenInfo[] = screenGroups.flatMap((group) =>
  group.screens.map((screen) => ({ ...screen, group: group.key, groupTitle: group.title })),
)

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

export interface ToggleOption {
  value: string
  label: string
}

/** A live switch in the header, e.g. palette or corner style. */
export interface Toggle {
  /** Lower-case, no dots: ends up in the URL (`?a.palette=dusk`) and as `data-<key>` on the frame. */
  key: string
  label: string
  options: ToggleOption[]
  /** One of `options[].value`. */
  default: string
}

export interface Direction {
  /** Same as the folder name: 'a' | 'b' | 'c' | 'd' | 'ref'. */
  key: string
  /** Short name, e.g. 'Books', 'Editorial'. */
  title: string
  /** One paragraph: the idea, shown above the gallery. */
  summary: string
  toggles?: Toggle[]
  /** Missing keys render a "not built" placeholder. */
  screens: Partial<Record<ScreenKey, Component>>
}

/** Typed identity helper for `directions/<key>/index.ts`. */
export function defineDirection(direction: Direction): Direction {
  return direction
}

/**
 * One component with fixed props, so a screen component can fill several
 * screen keys: `'library-want': withProps(Library, { status: 'want_to_read' })`.
 */
export function withProps(component: Component, props: Record<string, unknown>): Component {
  return () => h(component, props)
}

/** Fills in defaults for any toggle without a value. */
export function resolveToggles(direction: Direction, values: Record<string, string | undefined>) {
  const resolved: Record<string, string> = {}
  for (const toggle of direction.toggles ?? []) {
    const value = values[toggle.key]
    resolved[toggle.key] = toggle.options.some((o) => o.value === value) ? value! : toggle.default
  }
  return resolved
}

// ---------------------------------------------------------------------------
// What a screen sees: useProto()
// ---------------------------------------------------------------------------

export interface ProtoContext {
  /** The direction this frame renders. */
  direction: Direction
  /** The screen key of this frame. */
  screen: ScreenKey
  /** Current toggle values of this direction, `{ palette: 'dusk', corners: 'round' }`. */
  toggles: Record<string, string>
  /** The sample data (data.ts). */
  data: Sample
}

const protoKey: InjectionKey<ComputedRef<ProtoContext>> = Symbol('proto')

/** Called once per frame by `shell/Frame.vue`. Screens never call this. */
export function provideProto(source: () => Omit<ProtoContext, 'data'>) {
  provide(
    protoKey,
    computed(() => ({ ...source(), data: sample })),
  )
}

/**
 * Inside any screen or component of a direction:
 *
 * ```ts
 * const proto = useProto()
 * proto.value.toggles.palette   // 'dusk'
 * proto.value.data.reading      // LibraryEntry[]
 * ```
 *
 * Reactive: a toggle change in the header re-renders the frame.
 */
export function useProto(): ComputedRef<ProtoContext> {
  const context = inject(protoKey, null)
  if (!context) throw new Error('useProto() called outside a playground frame')
  return context
}

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry, ReadingSession } from '~/data/library'

/**
 * "Contains spoilers" in the two review sheets (social v2a), after Sentry LIBELLUS-2, LIBELLUS-3 and LIBELLUS-4:
 * `ReferenceError: spoilers is not defined` on every Book page, in the finish and edit-read sheets. Commit
 * 6425473a moved the flag out of the sheets into the stores (the switch writes `reading.reviewSpoilers` and
 * `history.draft.reviewSpoilers`) but left each sheet's `watch(open, …)` resetting a `spoilers` model that no
 * longer existed: opening either sheet threw.
 *
 * So the flag belongs to the store, not to a sheet, and no sheet may name a `spoilers` of its own again: the
 * first test reads every `.vue` source and refuses a bare `spoilers` its own setup does not declare (the
 * switch's `defineModel` in components/book/SpoilerSwitch.vue is the one that does). The rest drives the
 * store the edit sheet reads, as the sheet does.
 */

const app = fileURLToPath(new URL('../app', import.meta.url))

/** Every `.vue` under app/, by its path from `app/` (the templates and both script blocks as they are). */
function vueSources(dir = app, found: [string, string][] = []): [string, string][] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) vueSources(path, found)
    else if (entry.name.endsWith('.vue')) found.push([path.slice(app.length + 1), readFileSync(path, 'utf8')])
  }
  return found
}

/** A sheet's two script blocks joined: the setup's own declarations and everything the file names. */
function scriptOf(source: string): string {
  // Case-insensitive on purpose (CodeQL's js/bad-tag-filter): a `.vue` file's `<script>` is lower case here, but a
  // pattern that only matches `<script>` would silently skip a `<SCRIPT>` in one that is not.
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((block) => block[1] ?? '').join('\n')
}

/** The script without its comments: the prose around a name is not a use of it (the sources keep theirs). */
function codeOf(script: string): string {
  return script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** What the script declares itself: consts, lets, functions, imports' named bindings and macros' models. */
function declaredIn(script: string): Set<string> {
  const names = new Set<string>()
  for (const match of script.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]!)
  for (const match of script.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]/g)) {
    for (const part of (match[1] ?? '').replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^\*\s*/, '')
      if (name) names.add(name)
    }
  }
  return names
}

const sheets = vueSources().filter(([path]) => path.startsWith('components/book/'))
const sheet = (name: string) => vueSources().find(([path]) => path.endsWith(name))?.[1] ?? ''

describe('a sheet and its "Contains spoilers" flag', () => {
  it('names no `spoilers` of its own: the flag lives in the store it writes with', () => {
    const offenders: string[] = []
    for (const [path, source] of vueSources()) {
      const script = codeOf(scriptOf(source))
      const declared = declaredIn(script)
      for (const match of script.matchAll(/(?<![\w$.])spoilers(?![\w$])/g)) {
        if (!declared.has('spoilers')) offenders.push(`${path}: …${script.slice(Math.max(0, match.index - 40), match.index + 20).trim()}…`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('binds the switch to the flag its store keeps', () => {
    const edit = sheet('components/book/EditSessionSheet.vue')
    const finish = sheet('components/book/FinishSheet.vue')
    expect(edit).toContain('<BookSpoilerSwitch v-model="history.draft.reviewSpoilers"')
    expect(finish).toContain('<BookSpoilerSwitch v-model="reading.reviewSpoilers"')
    // The switch itself is the one place that still names the model it is given.
    expect(sheet('components/book/SpoilerSwitch.vue')).toContain("const spoilers = defineModel<boolean>({ required: true })")
    expect(sheets.length).toBeGreaterThan(0)
  })
})

const entry = { id: 'e1', title: 'Piranesi', authors: [], latestSession: null } as unknown as LibraryEntry
const read = (over: Partial<ReadingSession> = {}): ReadingSession =>
  ({
    id: 's1',
    startedOn: '2026-10-01',
    endedOn: '2026-10-05',
    outcome: 'finished',
    rating: 16,
    review: 'The twist is the house.',
    reviewSpoilers: true,
    abandonReason: null,
    ...over,
  }) as ReadingSession

vi.mock('~/stores/book', () => ({ useBookStore: () => reactive({}) }))
vi.mock('~/stores/collections', () => ({ useCollectionsStore: () => reactive({}) }))
vi.mock('~/stores/library', () => ({
  useLibraryStore: () => reactive({ readInYear: null, library: () => null, entryById: () => null, entryChanged: () => {} }),
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => reactive({ holds: () => false }) }))
// The history store also reads the stats, which asks the backend for its repository at setup: a build never runs it.
vi.mock('~/stores/stats', () => ({ useStatsStore: () => reactive({}) }))

/** The history store as Nuxt runs it, with the auto-imports it uses stood in for. */
async function historyStore() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  setActivePinia(createPinia())
  const { useHistoryStore } = await import('~/stores/history')
  return useHistoryStore()
}

describe('the edit-read sheet, opened', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the flag the read has, and opening it never throws', async () => {
    const history = await historyStore()
    history.openEdit(entry, read())
    expect(history.editing?.session.id).toBe('s1')
    expect(history.draft.reviewSpoilers).toBe(true)
    // A read without the flag, and one not finished (no review at all): the switch reads false.
    history.closeEdit()
    history.openEdit(entry, read({ reviewSpoilers: false }))
    expect(history.draft.reviewSpoilers).toBe(false)
    history.closeEdit()
    history.openEdit(entry, read({ outcome: 'abandoned', review: null, reviewSpoilers: false }))
    expect(history.draft.reviewSpoilers).toBe(false)
  })

  it('drops the flag when the review is emptied, so it is never sent alone', async () => {
    const history = await historyStore()
    history.openEdit(entry, read())
    expect(history.draft.reviewSpoilers).toBe(true)
    history.draft.review = '   '
    await nextTick()
    expect(history.draft.reviewSpoilers).toBe(false)
  })
})

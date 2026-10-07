// What's new (docs/OPERATIONS.md, "Releases"): the build reads the release's
// version from version.txt and its part of CHANGELOG.md (both written by
// release-please at the repository root) and embeds only that part
// (nuxt.config.ts, appConfig.release). Plain TypeScript, run by the Nuxt config
// at build time and by Vitest.
//
// A release's part of the changelog, as release-please writes it:
//
//   ## [1.9.0](https://github.com/…/compare/v1.8.0...v1.9.0) (2026-11-02)
//
//   ### ⚠ BREAKING CHANGES
//   * …
//
//   ### Features
//   * **reader:** highlights sync between devices ([#140](…)) ([1a2b3c4](…))
//
// Members read sentences, not commits: the scope, the links and any leftover
// `type:` prefix go, the first letter is raised. Only the sections a member
// cares about are kept (new things, fixes, speed, what changed); docs, tests,
// CI and chores are left out even when a changelog has them.

export type ReleaseSectionKind = 'breaking' | 'features' | 'fixes' | 'performance'

export interface ReleaseSection {
  kind: ReleaseSectionKind
  items: string[]
}

export interface ReleaseNotes {
  /** The release, `1.9.0`; empty when the build had no version.txt. */
  version: string
  /** Its date as the changelog has it (`2026-11-02`), or empty. */
  date: string
  /** In the order of `SECTION_ORDER`; only sections with items. */
  sections: ReleaseSection[]
}

/** Where a device keeps the last release it saw (composables/useWhatsNew.ts). */
export const WHATS_NEW_KEY = 'libellus:whatsNew'

const SECTION_ORDER: ReleaseSectionKind[] = ['breaking', 'features', 'performance', 'fixes']

/** release-please's section headings (ours, from release-please-config.json, and its defaults). */
function sectionKind(heading: string): ReleaseSectionKind | null {
  const h = heading.replace(/[^a-z ]/gi, '').trim().toLowerCase()
  if (h === 'breaking changes') return 'breaking'
  if (h === 'features') return 'features'
  if (h === 'fixes' || h === 'bug fixes') return 'fixes'
  if (h === 'performance' || h === 'performance improvements') return 'performance'
  return null
}

const SKIPPED_TYPE = /^(chore|test|tests|ci|build|docs|style|refactor)(\([^)]*\))?!?:/i
const HIDDEN_TYPE = /^(feat|fix|perf|revert)(\([^)]*\))?!?:\s*/i

/** One changelog bullet as a sentence a member reads; null when it is not for her. */
export function friendlyItem(raw: string): string | null {
  let text = raw.trim()
  // Trailing references: ([#140](…)), ([1a2b3c4](…)), (#140), closes #12.
  for (;;) {
    const next = text
      .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)(?:\s*,\s*\[[^\]]*\]\([^)]*\))*\s*\)\s*$/, '')
      .replace(/\s*\(#\d+\)\s*$/, '')
      .replace(/,?\s*(?:closes|fixes|refs)\s+\[?#\d+\]?(?:\([^)]*\))?(?:\s*,\s*\[?#\d+\]?(?:\([^)]*\))?)*\s*$/i, '')
    if (next === text) break
    text = next
  }
  // The scope, as release-please writes it: **reader:**
  text = text.replace(/^\*\*[^*]+:\*\*\s*/, '')
  if (SKIPPED_TYPE.test(text)) return null
  text = text.replace(HIDDEN_TYPE, '')
  // Any link left inside: keep its words.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').trim()
  if (!text) return null
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const VERSION_HEADING = /^##\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))(?:\s+\(([^)]*)\))?\s*$/

/**
 * The notes of `version` in a release-please changelog. Never throws: a version
 * missing from the changelog, or no changelog at all, gives no sections.
 */
export function releaseNotes(changelog: string, version: string): ReleaseNotes {
  const wanted = version.trim().replace(/^v/, '')
  const notes: ReleaseNotes = { version: wanted, date: '', sections: [] }
  if (!wanted) return notes

  const items = new Map<ReleaseSectionKind, string[]>()
  let inRelease = false
  let kind: ReleaseSectionKind | null = null
  for (const line of changelog.split(/\r?\n/)) {
    const heading = VERSION_HEADING.exec(line)
    if (heading) {
      if (inRelease) break
      const found = (heading[1] ?? heading[2] ?? '').replace(/^v/, '')
      if (found === wanted) {
        inRelease = true
        notes.date = heading[3]?.trim() ?? ''
      }
      continue
    }
    if (!inRelease) continue
    const section = /^###\s+(.+)$/.exec(line)
    if (section) {
      kind = sectionKind(section[1]!)
      continue
    }
    const bullet = /^[*-]\s+(.+)$/.exec(line)
    if (!bullet || !kind) continue
    const item = friendlyItem(bullet[1]!)
    if (!item) continue
    const list = items.get(kind) ?? []
    if (!list.includes(item)) list.push(item)
    items.set(kind, list)
  }

  notes.sections = SECTION_ORDER.filter((k) => items.has(k)).map((k) => ({ kind: k, items: items.get(k)! }))
  return notes
}

/** `1.9.0` → `1.9`: what the sheet's title names. */
export function minorVersion(version: string): string {
  const [major, minor] = version.split('.')
  return minor === undefined ? version : `${major}.${minor}`
}

/**
 * Whether this device should show the notes of the build's release by itself,
 * given the version it last saw (null: none yet). A device that never saw one is
 * new, or older than What's new: it starts counting here, quietly. A release
 * with nothing new to try (only fixes, only speed) does not interrupt either;
 * its notes are still on the Profile (Version · What's new).
 */
export function shouldShowNotes(seen: string | null, notes: ReleaseNotes): boolean {
  if (!notes.version || seen === null || seen === notes.version) return false
  return notes.sections.some((s) => s.kind === 'features' || s.kind === 'breaking')
}

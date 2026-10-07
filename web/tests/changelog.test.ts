import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { friendlyItem, minorVersion, releaseNotes, shouldShowNotes, type ReleaseNotes } from '@/utils/changelog'

// What release-please writes (release-please-config.json: Features, Fixes, Performance, Reverts).
const CHANGELOG = `# Changelog

## [1.9.0](https://github.com/fabkho/libellus/compare/v1.8.2...v1.9.0) (2026-11-02)


### ⚠ BREAKING CHANGES

* **reader:** highlights are kept per edition ([#140](https://github.com/fabkho/libellus/issues/140)) ([1a2b3c4](https://github.com/fabkho/libellus/commit/1a2b3c4))

### Features

* **reader:** highlights sync between devices ([#140](https://github.com/fabkho/libellus/issues/140)) ([1a2b3c4](https://github.com/fabkho/libellus/commit/1a2b3c4))
* the format choice is one row of icon segments ([bb0aade](https://github.com/fabkho/libellus/commit/bb0aade))
* **edition:** \`own edition\` keeps its [cover](https://example.com) ([9f8e7d6](https://github.com/fabkho/libellus/commit/9f8e7d6)), closes [#165](https://github.com/fabkho/libellus/issues/165)


### Fixes

* **sync:** a write queued offline is sent once (#93)
* **sync:** a write queued offline is sent once (#93)


### Performance

* the shelf opens without waiting for the covers ([abcdef0](https://github.com/fabkho/libellus/commit/abcdef0))


### Reverts

* "feat: a thing" ([0000000](https://github.com/fabkho/libellus/commit/0000000))


### Miscellaneous Chores

* bump the Supabase CLI ([1111111](https://github.com/fabkho/libellus/commit/1111111))

## [1.8.2](https://github.com/fabkho/libellus/compare/v1.8.1...v1.8.2) (2026-10-30)


### Fixes

* the cover of a manual book stays ([2222222](https://github.com/fabkho/libellus/commit/2222222))

## 1.0.0 (2026-10-07)

The first versioned release.
`

describe('release notes from the changelog', () => {
  it('reads one release, in sentences, without scopes, links or repeats', () => {
    const notes = releaseNotes(CHANGELOG, '1.9.0\n')
    expect(notes.version).toBe('1.9.0')
    expect(notes.date).toBe('2026-11-02')
    expect(notes.sections).toEqual([
      { kind: 'breaking', items: ['Highlights are kept per edition'] },
      {
        kind: 'features',
        items: [
          'Highlights sync between devices',
          'The format choice is one row of icon segments',
          'Own edition keeps its cover',
        ],
      },
      { kind: 'performance', items: ['The shelf opens without waiting for the covers'] },
      { kind: 'fixes', items: ['A write queued offline is sent once'] },
    ])
  })

  it('stops at the next release and accepts a v in the version', () => {
    expect(releaseNotes(CHANGELOG, 'v1.8.2').sections).toEqual([{ kind: 'fixes', items: ['The cover of a manual book stays'] }])
  })

  it('has no sections for a release without any, one not in the changelog, or no files at all', () => {
    expect(releaseNotes(CHANGELOG, '1.0.0')).toEqual({ version: '1.0.0', date: '2026-10-07', sections: [] })
    expect(releaseNotes(CHANGELOG, '2.0.0').sections).toEqual([])
    expect(releaseNotes('', '')).toEqual({ version: '', date: '', sections: [] })
  })

  it('reads the repository’s own CHANGELOG.md for its version.txt', () => {
    const root = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
    const notes = releaseNotes(root('CHANGELOG.md'), root('version.txt'))
    expect(notes.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(notes.date).not.toBe('')
  })

  it('leaves out commits that are not for members', () => {
    expect(friendlyItem('chore(deps): bump vite')).toBeNull()
    expect(friendlyItem('**ci:** test: split the shards')).toBeNull()
    expect(friendlyItem('fix(search): an ISBN with dashes is found')).toBe('An ISBN with dashes is found')
    expect(friendlyItem('([abc](https://x))')).toBeNull()
  })
})

describe('when What’s new shows by itself', () => {
  const notes = (sections: ReleaseNotes['sections']): ReleaseNotes => ({ version: '1.9.0', date: '', sections })
  const features = notes([{ kind: 'features', items: ['A'] }])

  it('after an update with something new', () => {
    expect(shouldShowNotes('1.8.2', features)).toBe(true)
    expect(shouldShowNotes('1.8.2', notes([{ kind: 'breaking', items: ['B'] }]))).toBe(true)
  })

  it('not twice, not on a new device, not for fixes alone', () => {
    expect(shouldShowNotes('1.9.0', features)).toBe(false)
    expect(shouldShowNotes(null, features)).toBe(false)
    expect(shouldShowNotes('1.8.2', notes([{ kind: 'fixes', items: ['C'] }, { kind: 'performance', items: ['D'] }]))).toBe(false)
    expect(shouldShowNotes('1.8.2', { version: '', date: '', sections: [{ kind: 'features', items: ['A'] }] })).toBe(false)
  })

  it('names the minor release', () => {
    expect(minorVersion('1.9.0')).toBe('1.9')
    expect(minorVersion('2')).toBe('2')
  })
})

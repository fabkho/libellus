import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isPublicPath } from '@/utils/publicPath'

/**
 * The lamp dot of the shell (components/shell/Header.vue, part of the entry) asks a small store for the invitations waiting for her
 * (stores/buddyInvites.ts); the big buddy read store may not be reached from the entry (tests/buddy-read-entry.test.ts). Buddy reads are for every member
 * (no switch, no build flag), so on the sources: the shell takes the small store, the small store loads the repository only by a dynamic import and asks
 * for a signed-in member only, and the link page and the routes carry no flag or switch. Plain reads of the files, no comment stripping.
 */
const app = fileURLToPath(new URL('../app/', import.meta.url))
const read = (path: string) => readFileSync(`${app}${path}`, 'utf8')

describe('the invitations in the shell', () => {
  it('are the small store’s: the header imports it, never the big one', () => {
    const header = read('components/shell/Header.vue')
    expect(header).toMatch(/from '~\/stores\/buddyInvites'/)
    expect(header).not.toMatch(/stores\/buddyRead['"]/)
  })

  it('load the repository by a dynamic import only, and ask for a signed-in member only', () => {
    const store = read('stores/buddyInvites.ts')
    expect(store).not.toMatch(/^\s*import\s+(?!type)[^'"]*from\s+['"]~\/data\/buddyReads['"]/m)
    expect(store).toContain("import('~/data/buddyReads')")
    expect(store).toContain('const active = computed(() => !!me.value)')
    expect(store).toContain('if (!active.value')
  })

  it('hold her reads too: Home and the Book page need no big store', () => {
    const store = read('stores/buddyInvites.ts')
    expect(store).toContain('reads.value = answer.data.reads')
    expect(store).toContain('return { invitations, reads,')
  })
})

describe('buddy reads are for everyone: no flag, no switch', () => {
  it('has no switch or flag anywhere in the screens, the router or the sign-in route', () => {
    for (const file of ['pages/t/[token].vue', 'pages/together/[id]/index.vue', 'pages/together/[id]/[section].vue', 'middleware/auth.global.ts', 'router.options.ts', 'utils/signedOutRoute.ts', 'pages/friends/index.vue', 'components/profile/Account.vue']) {
      const source = read(file)
      expect(source, file).not.toMatch(/buddyReadsSwitch|useBuddyReadsOn|useBuddyReadsFlag|public\.buddyReads|middleware: 'buddy-reads'/)
    }
  })

  it('keeps the link kept through the sign-in, and the link and the rooms behind it: they are not public addresses', () => {
    expect(read('middleware/auth.global.ts')).toContain('buddyReadToOpen(path, peekBuddyRead(window.localStorage)')
    expect(isPublicPath(`/t/${'A'.repeat(22)}`)).toBe(false)
    expect(isPublicPath('/together/abc')).toBe(false)
  })
})

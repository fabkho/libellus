import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isPublicPath } from '@/utils/publicPath'

/**
 * The lamp dot of the shell (components/shell/Header.vue, part of the entry) asks a small store for the invitations waiting for her
 * (stores/buddyInvites.ts); the big buddy read store may not be reached from the entry (tests/buddy-read-entry.test.ts). On the sources: the shell takes
 * the small one, the small one loads the repository only by a dynamic import, and every entry point of W3 asks the flag and the switch first.
 */
const app = fileURLToPath(new URL('../app/', import.meta.url))
const read = (path: string) => readFileSync(`${app}${path}`, 'utf8')
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the invitations in the shell', () => {
  it('are the small store’s: the header imports it, never the big one', () => {
    const header = code('components/shell/Header.vue')
    expect(header).toMatch(/from '~\/stores\/buddyInvites'/)
    expect(header).not.toMatch(/stores\/buddyRead['"]/)
  })

  it('load the repository by a dynamic import only, and ask nothing unless the build has buddy reads and the switch is on', () => {
    const store = code('stores/buddyInvites.ts')
    expect(store).not.toMatch(/^\s*import\s+(?!type)[^'"]*from\s+['"]~\/data\/buddyReads['"]/m)
    expect(store).toMatch(/import\('~\/data\/buddyReads'\)/)
    expect(store).toMatch(/switchStore\.available && switchStore\.enabled/)
    expect(store).toMatch(/if \(!active\.value/)
  })
})

describe('every entry point of W3 asks first', () => {
  it('draws the Friends row only behind the flag and the switch, as a lazy component', () => {
    expect(code('pages/friends/index.vue')).toMatch(/<LazyTogetherInvitations v-if="buddyReadsOn" \/>/)
    expect(code('components/together/Invitations.vue')).toMatch(/v-if="allowed/)
  })

  it('draws every sheet only while buddy reads are on', () => {
    for (const sheet of ['SetupSheet', 'InviteSheet', 'MembersSheet']) expect(code(`components/together/${sheet}.vue`)).toMatch(/<UiSheet\s+v-if="allowed"/)
  })

  it('keeps the link page behind the build’s flag (the app’s not-found otherwise), asks her switch itself, and keeps the router and the sign-in route in step', () => {
    const page = code('pages/t/[token].vue')
    expect(page).toMatch(/validate: \(\) => useBuddyReadsFlag\(\)/)
    // The switch-off question is the page's own: the named middleware would lead her Home instead of asking.
    expect(page).not.toMatch(/middleware: 'buddy-reads'/)
    expect(page).toMatch(/switchStore\.enabled/)
    expect(code('middleware/auth.global.ts')).toMatch(/buddyReads \? buddyReadToOpen/)
    expect(code('router.options.ts')).toMatch(/buddyReads/)
    // The link needs the sign-in: it is not a public address.
    expect(isPublicPath(`/t/${'A'.repeat(22)}`)).toBe(false)
    expect(isPublicPath('/together/abc')).toBe(false)
  })
})

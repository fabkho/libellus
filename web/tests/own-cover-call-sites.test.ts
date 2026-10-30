import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEMBER_CACHES } from '@/data/localData'

/**
 * PR 5 of docs/plans/owned-covers.md (§5, §9): every cover of a Book goes through `coverImage` / `coverAt`
 * (utils/coverRef.ts), so the one switch (`NUXT_PUBLIC_OWN_COVERS`) decides every cover in the app; and the service worker
 * keeps our stored copies in a cache of their own, which signing out empties.
 *
 * A screen that binds a cover by hand (`:src="coverSrc(book.coverUrl, …)"`) shows the source while every other screen
 * shows our copy. This test finds those, so the next Book cover added to a screen is switched too. Pure: the app's own
 * files, no stack, no browser.
 */

const APP = fileURLToPath(new URL('../app', import.meta.url))
const NUXT = fileURLToPath(new URL('../nuxt.config.ts', import.meta.url))

/**
 * The covers that are not a Book's: the sign-in wall's recorded public cover addresses (components/auth/wall.ts: a
 * fixture, no Book row, no key). Everything else that shows a cover of a Book names it through `coverImage`.
 */
const NOT_A_BOOK = new Set(['components/auth/Frame.vue'])

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) sources(path, out)
    else if (name.endsWith('.vue') || name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** The `<UiCover …>` and `<UiBookLine …>` tags of a file, however many lines they take. */
function coverTags(text: string): string[] {
  return [...text.matchAll(/<(?:UiCover|UiBookLine)\b[^>]*>/g)].map((match) => match[0])
}

describe('every cover of a Book goes through coverImage', () => {
  const files = sources(APP).map((path) => ({ path: path.slice(APP.length + 1), text: readFileSync(path, 'utf8') }))

  it('binds no cover by hand: a UiCover of a Book names it with `v-bind="coverImage(…)"`', () => {
    const handmade: string[] = []
    for (const file of files) {
      if (NOT_A_BOOK.has(file.path)) continue
      for (const tag of coverTags(file.text)) {
        if (/:src="cover(Src|For)\(/.test(tag)) handmade.push(`${file.path}: ${tag.slice(0, 60)}`)
        // A source address bound by hand (a Book's own `coverUrl`) is the other way round the helper.
        if (/:src="[^"]*coverUrl/.test(tag) && !/v-bind="coverImage\(/.test(tag)) handmade.push(`${file.path}: ${tag.slice(0, 60)}`)
      }
    }
    expect(handmade).toEqual([])
  })

  it('hands every call the build\'s hosts (the switch\'s one reading, useCoverHosts)', () => {
    const calling = files.filter((file) => file.path.endsWith('.vue') && file.text.includes('coverImage('))
    // The screens the plan names: the Library and its rows, the Book page, the sheets, the feed, the reel's list.
    expect(calling.length).toBeGreaterThan(25)
    for (const file of calling) expect(file.text, file.path).toContain('useCoverHosts()')
  })
})

describe('the service worker keeps our copies, and signing out empties them', () => {
  it('has a cache-first rule for same-origin /c/ in the app\'s runtimeCaching', () => {
    const config = readFileSync(NUXT, 'utf8')
    // Same origin, /c/ only, never a document; its own cache; a 200 only (a missing object is a 404 no-store); a year,
    // a size cap, quota-safe — one entry per stored copy a screen asked for.
    expect(config).toMatch(/url\.origin === self\.location\.origin && url\.pathname\.startsWith\('\/c\/'\) && request\.destination !== 'document'/)
    expect(config).toMatch(/cacheName: 'libellus-own-covers'/)
    expect(config).toMatch(/cacheableResponse: \{ statuses: \[200\] \}/)
    expect(config).toMatch(/maxEntries: 1500, maxAgeSeconds: 60 \* 60 \* 24 \* 365, purgeOnQuotaError: true/)
  })

  it('names that cache among the member\'s, which `forgetMemberData` deletes', () => {
    expect(MEMBER_CACHES).toContain('libellus-own-covers')
  })
})

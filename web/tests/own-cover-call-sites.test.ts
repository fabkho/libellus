import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEMBER_CACHES } from '@/data/localData'
import { coverChain, coverSrc, coverSizes, coverSrcset, type CoverSize } from '@/utils/cover'
import { coverImage, coverPrefetch } from '@/utils/coverRef'
import { OWN_COVER_CACHE_CONTROL } from '@/utils/ownCoverPath'

/**
 * PR 5 of docs/plans/owned-covers.md (§5, §9): every cover of a Book goes through `coverImage` / `coverAt`
 * (utils/coverRef.ts), so the one switch (`NUXT_PUBLIC_OWN_COVERS`) decides every cover in the app; every screen keeps the
 * addresses it asked before (`/cover` only where it asked through it); and the service worker keeps our stored copies in a
 * cache of their own, which signing out empties.
 *
 * A screen that binds a cover by hand (`:src="coverSrc(book.coverUrl, …)"`) shows the source while every other screen shows
 * our copy, and one that passes the whole `useCoverHosts()` where it used to ask the source adds a `/cover` request that was
 * never there. This test finds both, in templates, script blocks and `.ts`, so the next Book cover added is drawn and asked
 * for like its neighbours. Pure: the app's own files, no stack, no browser.
 */

const APP = fileURLToPath(new URL('../app', import.meta.url))
const NUXT = fileURLToPath(new URL('../nuxt.config.ts', import.meta.url))
const OWN_FUNCTION = fileURLToPath(new URL('../functions/c/[[path]].js', import.meta.url))

/**
 * The covers that are not a Book's: the sign-in wall's recorded public cover addresses (components/auth/wall.ts: a fixture,
 * no Book row, no key).
 */
const NOT_A_BOOK = new Set(['components/auth/Frame.vue'])

/**
 * Where the size-by-hand helpers stay, and why. Everything else names a Book's cover with `coverImage` / `coverAt`, which
 * take the addresses from a Book; these have only an address in their hands (or are the helpers themselves).
 */
const HAND_BOUND: Record<string, string> = {
  'utils/cover.ts': 'the source chain itself (coverSrc, coverSrcset, coverChain, artworkOf)',
  'utils/coverSize.ts': 'coverFor, the address of a cover at any size, for what has no Book (an edition, an import)',
  'utils/coverRef.ts': 'the one decision: our copy, else the source chain (coverChain, coverSrc, coverSrcset) and coverFor',
  'app.config.ts': "UiCover's default sources, for a cover given as an address",
  'composables/useBookFlight.ts': 'the hero image of a cover already on screen: an element, no Book',
  'components/auth/Frame.vue': "the sign-in wall's recorded public covers: a fixture, no Book row",
}

/**
 * The libraries that take the hosts as an argument instead of reading the switch: the helper itself, the shelf's document and
 * a section's prefetch (both built where no component is, so the caller passes `covers` / `hosts`).
 */
const FOUNDATION = new Set(['utils/coverRef.ts', 'data/memberShelf.ts', 'utils/enrich.ts', 'data/bothReadReel.ts'])

const SOURCE_API = /\bcover(Src|For|Srcset|Chain)\(/g
/** A file's own hosts: the whole `useCoverHosts()`, the direct spread, and the name it is kept under. */
const OWN = /const (\w+) = useCoverHosts\(\)/
const DIRECT = /const (\w+) = \{\s*\.\.\.useCoverHosts\(\),\s*proxy:\s*false\s*\}/
const SIZES: CoverSize[] = ['xs', 'sm', 'md', 'lg', 'xl']
const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c/9780593983768.d.jpg/600x900bb.jpg'
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'

/** The lines of a file that are code: a doc comment names these helpers without calling them. */
const codeLines = (text: string) =>
  text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('<!--')
    })
    .join('\n')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) sources(path, out)
    else if (name.endsWith('.vue') || name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** The `<UiCover …>` and `<UiBookLine …>` tags of a file, however many lines they take. */
const coverTags = (text: string) => [...text.matchAll(/<(?:UiCover|UiBookLine)\b[^>]*>/g)].map((match) => match[0])

/** A file, as the test reads it. */
type File = { path: string; text: string; proxy: boolean | null; hosts: string | null }

/**
 * How a file hands its hosts to `coverImage`: the whole `useCoverHosts()` (`proxy: true`: our copies and `/cover`), the direct
 * spread (`proxy: false`: our copies only, the source as before), or neither; and the name it keeps them under.
 */
function hostsOf(text: string): { proxy: boolean | null; hosts: string | null } {
  const direct = DIRECT.exec(text)
  if (direct) return { proxy: false, hosts: direct[1]! }
  const own = OWN.exec(text)
  return own ? { proxy: true, hosts: own[1]! } : { proxy: null, hosts: null }
}

/**
 * Every `coverImage(<book>, <size>, <hosts>)` and `coverPrefetch(<book>, <size>, <hosts>, <dpr>)` of a file: which helper, the
 * size it names, the hosts it hands on, and — for a prefetch — the pixel ratio it sizes by (2 where the file reads the
 * device's, the retina case the candidate matters in).
 */
function calls(text: string): { kind: 'coverImage' | 'coverPrefetch'; size: CoverSize | null; hosts: string; dpr: number }[] {
  const found = [...text.matchAll(/cover(Image|Prefetch)\(\s*([^,()]*(?:\([^()]*\))?[^,()]*),\s*([^,]*),\s*([A-Za-z_$][\w$]*)(?:,\s*([^,)]+))?\s*\)/g)]
  return found.map(([, kind, , size, hosts, dpr]) => {
    const named = size!.trim().replaceAll("'", '')
    const ratio = (dpr ?? '').trim()
    return {
      kind: kind === 'Prefetch' ? ('coverPrefetch' as const) : ('coverImage' as const),
      size: (SIZES as string[]).includes(named) ? (named as CoverSize) : null,
      hosts: hosts!,
      dpr: /^\d+$/.test(ratio) ? Number(ratio) : /devicePixelRatio/.test(ratio) ? 2 : 1,
    }
  })
}

/** The addresses of a `srcset`, without their widths. */
const candidates = (srcset: string | null) => (srcset ? srcset.split(', ').map((candidate) => candidate.split(' ')[0]!) : [])

const files: File[] = sources(APP).map((path) => {
  const text = readFileSync(path, 'utf8')
  return { path: path.slice(APP.length + 1), text, ...hostsOf(text) }
})

/** The screens that draw a Book's cover: every `.vue` that names one, plus the libraries that take the hosts in. */
const HELPER = /cover(Image|At|Prefetch)\(/
const screens = files.filter((file) => file.path.endsWith('.vue') && HELPER.test(codeLines(file.text)))

describe('every cover of a Book goes through coverImage', () => {
  it('binds no cover by hand: a UiCover of a Book names it with `v-bind="coverImage(…)"`', () => {
    const handmade: string[] = []
    for (const file of files) {
      if (NOT_A_BOOK.has(file.path)) continue
      for (const tag of coverTags(file.text)) {
        if (/:src="cover(Src|For)\(/.test(tag)) handmade.push(`${file.path}: ${tag.slice(0, 60)}`)
        // A source address bound by hand (a Book's own `coverUrl`) is the other way round the helper.
        if (/:src="[^"]*coverUrl/.test(tag) && !/v-bind="coverImage\(/.test(tag)) handmade.push(`${file.path}: ${tag.slice(0, 60)}`)
        // A cover's image given as a string field (the reader's old `book.cover`) is the same bypass, one prop removed.
        if (/:src="book\.cover"/.test(tag)) handmade.push(`${file.path}: ${tag.slice(0, 60)}`)
      }
    }
    expect(handmade).toEqual([])
  })

  it('asks for an address by hand only where there is no Book behind it, and says why there', () => {
    const byHand = files.filter((file) => codeLines(file.text).match(SOURCE_API)).map((file) => file.path)
    expect(byHand.sort()).toEqual(Object.keys(HAND_BOUND).sort())
  })

  it('hands every screen the build\'s hosts, and names a Book\'s cover nowhere else but the helper and its two libraries', () => {
    expect(screens.length).toBeGreaterThan(25)
    for (const file of screens) expect(file.proxy, `${file.path} has no hosts declaration`).not.toBeNull()
    const libraries = files.filter((file) => !file.path.endsWith('.vue') && HELPER.test(codeLines(file.text))).map((file) => file.path)
    expect(libraries.sort()).toEqual([...FOUNDATION].sort())
  })

  // The switch off is today: before PR 5 only the Library's row and the reel asked through `/cover`; every other screen asked
  // the cover host itself, and it must still. One entry per screen, so a changed call site is a changed test.
  it.each(screens.map((file) => [file.path, file] as const))(
    'names the same address as before the switch existed (%s)',
    (path, file) => {
      const asked = calls(file.text)
      expect(asked.length, `${path} has a coverImage call this test cannot read`).toBeGreaterThan(0)
      for (const call of asked) {
        // The hosts the call is handed are the file's own, so the file's one declaration decides for every call on it.
        expect(call.hosts, path).toBe(file.hosts)
        for (const size of call.size ? [call.size] : SIZES) {
          for (const url of [APPLE, OL]) {
            const hosts = { proxy: file.proxy!, own: false }
            const book = { coverUrl: url }
            // `coverImage` at the switch off is `ui.cover.sources` of today: the same src, srcset, sizes and fallbacks.
            const src = coverSrc(url, size, file.proxy!)
            const today = { src, srcset: coverSrcset(src, size), sizes: coverSizes(size), fallbacks: coverChain(src, size).filter((next) => next !== src) }
            expect({ path, size, image: coverImage(book, size, hosts) }).toEqual({ path, size, image: today })
            if (call.kind === 'coverPrefetch') {
              // A preload or a prefetch asks for an address the cover itself will load: its `src`, or one of its `srcset`
              // candidates for this screen (never a third file), and with no `srcset` exactly today's address.
              const picked = coverPrefetch(book, size, hosts, call.dpr)
              expect([today.src, ...candidates(today.srcset)], `${path} prefetches another file than the cover loads`).toContain(picked)
              if (!today.srcset) expect(picked, path).toBe(today.src)
            }
          }
        }
      }
    },
  )

  it('keeps the cover proxy on the two screens that asked through it, and nowhere else', () => {
    const throughProxy = screens.filter((file) => file.proxy === true).map((file) => file.path)
    expect(throughProxy.sort()).toEqual(['components/friends/BothRead.vue', 'components/library/EntryRow.vue'])
  })
})

describe('the service worker keeps our copies, and signing out empties them', () => {
  it('has a cache-first rule for same-origin /c/ in the app\'s runtimeCaching', () => {
    const config = readFileSync(NUXT, 'utf8')
    // Same origin, /c/ only, never a document; its own cache; a 200 that says it is a stored copy (`OWN_COVER_CACHE_CONTROL`,
    // which the Function sends: without the header a deployment without the Function answers the app shell, a 200, and it
    // would be kept for a year); a year, a size cap, quota-safe — one entry per stored copy a screen asked for.
    expect(config).toMatch(/url\.origin === self\.location\.origin && url\.pathname\.startsWith\('\/c\/'\) && request\.destination !== 'document'/)
    expect(config).toMatch(/cacheName: 'libellus-own-covers'/)
    expect(config).toContain(`cacheableResponse: { statuses: [200], headers: { 'Cache-Control': '${OWN_COVER_CACHE_CONTROL}' } }`)
    expect(config).toMatch(/maxEntries: 1500, maxAgeSeconds: 60 \* 60 \* 24 \* 365, purgeOnQuotaError: true/)
  })

  it('sends exactly what the rule keeps, from the one constant both read', () => {
    expect(OWN_COVER_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
    expect(readFileSync(OWN_FUNCTION, 'utf8')).toContain("'Cache-Control': OWN_COVER_CACHE_CONTROL")
  })

  it('names that cache among the member\'s, which `forgetMemberData` deletes', () => {
    expect(MEMBER_CACHES).toContain('libellus-own-covers')
  })
})

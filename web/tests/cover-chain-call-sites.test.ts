import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Book cover chain is a domain rule, and it lives in one place: data/bookCovers.ts, entered through
 * composables/useBookCovers.ts in the app. A store that assembles the sources again (`probe:` beside
 * `lookupAppleIsbn:`) is a fourth source, or a time budget, away from choosing a different Cover than the next
 * caller: a Book added from a search result would peel off from the Add sheet's, silently.
 *
 * This test reads the sources. tests/own-cover-call-sites.test.ts guards the other half of the rule (how a cover
 * is shown and asked for); this one guards how a cover is resolved.
 */

const APP = fileURLToPath(new URL('../app', import.meta.url))
const relative = (path: string) => path.slice(APP.length + 1)

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) sources(path, out)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) out.push(path)
  }
  return out
}

const files = sources(APP).map((path) => ({ path: relative(path), text: readFileSync(path, 'utf8') }))

const STORES = files.filter((file) => /^stores\/[^/]+\.ts$/.test(file.path))

/**
 * The cover chain's own names. A store names none of them: it asks `useBookCovers()` and gets a resolved Cover
 * back, and the chain's parts (the probe, the Apple lookup, the budget) are the composable's business.
 */
const CHAIN = /\b(resolveBookCover|resolveOwnCover|verifyCover|CoverSources|lookupAppleIsbn)\b/

/**
 * A source bag of the chain's shape: `probe:` beside `lookupAppleIsbn:`, in either order. Two files may hold one —
 * the chain itself (data/bookCovers.ts), and the app's one door to it (composables/useBookCovers.ts), where the
 * probe and the lazy Apple lookup come in. A store, a component, an import: one more is the divergence back.
 *
 * `bookImport.ts` (:906, :912) is deliberately outside this rule: it probes one address it already has, with no
 * chain to walk, and names no Apple lookup.
 */
const ASSEMBLY = [/probe:[\s\S]{0,200}?lookupAppleIsbn:/, /lookupAppleIsbn:[\s\S]{0,200}?probe:/]

/** The two files that own the bag, and why. */
const OWNERS = ['composables/useBookCovers.ts', 'data/bookCovers.ts']
describe('no store holds the cover chain', () => {
  it('names none of its parts: a store asks useBookCovers() for a Cover', () => {
    const found = STORES.filter((file) => CHAIN.test(file.text)).map((file) => file.path)
    expect(found).toEqual([])
    // A file list that found no store at all would pass this test by reading nothing.
    expect(STORES.length).toBeGreaterThan(40)
  })

  it('builds no source bag of its own, in either order of the two fields', () => {
    const found = files.filter((file) => ASSEMBLY.some((shape) => shape.test(file.text))).map((file) => file.path)
    expect(found.sort()).toEqual([...OWNERS].sort())
  })
})

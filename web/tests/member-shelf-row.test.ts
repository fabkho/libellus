import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Her shelf on her profile (wave E): the same 3D row as the Profile's own Your shelf, drawn in place, not the link card
 * it used to be (the count, one cover and a tap to see anything). Read off the sources, since what is asserted is which
 * component the section is made of and where the document comes from: the section hands `ShelfRowCard` a document built
 * on the device from `open.finished` (`memberShelfFromFinished`, data/memberShelf.ts), never the signed-in member's own
 * Library and never a fetch of her own.
 */
const app = fileURLToPath(new URL('../app/', import.meta.url))
const read = (path: string) => readFileSync(`${app}${path}`, 'utf8')

const MEMBER = 'pages/friends/[member]/index.vue'
const SHELF_PAGE = 'pages/friends/[member]/shelf.vue'
const ROW_CARD = 'components/shelf/RowCard.vue'

/** The member profile's shelf section, from its `UiReveal` to the closing of the `<section>` inside it. */
function section(): string {
  const source = read(MEMBER)
  const start = source.indexOf('<UiReveal :show="shelfBooks.length > 0">')
  expect(start, 'her profile has no shelf section gate').toBeGreaterThan(-1)
  const end = source.indexOf('</section>', start)
  return source.slice(start, end)
}

describe('her shelf on her profile', () => {
  it('is the 3D row in place, not a card that opens the page', () => {
    const shelf = section()
    expect(shelf).toMatch(/<ShelfRowCard\b[^>]*data-testid="member\.shelfRow"/)
    // The link card is gone: no NuxtLink, no cover, no "Newest" line where the row stands.
    expect(shelf).not.toMatch(/<NuxtLink\b/)
    expect(shelf).not.toMatch(/<UiCover\b/)
    expect(shelf).not.toMatch(/shelfNewest/)
  })

  it('is gated on her finished reads, as before: her *Finished* off, or nothing finished, draws nothing', () => {
    expect(section()).toContain('<UiReveal :show="shelfBooks.length > 0">')
    const source = read(MEMBER)
    // Her *Finished* switch and Regal's build decide `shelfBooks`; a build without Regal has no row at all.
    expect(source).toMatch(/const shelfBooks = computed\(\(\) => \(useAppConfig\(\)\.regal === true && open\.value\?\.sections\.finished \? open\.value\.finished : \[\]\)\)/)
  })

  it('hands the row her finished reads, built on the device exactly as her shelf page builds them', () => {
    const source = read(MEMBER)
    const shelfPage = read(SHELF_PAGE)
    for (const page of [source, shelfPage]) {
      expect(page).toContain('memberShelfFromFinished')
      expect(page).toMatch(/timeZone: Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone \|\| 'UTC'/)
    }
    // One mapping: the document is her finished reads, and nothing else of her Library is read here.
    expect(source).toMatch(/memberShelfFromFinished\(shelfBooks\.value, \{ timeZone:/)
    expect(source).toContain('const covers = { ...useCoverHosts(), proxy: false }')
    expect(source).toContain('const origin = useRequestURL().origin')
    expect(section()).toMatch(/<ShelfRowCard\b[^>]*:library="shelfLibrary"/)
    // Not the signed-in member's Library (her own shelf's store), and nothing fetched for it.
    expect(source).not.toMatch(/useShelfStore/)
  })

  it('keeps the whole shelf one tap away, from the section head', () => {
    const shelf = section()
    expect(shelf).toMatch(/<UiSeeAll\b[^>]*:to="`\/friends\/\$\{id\}\/shelf`"/)
    expect(shelf).toMatch(/<UiSeeAll\b[^>]*data-testid="member\.shelfAll"/)
    // Its own name for a screen reader: the shelf is hers, not the caller's (`shelf.card.allLabel` says "your shelf").
    expect(shelf).toMatch(/:aria-label="t\('member\.shelfAllLabel', \{ name, count: count\(shelfBooks\.length\) \}/)
    // The page is still there.
    expect(read(SHELF_PAGE)).toContain("screen: 'memberShelf'")
  })
})

describe('ShelfRowCard can be handed its document', () => {
  it('takes a `library` prop and passes it to the row', () => {
    const card = read(ROW_CARD)
    expect(card).toMatch(/library\?: RegalLibraryFile \| null/)
    expect(card).toMatch(/<LazyShelfRow\b[^>]*:library="file"/)
    // Given one, the row is what it was handed: never the published file, never her own Library's document.
    expect(card).toMatch(/props\.library !== undefined \? props\.library : shelf\.document/)
    expect(card).toMatch(/if \(props\.published\) return null/)
  })

  it('is unchanged for its two existing callers: own profile and a year in review', () => {
    const own = read('components/profile/Shelf.vue')
    expect(own).toContain('<ShelfRowCard v-else :limit="SHELF_ROW_LIMIT" :label="t(\'shelf.card.rowLabel\')" data-testid="profile.shelfRow" />')
    expect(own).not.toContain(':library=')
    const year = read('components/shelf/YearRow.vue')
    expect(year).toContain('<ShelfRowCard :year="year" :label="t(\'shelf.year.rowLabel\', { year })" data-testid="yearInReview.shelfRow" />')
    expect(year).not.toContain(':library=')
    // And the reading page still shows the owner's published file.
    expect(read('pages/r/[token]/index.vue')).toMatch(/<ShelfRowCard\b[\s\S]{0,200}published/)
  })
})

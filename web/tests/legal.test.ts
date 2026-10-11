import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allPlaceholders, LEGAL_DOCUMENTS, legalLangOf, placeholdersOf } from '@/legal'
import { PLACEHOLDER } from '@/legal/placeholders'
import { LEGAL_LANGS, type LegalBlock } from '@/legal/types'
import { isAppPath, parseInline, placeholdersIn } from '@/utils/legalInline'
import { isPublicPath } from '@/utils/publicPath'

/**
 * The privacy notice and the imprint (docs/legal-checklist.md): public addresses, the same structure in both
 * languages, every placeholder listed for the owner, and nobody in them who does not belong there.
 */
describe('the public addresses', () => {
  it('lets the privacy notice, the imprint and the reading pages be opened signed out', () => {
    for (const path of ['/privacy', '/imprint', '/r/some-token', '/r/some-token/book/1']) expect(isPublicPath(path), path).toBe(true)
  })

  it('keeps everything else behind the sign-in, lookalikes included', () => {
    for (const path of ['/', '/library', '/profile', '/privacy-policy', '/imprints', '/book/privacy', '/rx', '/f/abc', '/share', '/sign-in']) {
      expect(isPublicPath(path), path).toBe(false)
    }
  })
})

describe('the texts', () => {
  it('have the same sections, in the same order, in English and German', () => {
    for (const [page, document] of Object.entries(LEGAL_DOCUMENTS)) {
      const ids = (lang: 'en' | 'de') => document[lang].sections.map((section) => section.id)
      expect(ids('de'), page).toEqual(ids('en'))
      const shape = (lang: 'en' | 'de') => document[lang].sections.map((s) => s.blocks.map((b) => ('ul' in b ? `ul${b.ul.length}` : 'lines' in b ? `lines${b.lines.length}` : 'p')).join())
      expect(shape('de'), page).toEqual(shape('en'))
    }
  })

  it('have a title, a lead and a version in both languages', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      for (const lang of LEGAL_LANGS) {
        const text = document[lang]
        expect(text.title.length).toBeGreaterThan(3)
        expect(text.lead.length).toBeGreaterThan(20)
        expect(text.version).toMatch(/2026/)
      }
    }
  })

  it('name the owner as the only operator, and nobody else', () => {
    const all = JSON.stringify(LEGAL_DOCUMENTS)
    expect(all).toContain('Fabian Kirchhoff')
    expect(all).not.toMatch(/nina|g[uü]lpen|heinsberg|bookretreat/i)
  })

  it('say the German imprint is the one § 5 DDG asks for, and the privacy notice cites the GDPR articles it relies on', () => {
    expect(LEGAL_DOCUMENTS.imprint.de.lead).toContain('§ 5 DDG')
    const privacy = JSON.stringify(LEGAL_DOCUMENTS.privacy.en)
    for (const article of ['Art. 6(1)(a)', 'Art. 6(1)(b)', 'Art. 6(1)(f)', 'Art. 15 to 21']) expect(privacy).toContain(article)
  })

  it('link only to paths that are pages, https addresses or mailto', () => {
    const blocks = Object.values(LEGAL_DOCUMENTS).flatMap((d) => LEGAL_LANGS.flatMap((lang) => d[lang].sections.flatMap((s) => s.blocks)))
    const texts = blocks.flatMap((b: LegalBlock) => ('p' in b ? [b.p] : 'ul' in b ? b.ul : b.lines))
    const hrefs = texts.flatMap((text) => parseInline(text).flatMap((part) => (part.kind === 'link' ? [part.href] : [])))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs.filter(isAppPath)) expect(['/privacy', '/imprint'], href).toContain(href)
    for (const href of hrefs.filter((h) => !isAppPath(h))) expect(href).toMatch(/^(https:\/\/|mailto:)/)
  })
})

describe('the placeholders', () => {
  const checklist = readFileSync(new URL('../../docs/legal-checklist.md', import.meta.url), 'utf8')
  // The checklist's table rows start with the placeholder in backticks.
  const listed = [...checklist.matchAll(/^\| `(\[\[[^`]+\]\])` \|/gm)].map((match) => match[1]!)

  it('are exactly the ones docs/legal-checklist.md lists', () => {
    expect([...allPlaceholders()].sort()).toEqual([...listed].sort())
  })

  it('come from one table, and every one of them is used', () => {
    expect([...allPlaceholders()].sort()).toEqual(Object.values(PLACEHOLDER).sort())
  })

  it('are in both languages of the page that uses them', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const stringify = (lang: 'en' | 'de') => placeholdersIn(JSON.stringify(document[lang])).sort()
      expect(stringify('de')).toEqual(stringify('en'))
    }
    expect(placeholdersOf(LEGAL_DOCUMENTS.imprint)).toContain(PLACEHOLDER.address)
  })
})

describe('parseInline', () => {
  it('reads bold, links and placeholders, and leaves the rest as text', () => {
    expect(parseInline('a **b** [c](/imprint) [[D E]] f')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'c', href: '/imprint' },
      { kind: 'text', text: ' ' },
      { kind: 'placeholder', text: '[[D E]]' },
      { kind: 'text', text: ' f' },
    ])
  })

  it('never reads a placeholder as a link label', () => {
    expect(parseInline('[[X]](y)')).toEqual([{ kind: 'placeholder', text: '[[X]]' }, { kind: 'text', text: '(y)' }])
  })
})

describe('legalLangOf', () => {
  it('takes the address’s language first, then German devices, else English', () => {
    expect(legalLangOf('de', ['en-US'])).toBe('de')
    expect(legalLangOf(['en', 'de'], ['de-DE'])).toBe('en')
    expect(legalLangOf(undefined, ['de-AT', 'en'])).toBe('de')
    expect(legalLangOf('fr', ['en-GB'])).toBe('en')
    expect(legalLangOf(undefined, [])).toBe('en')
  })
})

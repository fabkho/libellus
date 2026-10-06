import { describe, expect, it } from 'vitest'
import {
  bookLinks,
  createLinkTemplates,
  fillLinkTemplate,
  isbn13To10,
  LINK_TEMPLATES_MAX,
  linkTemplateProblem,
  parseLinkTemplates,
  placeholderValues,
  readDeviceLinkTemplates,
  saveDeviceLinkTemplates,
  type LinkBook,
} from '@/data/linkTemplates'
import { signUpMember } from './support/member'

/**
 * Book links (issue #116): a list of { label, url } templates whose
 * placeholders ({isbn}, {isbn10}, {title}, {author}) are filled from a Book,
 * URL-encoded; the instance's from the build's JSON, the member's own kept in
 * `link_templates`, hers alone. The pure part first, then the repository against
 * the local stack.
 */

const DUNE: LinkBook = { title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593', isbn10: null }
const ODD: LinkBook = { title: 'Ça & “Ünïcode” / 100% ?', authors: ['Ève O’Brien', 'Second Author'], isbn13: null, isbn10: '0306406152' }

describe('a placeholder', () => {
  it('stands for the ISBN-13, the ISBN-10, the title and the first author', () => {
    expect(placeholderValues(DUNE)).toEqual({ isbn: '9780441013593', isbn10: '0441013597', title: 'Dune', author: 'Frank Herbert' })
  })

  it('is worked out from the other ISBN when the Book has only one', () => {
    expect(placeholderValues(ODD).isbn).toBe('9780306406157')
    expect(placeholderValues(ODD).isbn10).toBe('0306406152')
    expect(isbn13To10('9780306406157')).toBe('0306406152')
    expect(isbn13To10('9781234567897')).toBe('123456789X')
    // A 979 ISBN has no ISBN-10.
    expect(isbn13To10('9791032305690')).toBeNull()
  })
})

describe('a template filled for a Book', () => {
  it('puts the values in, URL-encoded', () => {
    expect(fillLinkTemplate('https://openlibrary.org/isbn/{isbn}', DUNE)).toBe('https://openlibrary.org/isbn/9780441013593')
    expect(fillLinkTemplate('https://catalogue.example.org/search?q={title}+{author}', DUNE)).toBe(
      'https://catalogue.example.org/search?q=Dune+Frank%20Herbert',
    )
    expect(fillLinkTemplate('https://catalogue.example.org/?t={title}&a={author}&i={isbn10}', ODD)).toBe(
      `https://catalogue.example.org/?t=${encodeURIComponent('Ça & “Ünïcode” / 100% ?')}&a=${encodeURIComponent('Ève O’Brien')}&i=0306406152`,
    )
  })

  it('fills every place a placeholder stands, and leaves unknown braces alone', () => {
    expect(fillLinkTemplate('https://example.org/{isbn}/{isbn}#{other}', DUNE)).toBe('https://example.org/9780441013593/9780441013593#{other}')
  })

  it('is no link when the Book has nothing for a placeholder', () => {
    const noIsbn: LinkBook = { title: 'A Manual Book', authors: [], isbn13: null, isbn10: null }
    expect(fillLinkTemplate('https://openlibrary.org/isbn/{isbn}', noIsbn)).toBeNull()
    expect(fillLinkTemplate('https://example.org/?a={author}', noIsbn)).toBeNull()
    expect(fillLinkTemplate('https://example.org/?t={title}', noIsbn)).toBe('https://example.org/?t=A%20Manual%20Book')
  })

  it('keeps the list in its order and leaves out what it cannot fill', () => {
    const templates = [
      { label: 'By title', url: 'https://example.org/?t={title}' },
      { label: 'ISBN-10', url: 'https://example.org/{isbn10}' },
      { label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' },
    ]
    const book: LinkBook = { ...DUNE, isbn13: '9791032305690' }
    expect(bookLinks(templates, book)).toEqual([
      { label: 'By title', href: 'https://example.org/?t=Dune' },
      { label: 'Open Library', href: 'https://openlibrary.org/isbn/9791032305690' },
    ])
  })
})

describe('a template as typed', () => {
  const ok = { label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' }

  it('can be saved with a label and an http(s) address', () => {
    expect(linkTemplateProblem(ok)).toBeNull()
    expect(linkTemplateProblem({ label: ' City library ', url: ' http://catalogue.example.org/search?q={title} ' })).toBeNull()
  })

  it('says what is wrong with it', () => {
    expect(linkTemplateProblem({ ...ok, label: '  ' })).toBe('label_missing')
    expect(linkTemplateProblem({ ...ok, label: 'x'.repeat(41) })).toBe('label_long')
    expect(linkTemplateProblem({ ...ok, url: 'openlibrary.org/isbn/{isbn}' })).toBe('url_invalid')
    expect(linkTemplateProblem({ ...ok, url: 'javascript:alert(1)' })).toBe('url_invalid')
    expect(linkTemplateProblem({ ...ok, url: 'ftp://example.org/{isbn}' })).toBe('url_invalid')
    expect(linkTemplateProblem({ ...ok, url: 'https://{title}.example.org/' })).toBe('url_invalid')
    expect(linkTemplateProblem({ ...ok, url: 'https://example.org/a b' })).toBe('url_invalid')
    expect(linkTemplateProblem({ ...ok, url: `https://example.org/${'a'.repeat(2000)}` })).toBe('url_long')
    expect(linkTemplateProblem({ ...ok, url: 'https://example.org/{publisher}' })).toBe('placeholder_unknown')
  })
})

describe('templates from the build or the device', () => {
  it('are read from JSON or a list, keeping the valid ones in order', () => {
    const json = JSON.stringify([
      { label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' },
      { label: 'Broken', url: 'not a url' },
      { label: 'City library', url: 'https://catalogue.example.org/?q={title}', extra: true },
      'nonsense',
    ])
    const expected = [
      { label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' },
      { label: 'City library', url: 'https://catalogue.example.org/?q={title}' },
    ]
    expect(parseLinkTemplates(json)).toEqual(expected)
    // Nuxt hands an env var that is JSON over already parsed.
    expect(parseLinkTemplates(JSON.parse(json))).toEqual(expected)
  })

  it('are none when there is nothing, or nothing readable', () => {
    expect(parseLinkTemplates('')).toEqual([])
    expect(parseLinkTemplates('   ')).toEqual([])
    expect(parseLinkTemplates('{not json')).toEqual([])
    expect(parseLinkTemplates({ label: 'x', url: 'https://example.org' })).toEqual([])
    expect(parseLinkTemplates(undefined)).toEqual([])
  })

  it('are at most the twenty the database keeps', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ label: `L${i}`, url: `https://example.org/${i}` }))
    expect(parseLinkTemplates(many)).toHaveLength(LINK_TEMPLATES_MAX)
  })

  it('are kept on the device for the member who saved them only', () => {
    const items = new Map<string, string>()
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
      get length() {
        return items.size
      },
      key: (index: number) => [...items.keys()][index] ?? null,
    }
    saveDeviceLinkTemplates(storage, 'member-a', [{ label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' }])
    expect(readDeviceLinkTemplates(storage, 'member-a')).toEqual([{ label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' }])
    expect(readDeviceLinkTemplates(storage, 'member-b')).toBeNull()
  })
})

describe('her own links', () => {
  const list = [
    { label: 'City library', url: 'https://catalogue.example.org/search?q={title}%20{author}' },
    { label: 'Open Library', url: 'https://openlibrary.org/isbn/{isbn}' },
  ]

  it('are none at first, saved in her order and read back', async () => {
    const member = await signUpMember()
    const links = createLinkTemplates(member.client)
    expect(await links.load()).toEqual({ data: [], error: null })

    expect(await links.save(list.map((t) => ({ label: ` ${t.label} `, url: t.url })))).toEqual({ data: list, error: null })
    expect(await links.load()).toEqual({ data: list, error: null })

    const reversed = [...list].reverse()
    expect((await links.save(reversed)).data).toEqual(reversed)
    expect((await links.load()).data).toEqual(reversed)

    expect(await links.save([])).toEqual({ data: [], error: null })
    expect((await links.load()).data).toEqual([])
  })

  it('are hers alone: another member reads none of them', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await createLinkTemplates(ada.client).save(list)

    expect(await createLinkTemplates(ben.client).load()).toEqual({ data: [], error: null })
    const { data } = await ben.client.from('link_templates').select('member_id, templates')
    expect(data).toEqual([])
  })

  it('are refused when one is wrong, and offline, before anything is sent', async () => {
    const member = await signUpMember()
    const links = createLinkTemplates(member.client)
    expect(await links.save([{ label: 'Bad', url: 'javascript:alert(1)' }])).toEqual({ data: null, error: 'link_templates_invalid' })
    expect(await createLinkTemplates(member.client, { online: () => false }).save(list)).toEqual({ data: null, error: 'offline' })
    expect((await links.load()).data).toEqual([])
  })

  it('are refused by the database too, whatever a client sends', async () => {
    const member = await signUpMember()
    const { error } = await member.client.rpc('set_link_templates', { p_templates: [{ label: 'x', url: 'https://{title}.example.org' }] })
    expect(error?.message).toContain('link_templates_invalid')
  })
})

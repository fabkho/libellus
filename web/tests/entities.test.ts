import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeEntities, NAMED_ENTITIES } from '@/data/entities'

/**
 * HTML entities decoded (issue #47, item 4): the helper Apple's titles,
 * artists and blurbs go through, and the migration that cleans what was stored
 * before it existed, which must decode the very same names.
 */

describe('decodeEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(decodeEntities('Klara y el Sol &ldquo;Klara and the Sun&rdquo;')).toBe('Klara y el Sol “Klara and the Sun”')
    expect(decodeEntities('It&rsquo;s &#8211; fine &#x2014; really &hellip;')).toBe('It’s – fine — really …')
    expect(decodeEntities('M&auml;rchen &amp; Sagen, &Auml;pfel, Stra&szlig;e, Fran&#231;ois, &eacute;t&eacute;')).toBe(
      'Märchen & Sagen, Äpfel, Straße, François, été',
    )
  })

  it('keeps the case of names that differ by it, and is forgiving about the basic five', () => {
    expect(decodeEntities('&Ouml; &ouml;')).toBe('Ö ö')
    expect(decodeEntities('&AMP; &QUOT;')).toBe('& "')
  })

  it('decodes once: an escaped entity stays an entity', () => {
    expect(decodeEntities('&amp;ldquo;')).toBe('&ldquo;')
    expect(decodeEntities('&amp;amp;')).toBe('&amp;')
  })

  it('leaves what is not an entity alone', () => {
    expect(decodeEntities('AT&T; Q&A & Co')).toBe('AT&T; Q&A & Co')
    expect(decodeEntities('&nonsense; &#xZZ; &#; &#0; &#xD800; &#99999999;')).toBe('&nonsense; &#xZZ; &#; &#0; &#xD800; &#99999999;')
    expect(decodeEntities('plain')).toBe('plain')
    expect(decodeEntities('')).toBe('')
  })
})

describe('the migration that cleans stored rows', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261003144500_decode_catalogue_entities.sql', import.meta.url), 'utf8')

  it('decodes the same named entities as the client, to the same characters', () => {
    const listed = new Map([...sql.matchAll(/^\s+\('(\w+)', '((?:[^']|'')*)'\),?$/gm)].map(([, name, letter]) => [name!, letter!.replace(/''/g, "'")]))
    for (const [name, letter] of Object.entries(NAMED_ENTITIES)) {
      if (name === 'amp') continue // last, on its own
      expect(listed.get(name), name).toBe(letter)
    }
    expect(listed.size).toBe(Object.keys(NAMED_ENTITIES).length - 1)
    expect(sql).toContain("replace(v, '&amp;', '&')")
  })

  it('only touches Catalogue rows that have an entity, so running it again changes nothing', () => {
    expect(sql).toMatch(/where owner_id is null\s+and \(/)
    expect(sql).toContain('drop function pg_temp.decode_entities(text)')
  })
})

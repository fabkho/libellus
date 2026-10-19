import { describe, expect, it } from 'vitest'
import { isSameWork } from '@/data/import/editions'
import { fuzzyTitleMatch, normaliseTitle, volumeOf } from '@/data/titleMatch'

/**
 * The shared fuzzy title rule (data/titleMatch.ts; the Goodreads cover search of the `goodreads-rating`
 * function and the import's `isSameWork` use it): what it accepts (a credit after the title, a word more or less,
 * a series aside, `&`, accents) and what it never does (without the author, another volume, a book about the
 * book, a book that merely begins like it, a translation). Pure; public titles.
 */

/** The rule with the author already found: what a caller says when the surnames agree. */
const same = (wanted: string, found: string) => fuzzyTitleMatch(wanted, found, true)

describe('normaliseTitle', () => {
  it('drops accents and punctuation and writes & as "and"', () => {
    expect(normaliseTitle('Blood & Roses')).toBe('blood and roses')
    expect(normaliseTitle('Les Misérables')).toBe('les miserables')
    expect(normaliseTitle("Ender's Game!")).toBe('enders game')
    expect(normaliseTitle('Größe — Maß')).toBe('grosse mass')
  })
})

describe('fuzzyTitleMatch: what it accepts', () => {
  it('a credit appended to the title', () => {
    expect(same('A Jingle Bell Mingle', 'A Jingle Bell Mingle by Julie Murphy and Sierra Simone')).toBe(true)
    expect(same('Eine kleine Nachtmusik', 'Eine kleine Nachtmusik von Max Mustermann')).toBe(true)
  })

  it('a word more or less at the end', () => {
    expect(same('A Fall to Forgive', 'A Fall to Forgive You')).toBe(true)
    expect(same('A Fall to Forgive You', 'A Fall to Forgive')).toBe(true)
    expect(same('Crown and Bones', 'Crown and Bones: A Novel')).toBe(true)
  })

  it('a leading article more or less', () => {
    expect(same('The Lantern in the Quiet Sea', 'Lantern in the Quiet Sea')).toBe(true)
    expect(same('Girl in the Winter Song', 'The Girl in the Winter Song')).toBe(true)
  })

  it('an edition note after the title', () => {
    expect(same('Winter Orchard', 'Winter Orchard Special Edition')).toBe(true)
    expect(same('Salt Orchard Special Edition', 'Salt Orchard')).toBe(true)
    expect(same('Salt Marsh Kings', 'Salt Marsh Kings by A.B Reed')).toBe(true)
  })

  it('a little word more or less inside', () => {
    expect(same("Harry Potter and Sorcerer's Stone", "Harry Potter and the Sorcerer's Stone")).toBe(true)
  })

  it('& for and, accents, punctuation, the series aside, a volume mark of the first book', () => {
    expect(same('Blood and Roses', 'Blood & Roses (Blood & Roses, #1)')).toBe(true)
    expect(same('Blood & Roses - Buch 1', 'Blood & Roses')).toBe(true)
    expect(same('Les Misérables', 'Les Miserables')).toBe(true)
    expect(same('Title: A Subtitle', 'Title')).toBe(true)
  })

  it('a subtitle or series prefix is the whole of the other title', () => {
    expect(same('Cold Water - Eine Liebe am Meer', 'Cold Water')).toBe(true)
  })
})

describe('fuzzyTitleMatch: what it never does', () => {
  it('not without the author', () => {
    expect(fuzzyTitleMatch('A Fall to Forgive', 'A Fall to Forgive You', false)).toBe(false)
    expect(fuzzyTitleMatch('A Jingle Bell Mingle', 'A Jingle Bell Mingle by Julie Murphy', false)).toBe(false)
  })

  it('not another volume of a series (named volumes)', () => {
    expect(same('Blood & Roses - Buch 1', 'Blood & Roses - Buch 3')).toBe(false)
    expect(same('Blood & Roses - Buch 3', 'Blood & Roses - Buch 1')).toBe(false)
    expect(same('Blood & Roses - Buch 2', 'Blood & Roses - Buch 3')).toBe(false)
    expect(same('Heartstopper: Volume Two', 'Heartstopper: Volume Three')).toBe(false)
    expect(same('Harbour Lights Tome 02', 'Harbour Lights T01')).toBe(false)
  })

  it('not a later volume for the book the series is named after, nor the first for a later one', () => {
    expect(same('Blood & Roses', 'Blood & Roses - Buch 3')).toBe(false)
    expect(same('Blood & Roses - Buch 2', 'Blood & Roses')).toBe(false)
    expect(same('Harbour Lights Teil 4', 'Harbour Lights')).toBe(false)
  })

  it('not a later volume that only a number says', () => {
    expect(same('Rot and Rubin', 'Rot and Rubin 2')).toBe(false)
    expect(same('Rot and Rubin 2', 'Rot and Rubin 3')).toBe(false)
    expect(same('Cold Water Chronicles', 'Cold Water Chronicles II')).toBe(false)
  })

  it('not a summary, study guide or workbook, nor a companion', () => {
    expect(same('A Court of Thorns and Roses', 'A Court of Thorns and Roses Summary')).toBe(false)
    expect(same('A Court of Thorns and Roses', 'A Court of Thorns and Roses: Study Guide')).toBe(false)
    expect(same('A Court of Thorns and Roses', 'A Court of Thorns and Roses Coloring Book')).toBe(false)
    expect(same('A Court of Thorns and Roses', 'A Court of Thorns and Roses Journal')).toBe(false)
    expect(same('A Court of Thorns and Roses', 'A Court of Thorns and Roses Boxed Set')).toBe(false)
  })

  it('not a book that merely begins like it, or shares a series name with it', () => {
    expect(same('Dune', 'Dune Messiah')).toBe(false)
    expect(same('Fifty Shades Darker', 'Fifty Shades Freed')).toBe(false)
    expect(same('A Court of Thorns and Roses', 'A Court of Mist and Fury')).toBe(false)
    expect(same('Harry Potter and the Chamber of Secrets', 'Harry Potter and the Prisoner of Azkaban')).toBe(false)
    expect(same('The Lord of the Rings: The Two Towers', 'The Lord of the Rings: The Return of the King')).toBe(false)
    expect(same('Harbour Lights - Cold Water', 'Harbour Lights - Warm Sand')).toBe(false)
    expect(same('Ember of Salt', 'Ember of Salt Prequel Chronicles Extended Edition Plus')).toBe(false)
    // …nor a book about it ("World of …", "The Art of …" before the title; a companion's word after it).
    expect(same('Ember of Salt', 'World of Ember of Salt')).toBe(false)
    expect(same('Ember of Salt', 'The Art of Ember of Salt')).toBe(false)
    expect(same('Ember of Salt', 'Ember of Salt Guide')).toBe(false)
    expect(same('The Hunger Games', 'The Hunger Games Mockingjay Companion')).toBe(false)
  })

  it('not a translation in another script, nor an empty title', () => {
    expect(same('Cold Water', 'Θνητοί Θεοί (Cold Water)')).toBe(false)
    expect(same('A Fall to Forgive', '(A Fall to Forgive)')).toBe(false)
    expect(same('', 'A Fall to Forgive')).toBe(false)
  })
})

describe('isSameWork with the fuzzy rule', () => {
  const row = (title: string) => ({ title, authors: ['Julie Murphy'] })

  it('takes a worded-differently title only with the author', () => {
    expect(isSameWork(row('A Jingle Bell Mingle'), { title: 'A Jingle Bell Mingle by Julie Murphy and Sierra Simone', authors: ['Julie Murphy'] })).toBe(true)
    expect(isSameWork(row('A Jingle Bell Mingle'), { title: 'A Jingle Bell Mingle by Julie Murphy and Sierra Simone', authors: ['Anna Other'] })).toBe(false)
    expect(isSameWork(row('A Fall to Forgive'), { title: 'A Fall to Forgive You', authors: ['Julie Murphy'] })).toBe(true)
  })

  it('still refuses a later volume, a summary and a translation', () => {
    const found = (title: string) => ({ title, authors: ['Julie Murphy'] })
    expect(isSameWork(row('Blood & Roses - Buch 1'), found('Blood & Roses - Buch 3'))).toBe(false)
    expect(isSameWork(row('Blood & Roses - Buch 3'), found('Blood & Roses - Buch 1'))).toBe(false)
    expect(isSameWork(row('A Fall to Forgive'), found('A Fall to Forgive You: Summary'))).toBe(false)
    expect(isSameWork(row('Cold Water'), found('Θνητοί Θεοί (Cold Water)'))).toBe(false)
  })
})

describe('volumeOf (shared)', () => {
  it('reads the number of a volume mark', () => {
    expect(volumeOf('Blood & Roses - Buch 3')).toBe('3')
    expect(volumeOf('Blood & Roses')).toBeNull()
  })
})

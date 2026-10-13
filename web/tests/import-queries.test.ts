import { describe, expect, it } from 'vitest'
import { FREE_SOURCES, mainTitle, questionsFor, spelledOut } from '@/data/import/queries'

/**
 * The questions the import asks about a row (issue #111): the ladder of query
 * strategies (`questionsFor`) in its order, a strategy whose question one asked
 * already being left out, the spelled-out step for umlauts and ß, the
 * title-alone step's bar for a telling enough title, the surname-first step's
 * free sources, and `mainTitle`'s and `spelledOut`'s own rewriting. Invented
 * titles and authors, public-domain classics; pure.
 */

describe('questionsFor', () => {
  it('asks the title with the author, then the main title with the surname, then spelled out, then the title alone, then the surname first', () => {
    const questions = questionsFor({ title: 'Cold Water: A Novel', authors: ['Greta Müller'] })
    expect(questions.map((question) => question.strategy)).toEqual(['titleAuthor', 'mainTitleSurname', 'spelledOut', 'titleOnly', 'authorSwapped'])
    expect(questions.map((question) => question.query)).toEqual([
      'Cold Water: A Novel Greta Müller',
      'Cold Water Müller',
      'Cold Water Mueller',
      'Cold Water',
      'Cold Water Müller Greta',
    ])
  })

  it('asks nothing twice when the main title is the title and the author is one word', () => {
    const questions = questionsFor({ title: 'Moby Dick', authors: ['Melville'] })
    expect(questions.map((question) => question.strategy)).toEqual(['titleAuthor', 'titleOnly'])
    expect(questions.map((question) => question.query)).toEqual(['Moby Dick Melville', 'Moby Dick'])
    const asked = questions.map((question) => question.query.toLowerCase().replace(/\s+/g, ' '))
    expect(new Set(asked).size).toBe(asked.length)
  })

  it('spells umlauts and ß out only when the main title or the surname has one', () => {
    const title = questionsFor({ title: 'Größe Übel', authors: ['Anna Bramley'] })
    expect(title.find((question) => question.strategy === 'spelledOut')?.query).toBe('Groesse Uebel Bramley')
    const surname = questionsFor({ title: 'Cold Water', authors: ['Greta Müller'] })
    expect(surname.find((question) => question.strategy === 'spelledOut')?.query).toBe('Cold Water Mueller')
    const plain = questionsFor({ title: 'Cold Water', authors: ['Anna Bramley'] })
    expect(plain.find((question) => question.strategy === 'spelledOut')).toBeUndefined()
  })

  it('asks the title alone when it is two words or one long word', () => {
    const twoWords = questionsFor({ title: 'Bleak House', authors: ['Charles Dickens'] })
    expect(twoWords.find((question) => question.strategy === 'titleOnly')?.query).toBe('Bleak House')
    const short = questionsFor({ title: 'Emma', authors: ['Jane Austen'] })
    expect(short.find((question) => question.strategy === 'titleOnly')).toBeUndefined()
    const long = questionsFor({ title: 'Persuasion', authors: ['Jane Austen'] })
    expect(long.find((question) => question.strategy === 'titleOnly')?.query).toBe('Persuasion')
  })

  it('swaps the author only for a multi-word name, and asks only the free sources', () => {
    const swapped = questionsFor({ title: 'Cold Water: A Novel', authors: ['Greta Müller'] }).find(
      (question) => question.strategy === 'authorSwapped',
    )
    expect(swapped?.query).toBe('Cold Water Müller Greta')
    expect(swapped?.sources).toEqual(['catalogue', 'openlibrary'])
    expect(FREE_SOURCES).toEqual(['catalogue', 'openlibrary'])
    const oneWord = questionsFor({ title: 'Moby Dick', authors: ['Melville'] })
    expect(oneWord.find((question) => question.strategy === 'authorSwapped')).toBeUndefined()
  })

  it('asks Apple only the first two questions: umlauts written out, the title alone and surname first go to the catalogues', () => {
    for (const question of questionsFor({ title: 'Cold Water: A Novel', authors: ['Greta Müller'] })) {
      if (['authorSwapped', 'spelledOut', 'titleOnly'].includes(question.strategy)) expect(question.sources).toEqual(['catalogue', 'openlibrary'])
      else expect(question).not.toHaveProperty('sources')
    }
  })
})

describe('mainTitle', () => {
  it('drops what follows a subtitle’s colon, a dash, a bar or sits in brackets', () => {
    expect(mainTitle('Cold Water: A Novel')).toBe('Cold Water')
    expect(mainTitle('Harbour Lights - Cold Water')).toBe('Harbour Lights')
    expect(mainTitle('Harbour Lights – Warm Sand')).toBe('Harbour Lights')
    expect(mainTitle('Harbour Lights — Warm Sand')).toBe('Harbour Lights')
    expect(mainTitle('Cold Water | A Novel')).toBe('Cold Water')
    expect(mainTitle('Cold Water (Harbour Lights, #1)')).toBe('Cold Water')
    expect(mainTitle('Cold Water [an annotated edition]')).toBe('Cold Water')
  })
})

describe('spelledOut', () => {
  it('writes umlauts and ß out the way an ASCII catalogue spells them', () => {
    expect(spelledOut('Größe Übel')).toBe('Groesse Uebel')
    expect(spelledOut('Greta Müller')).toBe('Greta Mueller')
  })
})

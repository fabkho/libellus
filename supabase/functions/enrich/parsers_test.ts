/**
 * The pure parts: series text, ordinals, dates, kinds, names and titles,
 * Commons credits, the User-Agent.
 *
 *   cd supabase/functions/enrich && deno task test
 */
import { assertEquals } from '@std/assert'
import { DEFAULT_CONTACT, userAgent } from './http.ts'
import { namesMatch, titlesMatch } from './match.ts'
import { parseSeriesText } from './openlibrary.ts'
import {
  isPartTitle,
  isSplitVolume,
  kindOf,
  label,
  labels,
  parseOrdinal,
  parseSeries,
  parseTime,
  parseWorks,
  titleOrder,
  withoutSplitVolumes,
} from './wikidata.ts'
import { parseImageInfo, plainText } from './wikimedia.ts'

Deno.test("an edition's series text gives a name and a position", () => {
  assertEquals(parseSeriesText('Discworld ; 15'), { name: 'Discworld', position: 15 })
  assertEquals(parseSeriesText('Discworld #13'), { name: 'Discworld', position: 13 })
  assertEquals(parseSeriesText('The Expanse, book 1'), { name: 'The Expanse', position: 1 })
  assertEquals(parseSeriesText('Book of the New Sun (1)'), { name: 'Book of the New Sun', position: 1 })
  assertEquals(parseSeriesText('Harry Potter Bd. 4'), { name: 'Harry Potter', position: 4 })
  assertEquals(parseSeriesText('Murderbot Diaries 2.5'), { name: 'Murderbot Diaries', position: 2.5 })
  assertEquals(parseSeriesText('A Discworld novel'), { name: 'Discworld', position: null })
  assertEquals(parseSeriesText('Discworld series'), { name: 'Discworld', position: null })
  // A publisher's series is not one a reader reads in order.
  assertEquals(parseSeriesText('Modern Library Classics'), null)
  assertEquals(parseSeriesText('Ventana abierta 6'), null)
  assertEquals(parseSeriesText('SF Masterworks ; 12'), null)
  assertEquals(parseSeriesText('  '), null)
  assertEquals(parseSeriesText('12'), null)
})

Deno.test('a series ordinal is a number, decimals allowed, or nothing', () => {
  assertEquals(parseOrdinal('13'), 13)
  assertEquals(parseOrdinal('2.5'), 2.5)
  assertEquals(parseOrdinal('0'), 0)
  assertEquals(parseOrdinal('1a'), null)
  assertEquals(parseOrdinal('II'), null)
  assertEquals(parseOrdinal(undefined), null)
})

Deno.test('a Wikidata time keeps its precision; a decade is not a date', () => {
  assertEquals(parseTime({ time: '+1948-04-28T00:00:00Z', precision: 11 }), { date: '1948-04-28', precision: 11 })
  assertEquals(parseTime({ time: '+1974-00-00T00:00:00Z', precision: 9 }), { date: '1974-01-01', precision: 9 })
  assertEquals(parseTime({ time: '+1960-00-00T00:00:00Z', precision: 8 }), null)
})

Deno.test('the kind of a work, from its form, type and genre', () => {
  assertEquals(kindOf(['Q7725634'], ['Q8261'], ['Q132311']), 'novel')
  assertEquals(kindOf(['Q7725634'], [], ['Q24925']), 'novel')
  assertEquals(kindOf(['Q7725634'], ['Q1279564'], []), 'collection')
  assertEquals(kindOf(['Q7725634'], ['Q149537'], []), 'novella')
  assertEquals(kindOf(['Q47461344'], [], []), 'other')
  assertEquals(kindOf(['Q7725634'], [], ['Q213051']), 'nonfiction')
  assertEquals(kindOf(['Q559618'], [], []), null)
})

Deno.test('names and titles that mean the same, across spellings', () => {
  assertEquals(namesMatch('Ursula  K. Le Guin', 'Ursula K. Le Guin'), true)
  assertEquals(namesMatch('H.G. Wells', 'H. G. Wells'), true)
  assertEquals(namesMatch('H.G. Wells', 'Herbert George Wells'), true)
  assertEquals(namesMatch('Joe Haldeman', 'John Scalzi'), false)
  assertEquals(namesMatch('Andrzej Sapkowski', 'Danusia Stok'), false)
  assertEquals(titlesMatch('The Dispossessed: An Ambiguous Utopia', 'The Dispossessed'), true)
  assertEquals(titlesMatch('Klara and the Sun: A GMA Book Club Pick', 'Klara and the Sun'), true)
  assertEquals(titlesMatch('We Are Legion (We Are Bob)', 'We Are Legion'), true)
  assertEquals(titlesMatch('Small Gods', 'Smaller Gods'), false)
})

Deno.test('a Commons portrait keeps its licence and author, without tracking parameters', () => {
  const photo = parseImageInfo({
    query: {
      pages: [{
        imageinfo: [{
          thumburl: 'https://upload.wikimedia.org/thumb/a.jpg/480px-a.jpg?utm_source=commons.wikimedia.org',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
          extmetadata: {
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">Luigi Novi</a>' },
            LicenseShortName: { value: 'CC BY 3.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by/3.0' },
          },
        }],
      }],
    },
  })
  assertEquals(photo, {
    url: 'https://upload.wikimedia.org/thumb/a.jpg/480px-a.jpg',
    credit: {
      source: 'commons',
      artist: 'Luigi Novi',
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0',
      fileUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
    },
  })
  assertEquals(plainText('Tom &amp; <b>Jerry</b>'), 'Tom & Jerry')
})

Deno.test('the User-Agent names the app, the instance and a contact (Wikimedia policy)', () => {
  assertEquals(userAgent(), `Libellus/1.0 (private book tracker; ${DEFAULT_CONTACT}) enrich`)
  assertEquals(
    userAgent('https://books.example.org', 'owner@example.org'),
    'Libellus/1.0 (private book tracker; +https://books.example.org; owner@example.org) enrich',
  )
})

Deno.test('a title in the first language, then English, then the default label (mul), then the others', () => {
  assertEquals(titleOrder(['en', 'de']), ['en', 'mul', 'de'])
  assertEquals(titleOrder(['de', 'en']), ['de', 'en', 'mul'])
  assertEquals(titleOrder(['de']), ['de', 'mul'])
  const unseen = { id: 'Q2669617', labels: { de: { value: 'Der Club der unsichtbaren Gelehrten' }, mul: { value: 'Unseen Academicals' } } }
  assertEquals(label(unseen, ['en', 'de']), 'Unseen Academicals')
  assertEquals(label(unseen, ['de', 'en']), 'Der Club der unsichtbaren Gelehrten')
  // The default label never stands in for a language's own title.
  assertEquals(labels(unseen, ['en', 'de']), { de: 'Der Club der unsichtbaren Gelehrten' })
  // Only some other language: the last resort.
  assertEquals(label({ id: 'Q1', labels: { fr: { value: 'Allez les mages !' } } }, ['en', 'de']), 'Allez les mages !')

  const row = (labels: Record<string, string>) => ({
    work: { value: 'http://www.wikidata.org/entity/Q2669617' },
    types: { value: 'Q7725634' },
    ...Object.fromEntries(Object.entries(labels).map(([lang, value]) => [`label_${lang}`, { value }])),
  })
  const works = parseWorks({ results: { bindings: [row({ de: 'Der Club der unsichtbaren Gelehrten', mul: 'Unseen Academicals' })] } }, ['en', 'de'])
  assertEquals(works.map((w) => [w.title, w.titles]), [['Unseen Academicals', { de: 'Der Club der unsichtbaren Gelehrten' }]])
  const series = parseSeries({ results: { bindings: [{ s: { value: 'http://www.wikidata.org/entity/Q54875383' }, label_de: { value: 'Die Zauberer' }, label_mul: { value: 'Unseen University' } }] } }, ['en', 'de'])
  assertEquals(series[0]?.name, 'Unseen University')
})

Deno.test('a split volume is "<novel>, part N" at a decimal position of the novel\'s series', () => {
  const novel = { title: 'The Dragonbone Chair', titles: { de: 'Der Drachenbeinthron' } }
  const part = (title: string) => ({ title, titles: {} })
  assertEquals(isPartTitle('The Dragonbone Chair, part 1', 'The Dragonbone Chair'), true)
  assertEquals(isPartTitle('To Green Angel Tower, Part 12', 'To Green Angel Tower'), true)
  assertEquals(isPartTitle('The Dragonbone Chair, part', 'The Dragonbone Chair'), false)
  assertEquals(isPartTitle('The Dragonbone Chair, part 1: the sequel', 'The Dragonbone Chair'), false)
  assertEquals(isPartTitle('The Dragonbone Chair', 'The Dragonbone Chair'), false)
  assertEquals(isSplitVolume(part('The Dragonbone Chair, part 1'), 1.1, [novel]), true)
  // The novel's title in another language counts too (a German-first deployment).
  assertEquals(isSplitVolume(part('Der Drachenbeinthron, part 2'), 1.2, [novel]), true)
  // A whole position is a novel, whatever it is called.
  assertEquals(isSplitVolume(part('The Dragonbone Chair, part 1'), 1, [novel]), false)
  assertEquals(isSplitVolume(part('The Dragonbone Chair, part 1'), null, [novel]), false)
  // No parent at that position: a decimal alone is a novella between two novels.
  assertEquals(isSplitVolume(part('A War of Gifts'), 1.5, []), false)
  assertEquals(isSplitVolume(part('Rapport'), 7.5, [part('Network Effect')]), false)
  assertEquals(isSplitVolume(part('The Heart of What Was Lost'), 0.5, []), false)
})

Deno.test('the split volumes of a list are left out, the decimal novellas and everything else stay', () => {
  const work = (qid: string, title: string, position: number | null, series = 'Q1') => ({
    qid,
    title,
    titles: {},
    series: [{ series, position, follows: null, followedBy: null }],
  })
  const list = [
    work('Q1', 'The Dragonbone Chair', 1),
    work('Q2', 'The Dragonbone Chair, part 1', 1.1),
    work('Q3', 'The Dragonbone Chair, part 2', 1.2),
    work('Q4', 'Stone of Farewell', 2),
    work('Q5', 'Stone of Farewell, part 1', 2.1),
    // A decimal that is a novella, and one named like a part whose novel is in another series.
    work('Q6', 'A War of Gifts', 1.5, 'Q9'),
    work('Q7', 'Ender\u2019s Game', 1, 'Q9'),
    work('Q8', 'The Dragonbone Chair, part 3', 1.3, 'Q10'),
    work('Q11', 'Rapport', 7.5, 'Q12'),
    work('Q13', 'The Dragonbone Chair, part 4', null),
  ]
  assertEquals(withoutSplitVolumes(list).map((w) => w.qid), ['Q1', 'Q4', 'Q6', 'Q7', 'Q8', 'Q11', 'Q13'])
})

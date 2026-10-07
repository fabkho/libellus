/**
 * Wikidata (CC0): the URLs the function asks and the parsing of the answers.
 * Pure, no I/O.
 *
 *   wbgetentities   a work (P31 kind, P7937 form, P50 authors, P179 series with
 *                   P1545 ordinal, P136 genres, P577 date, P648 Open Library ids,
 *                   P629 edition-of) or an author (P18 image, P569/P570 life dates,
 *                   P648, sitelinks to Wikipedia)
 *   search          `haswbstatement:P648=OL…W` (a work by its Open Library key),
 *                   `<title> haswbstatement:P50=Q…` (a work by title and author)
 *   SPARQL          an author's works, a series' works, with their series
 */

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
export const SPARQL_ACCEPT = 'application/sparql-results+json'

const QID = /^Q[1-9][0-9]{0,11}$/

export function isQid(value: unknown): value is string {
  return typeof value === 'string' && QID.test(value)
}

// ------------------------------------------------------------------- URLs

export function searchUrl(query: string, limit = 5): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: String(limit),
    srprop: '',
    format: 'json',
    formatversion: '2',
  })
  return `${WIKIDATA_API}?${params}`
}

export function entitiesUrl(ids: readonly string[], props: readonly string[], languages: readonly string[]): string {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: [...ids].sort().join('|'),
    props: props.join('|'),
    languages: languages.join('|'),
    format: 'json',
    formatversion: '2',
  })
  if (props.includes('sitelinks')) params.set('sitefilter', languages.map((lang) => `${lang}wiki`).join('|'))
  return `${WIKIDATA_API}?${params}`
}

export function sparqlUrl(query: string): string {
  return `${WIKIDATA_SPARQL}?${new URLSearchParams({ query: query.replace(/\s+/g, ' ').trim(), format: 'json' })}`
}

// --------------------------------------------------------------- answers

type Snak = { snaktype?: string; datavalue?: { value?: unknown; type?: string } }
type Claim = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }
export type Entity = {
  id?: string
  missing?: string
  labels?: Record<string, { value?: string }>
  claims?: Record<string, Claim[]>
  sitelinks?: Record<string, { title?: string }>
}

/** The Q-ids of a search answer, best first. */
export function parseSearch(body: unknown): string[] {
  const hits = (body as { query?: { search?: { title?: string }[] } })?.query?.search
  return Array.isArray(hits) ? hits.map((hit) => hit.title).filter(isQid) : []
}

/** The entities of a wbgetentities answer, by id (missing ones left out). */
export function parseEntities(body: unknown): Map<string, Entity> {
  const entities = (body as { entities?: Record<string, Entity> | Entity[] })?.entities
  const list = Array.isArray(entities) ? entities : Object.values(entities ?? {})
  return new Map(list.filter((e) => e && e.id && !('missing' in e)).map((e) => [e.id!, e]))
}

/** Claims of a property, preferred first, deprecated ones left out. */
function claims(entity: Entity, property: string): Claim[] {
  const list = entity.claims?.[property] ?? []
  return list
    .filter((claim) => claim.rank !== 'deprecated' && claim.mainsnak?.snaktype !== 'novalue')
    .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
}

function itemOf(snak: Snak | undefined): string | null {
  const value = snak?.datavalue?.value as { id?: string } | undefined
  return isQid(value?.id) ? value!.id! : null
}

function stringOf(snak: Snak | undefined): string | null {
  const value = snak?.datavalue?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function items(entity: Entity, property: string): string[] {
  return unique(claims(entity, property).map((claim) => itemOf(claim.mainsnak)).filter((id): id is string => id !== null))
}

export function strings(entity: Entity, property: string): string[] {
  return unique(claims(entity, property).map((claim) => stringOf(claim.mainsnak)).filter((s): s is string => s !== null))
}

export type WikiDate = { date: string; precision: 9 | 10 | 11 }

/**
 * A Wikidata time as a date and its precision (9 year, 10 month, 11 day);
 * coarser times (a decade) and dates before year 1 are left out.
 */
export function parseTime(value: unknown): WikiDate | null {
  const time = value as { time?: string; precision?: number } | undefined
  const match = time?.time?.match(/^\+(\d{1,4})-(\d{2})-(\d{2})T/)
  if (!match || !time?.precision || time.precision < 9) return null
  const precision = Math.min(time.precision, 11) as 9 | 10 | 11
  const year = match[1]!.padStart(4, '0')
  if (Number(year) < 1) return null
  const month = precision >= 10 && match[2] !== '00' ? match[2] : '01'
  const day = precision >= 11 && match[3] !== '00' ? match[3] : '01'
  return { date: `${year}-${month}-${day}`, precision }
}

function time(entity: Entity, property: string): WikiDate | null {
  for (const claim of claims(entity, property)) {
    const parsed = parseTime(claim.mainsnak?.datavalue?.value)
    if (parsed) return parsed
  }
  return null
}

/** "13" → 13, "2.5" → 2.5, "0" → 0; anything else ("1a", "II") → null. */
export function parseOrdinal(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim().replace(',', '.')
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null
  return Number(text)
}

export function label(entity: Entity, languages: readonly string[]): string | null {
  for (const lang of languages) {
    const value = entity.labels?.[lang]?.value?.trim()
    if (value) return value
  }
  const any = Object.values(entity.labels ?? {}).find((l) => l.value?.trim())
  return any?.value?.trim() ?? null
}

export function labels(entity: Entity, languages: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const lang of languages) {
    const value = entity.labels?.[lang]?.value?.trim()
    if (value) out[lang] = value
  }
  return out
}

// ------------------------------------------------------------------ works

/** P31 values of a version, edition or translation: not a work. */
export const EDITION_TYPES = new Set(['Q3331189', 'Q122731938'])
/** P31 values of a series (book series, novel series, trilogy, …): not a work either. */
export const SERIES_TYPES = new Set(['Q277759', 'Q1667921', 'Q614101', 'Q53815', 'Q13137339', 'Q7725310', 'Q105543609'])

export type WorkKind = 'novel' | 'novella' | 'collection' | 'short-story' | 'nonfiction' | 'poetry' | 'graphic' | 'other'

const KIND_BY_ITEM: Record<string, WorkKind> = {
  Q8261: 'novel', // novel
  Q12132683: 'novel', // science fiction novel
  Q59342621: 'novel', // fantasy novel
  Q20667180: 'novel', // horror novel
  Q208505: 'novel', // crime novel
  Q192239: 'novel', // historical novel
  Q149537: 'novella', // novella
  Q1279564: 'collection', // short story collection
  Q105420: 'collection', // anthology
  Q12106333: 'poetry', // poetry collection
  Q5185279: 'poetry', // poem
  Q49084: 'short-story', // short story
  Q725377: 'graphic', // graphic novel
  Q1004: 'graphic', // comic
  Q838795: 'graphic', // comic book? (comic strip)
  Q213051: 'nonfiction', // non-fiction
  Q36279: 'nonfiction', // biography
  Q4184: 'nonfiction', // autobiography
  Q112983: 'nonfiction', // memoir
  Q35760: 'nonfiction', // essay
  Q3739522: 'nonfiction', // self-help book
  Q995600: 'nonfiction', // popular science
}
/** Generic "a written work" items: a novel when its genre is fiction. */
const GENERIC_WORK = new Set(['Q7725634', 'Q47461344', 'Q571', 'Q17518461'])
/** P136 genres that make a generic written work a novel. */
const FICTION_GENRES = new Set([
  'Q24925', 'Q132311', 'Q8261', 'Q3238422', 'Q1057172', 'Q16575965', 'Q193606', 'Q5937792', 'Q186424', 'Q6585139',
  'Q858330', 'Q1196408', 'Q136472', 'Q111984153', 'Q1233720', 'Q9326077', 'Q38072107', 'Q15062348', 'Q468478',
  'Q174526', 'Q904447', 'Q725757', 'Q326439', 'Q1637212', 'Q5977103', 'Q21802675',
])

/** What kind of work, from its P31 types, P7937 forms and P136 genres. */
export function kindOf(types: readonly string[], forms: readonly string[], genres: readonly string[]): WorkKind | null {
  for (const id of [...forms, ...types, ...genres]) {
    const kind = KIND_BY_ITEM[id]
    if (kind && kind !== 'novel') return kind
  }
  for (const id of [...forms, ...types]) if (KIND_BY_ITEM[id] === 'novel') return 'novel'
  if (types.some((t) => GENERIC_WORK.has(t))) {
    if (genres.some((g) => KIND_BY_ITEM[g] === 'novel' || FICTION_GENRES.has(g))) return 'novel'
    return 'other'
  }
  return null
}

export type SeriesPlace = { series: string; position: number | null; follows: string | null; followedBy: string | null }

export type WorkFacts = {
  qid: string
  title: string | null
  titles: Record<string, string>
  types: string[]
  forms: string[]
  authors: string[]
  series: SeriesPlace[]
  genres: string[]
  year: number | null
  openLibraryIds: string[]
  /** P629: the work this item is an edition or translation of. */
  editionOf: string[]
  kind: WorkKind | null
}

export function parseWork(entity: Entity, languages: readonly string[]): WorkFacts {
  const types = items(entity, 'P31')
  const forms = items(entity, 'P7937')
  const genres = items(entity, 'P136')
  const series = claims(entity, 'P179')
    .map((claim): SeriesPlace | null => {
      const id = itemOf(claim.mainsnak)
      if (!id) return null
      return {
        series: id,
        position: parseOrdinal(stringOf(claim.qualifiers?.P1545?.[0])),
        follows: itemOf(claim.qualifiers?.P155?.[0]),
        followedBy: itemOf(claim.qualifiers?.P156?.[0]),
      }
    })
    .filter((place): place is SeriesPlace => place !== null)
  return {
    qid: entity.id!,
    title: label(entity, languages),
    titles: labels(entity, languages),
    types,
    forms,
    authors: items(entity, 'P50'),
    series: uniqueBy(series, (s) => s.series),
    genres,
    year: yearOf(time(entity, 'P577')),
    openLibraryIds: strings(entity, 'P648').filter((id) => /^OL\d+W$/.test(id)),
    editionOf: items(entity, 'P629'),
    kind: kindOf(types, forms, genres),
  }
}

export function isEdition(work: Pick<WorkFacts, 'types' | 'editionOf'>): boolean {
  return work.editionOf.length > 0 || work.types.some((type) => EDITION_TYPES.has(type))
}

// ---------------------------------------------------------------- authors

export type AuthorFacts = {
  qid: string
  name: string | null
  birth: WikiDate | null
  death: WikiDate | null
  /** The Commons file name of the portrait (P18). */
  image: string | null
  /** Wikipedia article title per language. */
  sitelinks: Record<string, string>
  openLibraryIds: string[]
}

/**
 * An author's facts in one small query (the full entity of a well-known
 * author is hundreds of kilobytes of identifiers): labels, portrait, life
 * dates with their precision, Open Library ids, Wikipedia articles.
 */
export function authorQuery(qid: string, languages: readonly string[]): string {
  const vars = languages.map((l) => `(SAMPLE(?l_${l}) AS ?label_${l}) (SAMPLE(?a_${l}) AS ?article_${l})`).join(' ')
  const patterns = languages
    .map((l) => `OPTIONAL { ?item rdfs:label ?l_${l} FILTER(LANG(?l_${l}) = "${l}") }
  OPTIONAL { ?a_${l} schema:about ?item; schema:isPartOf <https://${l}.wikipedia.org/> }`)
    .join('\n  ')
  return `SELECT ?item ${vars} (SAMPLE(?img) AS ?image)
  (SAMPLE(?b) AS ?birth) (SAMPLE(?bp) AS ?birthPrecision) (SAMPLE(?d) AS ?death) (SAMPLE(?dp) AS ?deathPrecision)
  (GROUP_CONCAT(DISTINCT ?ol; separator=" ") AS ?ols)
WHERE {
  VALUES ?item { wd:${qid} }
  ${patterns}
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item p:P569/psv:P569 [ wikibase:timeValue ?b; wikibase:timePrecision ?bp ] }
  OPTIONAL { ?item p:P570/psv:P570 [ wikibase:timeValue ?d; wikibase:timePrecision ?dp ] }
  OPTIONAL { ?item wdt:P648 ?ol }
} GROUP BY ?item`
}

export function parseAuthorFacts(body: unknown, languages: readonly string[]): AuthorFacts | null {
  const row = bindings(body)[0]
  const qid = row?.item?.value?.split('/').pop()
  if (!row || !isQid(qid)) return null
  const sitelinks: Record<string, string> = {}
  for (const lang of languages) {
    const article = row[`article_${lang}`]?.value
    const title = article?.split('/wiki/')[1]
    if (title) sitelinks[lang] = decodeURIComponent(title).replace(/_/g, ' ')
  }
  const image = row.image?.value?.split('/Special:FilePath/')[1]
  const date = (value?: string, precision?: string) =>
    value ? parseTime({ time: `+${value.replace(/^\+/, '')}`, precision: Number(precision) }) : null
  return {
    qid,
    name: languages.map((l) => row[`label_${l}`]?.value?.trim()).find(Boolean) ?? null,
    birth: date(row.birth?.value, row.birthPrecision?.value),
    death: date(row.death?.value, row.deathPrecision?.value),
    image: image ? decodeURIComponent(image) : null,
    sitelinks,
    openLibraryIds: words(row.ols?.value).filter((id) => /^OL\d+A$/.test(id)),
  }
}

// ----------------------------------------------------------------- SPARQL

/** The works the author wrote (P50), without editions and series items, with their facts and series. */
export function authorWorksQuery(qid: string, languages: readonly string[]): string {
  return worksQuery(`?work wdt:P50 wd:${qid} .`, languages)
}

/** Every work in these series (P179), with the same facts. */
export function seriesWorksQuery(seriesQids: readonly string[], languages: readonly string[]): string {
  return worksQuery(`VALUES ?inSeries { ${[...seriesQids].sort().map((q) => `wd:${q}`).join(' ')} } ?work wdt:P179 ?inSeries .`, languages)
}

function worksQuery(pattern: string, languages: readonly string[]): string {
  const labelVars = languages.map((lang) => `(SAMPLE(?l_${lang}) AS ?label_${lang})`).join(' ')
  const labelPatterns = languages
    .map((lang) => `OPTIONAL { ?work rdfs:label ?l_${lang} FILTER(LANG(?l_${lang}) = "${lang}") }`)
    .join(' ')
  return `SELECT ?work ${labelVars} (MIN(?date) AS ?published)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?type), "entity/"); separator=" ") AS ?types)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?form), "entity/"); separator=" ") AS ?forms)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?genre), "entity/"); separator=" ") AS ?genres)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?author), "entity/"); separator=" ") AS ?authors)
  (GROUP_CONCAT(DISTINCT ?ol; separator=" ") AS ?ols)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?series), "entity/"), "|", COALESCE(?ordinal, "")); separator=" ") AS ?series)
WHERE {
  ${pattern}
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q3331189 }
  FILTER NOT EXISTS { ?work wdt:P629 [] }
  ${labelPatterns}
  OPTIONAL { ?work wdt:P577 ?date }
  OPTIONAL { ?work wdt:P31 ?type }
  OPTIONAL { ?work wdt:P7937 ?form }
  OPTIONAL { ?work wdt:P136 ?genre }
  OPTIONAL { ?work wdt:P50 ?author }
  OPTIONAL { ?work wdt:P648 ?ol }
  OPTIONAL { ?work p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ordinal } }
} GROUP BY ?work`
}

/** Names of series items, in the languages, and the series each is part of. */
export function seriesQuery(seriesQids: readonly string[], languages: readonly string[]): string {
  const labelVars = languages.map((lang) => `(SAMPLE(?l_${lang}) AS ?label_${lang})`).join(' ')
  const labelPatterns = languages
    .map((lang) => `OPTIONAL { ?s rdfs:label ?l_${lang} FILTER(LANG(?l_${lang}) = "${lang}") }`)
    .join(' ')
  const parentLabels = languages
    .map((lang) => `OPTIONAL { ?parent rdfs:label ?pl_${lang} FILTER(LANG(?pl_${lang}) = "${lang}") }`)
    .join(' ')
  const parentVars = languages.map((lang) => `(SAMPLE(?pl_${lang}) AS ?parent_${lang})`).join(' ')
  return `SELECT ?s ${labelVars} (SAMPLE(?parent) AS ?parentItem) ${parentVars}
WHERE {
  VALUES ?s { ${[...seriesQids].sort().map((q) => `wd:${q}`).join(' ')} }
  ${labelPatterns}
  OPTIONAL { ?s wdt:P179 ?parent . ${parentLabels} }
} GROUP BY ?s`
}

type Binding = Record<string, { value?: string } | undefined>

function bindings(body: unknown): Binding[] {
  const rows = (body as { results?: { bindings?: Binding[] } })?.results?.bindings
  return Array.isArray(rows) ? rows : []
}

function words(value: string | undefined): string[] {
  return (value ?? '').split(' ').filter(Boolean)
}

export type ListedWork = WorkFacts

/** The rows of authorWorksQuery / seriesWorksQuery as works. Unlabelled items and series items are left out. */
export function parseWorks(body: unknown, languages: readonly string[]): ListedWork[] {
  const works: ListedWork[] = []
  for (const row of bindings(body)) {
    const qid = row.work?.value?.split('/').pop()
    if (!isQid(qid)) continue
    const titles: Record<string, string> = {}
    for (const lang of languages) {
      const value = row[`label_${lang}`]?.value?.trim()
      if (value) titles[lang] = value
    }
    const title = languages.map((lang) => titles[lang]).find(Boolean) ?? null
    const types = words(row.types?.value).filter(isQid)
    if (!title || types.some((t) => SERIES_TYPES.has(t) || EDITION_TYPES.has(t))) continue
    const forms = words(row.forms?.value).filter(isQid)
    const genres = words(row.genres?.value).filter(isQid)
    const series = words(row.series?.value)
      .map((pair): SeriesPlace | null => {
        const [id, ordinal] = pair.split('|')
        return isQid(id) ? { series: id, position: parseOrdinal(ordinal), follows: null, followedBy: null } : null
      })
      .filter((s): s is SeriesPlace => s !== null)
    works.push({
      qid,
      title,
      titles,
      types,
      forms,
      authors: words(row.authors?.value).filter(isQid),
      series: uniqueBy(series, (s) => s.series),
      genres,
      year: yearOf(parseTime({ time: row.published?.value ? `+${row.published.value.replace(/^\+/, '')}` : undefined, precision: 9 })),
      openLibraryIds: words(row.ols?.value).filter((id) => /^OL\d+W$/.test(id)),
      editionOf: [],
      kind: kindOf(types, forms, genres),
    })
  }
  return works
}

export type SeriesFacts = {
  qid: string
  name: string | null
  parent: { qid: string; name: string | null } | null
}

export function parseSeries(body: unknown, languages: readonly string[]): SeriesFacts[] {
  return bindings(body)
    .map((row) => {
      const qid = row.s?.value?.split('/').pop()
      if (!isQid(qid)) return null
      const name = languages.map((lang) => row[`label_${lang}`]?.value?.trim()).find(Boolean) ?? null
      const parentQid = row.parentItem?.value?.split('/').pop()
      return {
        qid,
        name,
        parent: isQid(parentQid) && parentQid !== qid
          ? { qid: parentQid, name: languages.map((lang) => row[`parent_${lang}`]?.value?.trim()).find(Boolean) ?? null }
          : null,
      }
    })
    .filter((s): s is SeriesFacts => s !== null)
}

// ------------------------------------------------------------------ helpers

function yearOf(date: WikiDate | null): number | null {
  return date ? Number(date.date.slice(0, 4)) : null
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)]
}

function uniqueBy<T>(list: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)))
}

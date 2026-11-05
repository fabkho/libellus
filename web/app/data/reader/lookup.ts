/**
 * Translate and Define for selected words in the reader (#131 phase 2).
 * Framework-free: `fetch` (and the browser's own translator, where there is
 * one) come in as arguments, as the search repository's, so Vitest drives them
 * with recorded answers and a native port reimplements them 1:1.
 *
 * Translate, in order:
 *  1. The browser's on-device translator (Chrome's Translator API: free,
 *     private, offline once its model is there; desktop Chrome only today).
 *  2. MyMemory (translated.net): free, no key, called from the app (CORS);
 *     5,000 characters a day per device, 500 bytes a request, so a passage goes
 *     sentence by sentence. A keyed service behind a Supabase Edge Function
 *     (DeepL's free tier) can take its place without the app changing.
 * Define: English Wiktionary's definitions (free, no key, CORS; CC BY-SA, so
 * the sheet credits it), the book's own language first.
 *
 * Only the selected words leave the device, never the book.
 */
export type Fetch = typeof fetch

/**
 * offline: no connection. quota: the day's free translations are used up.
 * failed: the service or the network let us down. empty: it answered with nothing.
 * same: the text is already in the target language (only seen when the book's language is unknown).
 */
export type LookupError = 'offline' | 'quota' | 'failed' | 'empty' | 'same'

export interface Translation {
  text: string
  /** Who translated: the browser itself, or the service. */
  provider: 'device' | 'service'
  /** The language the service recognised, when the book's own was unknown (ISO 639-1). */
  detected?: string
}

export interface Sense {
  definition: string
  examples: string[]
}
export interface Entry {
  partOfSpeech: string
  senses: Sense[]
}
export interface Definition {
  word: string
  language: string
  entries: Entry[]
}

/** The browser's on-device translator, if any (Chrome's `Translator`). */
export type DeviceTranslator = {
  availability: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
  create: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<{ translate: (t: string) => Promise<string> }>
}

/** ISO 639-2/3 codes EPUB metadata uses (both the B and the T form), to ISO 639-1, for the common languages. */
const ISO3: Record<string, string> = {
  eng: 'en', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es', ita: 'it', nld: 'nl', dut: 'nl', por: 'pt',
  rus: 'ru', pol: 'pl', ces: 'cs', cze: 'cs', slk: 'sk', slo: 'sk', hun: 'hu', ron: 'ro', rum: 'ro', bul: 'bg',
  ukr: 'uk', ell: 'el', gre: 'el', tur: 'tr', swe: 'sv', dan: 'da', nor: 'no', nob: 'nb', nno: 'nn', fin: 'fi',
  isl: 'is', ice: 'is', cat: 'ca', hrv: 'hr', srp: 'sr', slv: 'sl', lit: 'lt', lav: 'lv', est: 'et',
  zho: 'zh', chi: 'zh', jpn: 'ja', kor: 'ko', ara: 'ar', heb: 'he', fas: 'fa', per: 'fa', hin: 'hi',
  tha: 'th', vie: 'vi', ind: 'id', msa: 'ms', may: 'ms', lat: 'la', gle: 'ga', eus: 'eu', baq: 'eu', glg: 'gl',
}

/**
 * A language tag from a book (EPUB `dc:language`, "en", "eng", "de_DE", "pt-BR", "zh-Hans") as MyMemory wants
 * a source: two letters, or two letters and a region ("pt-BR"). `null` for what names no language: empty,
 * "und" (undetermined), "mul" (several), "zxx" (none) and anything unknown. A `null` is never sent as a language.
 */
export function sourceLanguage(tag: string | null | undefined): string | null {
  const parts = (tag ?? '').trim().replace(/_/g, '-').toLowerCase().split('-').filter(Boolean)
  const primary = parts[0] ?? ''
  const language = primary.length === 3 ? ISO3[primary] : /^[a-z]{2}$/.test(primary) ? primary : undefined
  if (!language) return null
  const rest = parts.slice(1)
  const script = rest.find((p) => /^[a-z]{4}$/.test(p))
  const region = rest.find((p) => /^[a-z]{2}$/.test(p))
  if (region) return `${language}-${region.toUpperCase()}`
  if (language === 'zh' && script) return script === 'hans' ? 'zh-CN' : script === 'hant' ? 'zh-TW' : 'zh'
  return language
}

/** The two-letter language of a tag ("pt-BR" is "pt"; unknown is ""). */
export function baseLanguage(tag: string | null | undefined): string {
  return sourceLanguage(tag)?.split('-')[0] ?? ''
}

/** MyMemory's word for "work it out from the text". */
const AUTODETECT = 'Autodetect'

/** What MyMemory's answer means. It reports most refusals as a 200 with a `responseStatus` in the body, and puts its own message where the translation goes. */
type Answer = { responseData?: { translatedText?: string; detectedLanguage?: string }; responseDetails?: string; quotaFinished?: boolean | null; responseStatus?: number | string }

function failureOf(body: Answer): LookupError | 'language' | null {
  const status = Number(body.responseStatus ?? 200)
  const said = `${body.responseDetails ?? ''} ${body.responseData?.translatedText ?? ''}`.toUpperCase()
  if (body.quotaFinished || status === 429 || said.includes('MYMEMORY WARNING')) return 'quota'
  if (status === 200 || Number.isNaN(status)) return null
  if (said.includes('DISTINCT LANGUAGES')) return 'same'
  if (said.includes('INVALID SOURCE LANGUAGE') || said.includes('INVALID TARGET LANGUAGE') || said.includes('LANGPAIR')) return 'language'
  return 'failed'
}

/** The languages Translate offers as a target (ISO 639-1), in the order shown. */
export const TARGET_LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pt'] as const

/** The target the device asks for first: its own language, unless that is the book's (then German, or English for a German book). */
export function defaultTarget(deviceLanguage: string, bookLanguage: string): string {
  const device = (deviceLanguage || 'en').split('-')[0]!.toLowerCase()
  if (device !== bookLanguage) return device
  return bookLanguage === 'de' ? 'en' : 'de'
}

/** Sentences packed into pieces of at most `max` UTF-8 bytes (MyMemory takes 500). */
export function piecesOf(text: string, max = 450): string[] {
  const bytes = (s: string) => new TextEncoder().encode(s).length
  // A sentence longer than a piece is cut between words.
  const sentences = (text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text]).flatMap((sentence) => (bytes(sentence) > max ? sentence.match(/\S+\s*/g) ?? [sentence] : [sentence]))
  const pieces: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (bytes(current + sentence) > max && current) {
      pieces.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim()) pieces.push(current.trim())
  return pieces
}

async function onDevice(device: DeviceTranslator | null, text: string, from: string, to: string): Promise<string | null> {
  if (!device) return null
  try {
    if ((await device.availability({ sourceLanguage: from, targetLanguage: to })) !== 'available') return null
    const translator = await device.create({ sourceLanguage: from, targetLanguage: to })
    return await translator.translate(text)
  } catch {
    return null
  }
}

export type LookupResult<T> = { data: T; error: null } | { data: null; error: LookupError }

export async function translate(
  fetcher: Fetch,
  text: string,
  from: string,
  to: string,
  { device = null, online = () => true, signal }: { device?: DeviceTranslator | null; online?: () => boolean; signal?: AbortSignal } = {},
): Promise<LookupResult<Translation>> {
  const source = sourceLanguage(from)
  const target = baseLanguage(to) || to
  if (source && baseLanguage(source) === target) return { data: { text, provider: 'device' }, error: null }
  // On-device needs a known source; an unknown one goes to the service, which finds it out.
  const local = source ? await onDevice(device, text, source.split('-')[0]!, target) : null
  if (local) return { data: { text: local, provider: 'device' }, error: null }
  if (!online()) return { data: null, error: 'offline' }
  const out: string[] = []
  let detected: string | undefined
  let pair = source ?? AUTODETECT
  try {
    for (const piece of piecesOf(text)) {
      let body: Answer
      let failure: ReturnType<typeof failureOf>
      // A source the service does not know is asked again once, by its own detection.
      for (let attempt = 0; ; attempt++) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${pair}|${target}`
        const response = await fetcher(url, { signal })
        if (response.status === 429) return { data: null, error: 'quota' }
        if (!response.ok) return { data: null, error: 'failed' }
        body = (await response.json()) as Answer
        failure = failureOf(body)
        if (failure === 'language' && pair !== AUTODETECT && attempt === 0) {
          pair = AUTODETECT
          continue
        }
        break
      }
      if (failure) return { data: null, error: failure === 'language' ? 'failed' : failure }
      detected ??= baseLanguage(body.responseData?.detectedLanguage) || undefined
      out.push(body.responseData?.translatedText ?? '')
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { data: null, error: online() ? 'failed' : 'offline' }
  }
  const joined = out.join(' ').trim()
  if (!joined) return { data: null, error: 'empty' }
  return { data: { text: joined, provider: 'service', ...(!source && detected ? { detected } : {}) }, error: null }
}

/** A word as a dictionary heads it: no surrounding punctuation or quotes, no possessive. */
export function headwordOf(selection: string): string {
  return selection
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[’']s$/u, '')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Wiktionary's HTML in a definition, as plain text (no DOM: it runs in Node too). */
export function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (whole, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)))
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a selection is a word (or two: "fret saw") worth a dictionary, rather than a passage. */
export function isDefinable(selection: string): boolean {
  const words = selection.trim().split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 2 && selection.trim().length <= 40
}

export async function define(
  fetcher: Fetch,
  selection: string,
  language: string,
  { online = () => true, signal }: { online?: () => boolean; signal?: AbortSignal } = {},
): Promise<LookupResult<Definition | null>> {
  const word = headwordOf(selection)
  if (!word) return { data: null, error: null }
  if (!online()) return { data: null, error: 'offline' }
  try {
    for (const candidate of [...new Set([word, word.toLowerCase()])]) {
      const response = await fetcher(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(candidate)}`, {
        signal,
        headers: { 'Api-User-Agent': 'Libellus (https://github.com/fabkho/libellus)' },
      })
      if (response.status === 404) continue
      if (!response.ok) return { data: null, error: 'failed' }
      const body = (await response.json()) as Record<string, { partOfSpeech: string; definitions: { definition: string; examples?: string[] }[] }[]>
      const lang = body[language] ? language : body.en ? 'en' : Object.keys(body)[0]
      if (!lang) continue
      const entries = body[lang]!.map((e) => ({
        partOfSpeech: e.partOfSpeech,
        senses: e.definitions
          .map((d) => ({ definition: plain(d.definition), examples: (d.examples ?? []).map(plain).filter(Boolean).slice(0, 1) }))
          .filter((d) => d.definition),
      })).filter((e) => e.senses.length)
      if (entries.length) return { data: { word: candidate, language: lang, entries }, error: null }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { data: null, error: online() ? 'failed' : 'offline' }
  }
  return { data: null, error: null }
}

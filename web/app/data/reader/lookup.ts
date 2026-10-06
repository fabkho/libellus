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

export type LookupError = 'offline' | 'quota' | 'failed'

export interface Translation {
  text: string
  /** Who translated: the browser itself, or the service. */
  provider: 'device' | 'service'
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
  if (from === to) return { data: { text, provider: 'device' }, error: null }
  const local = await onDevice(device, text, from, to)
  if (local) return { data: { text: local, provider: 'device' }, error: null }
  if (!online()) return { data: null, error: 'offline' }
  const out: string[] = []
  try {
    for (const piece of piecesOf(text)) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${from}|${to}`
      const response = await fetcher(url, { signal })
      if (response.status === 429) return { data: null, error: 'quota' }
      if (!response.ok) return { data: null, error: 'failed' }
      const body = (await response.json()) as { responseData?: { translatedText?: string }; quotaFinished?: boolean; responseStatus?: number | string }
      if (body.quotaFinished || Number(body.responseStatus) === 429) return { data: null, error: 'quota' }
      out.push(body.responseData?.translatedText ?? '')
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return { data: null, error: online() ? 'failed' : 'offline' }
  }
  return { data: { text: out.join(' ').trim(), provider: 'service' }, error: null }
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

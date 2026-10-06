/**
 * Translate and Define for the selection menu (#131 phase 2 design round).
 * Framework-free; `fetch` comes in as an argument like the app's search
 * repository, so a test can hand it recordings.
 *
 * Translate, in order:
 *  1. The browser's own on-device translator (Chrome's Translator API: free,
 *     private, offline once its model is down — desktop Chrome only today).
 *  2. Prototype: MyMemory (free, no key, CORS; 5,000 characters a day per
 *     device anonymously, 50,000 with an email; 500 bytes per request, so long
 *     passages go sentence by sentence).
 *     Production: a Supabase Edge Function `translate` holding the provider's
 *     key (COMPARE.md, Translator), so no key is ever in the app.
 * Define: English Wiktionary's definitions (free, no key, CORS, CC BY-SA:
 * attributed in the sheet), entries in the book's own language first.
 */
export type Fetch = typeof fetch

export interface Translation {
  text: string
  provider: 'device' | 'mymemory'
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

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pt', name: 'Português' },
]
export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
}

type TranslatorApi = {
  availability: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
  create: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<{ translate: (t: string) => Promise<string> }>
}

async function onDevice(text: string, from: string, to: string): Promise<string | null> {
  const api = (globalThis as unknown as { Translator?: TranslatorApi }).Translator
  if (!api) return null
  try {
    const state = await api.availability({ sourceLanguage: from, targetLanguage: to })
    if (state !== 'available') return null
    const translator = await api.create({ sourceLanguage: from, targetLanguage: to })
    return await translator.translate(text)
  } catch {
    return null
  }
}

/** Sentences packed into pieces of at most `max` UTF-8 bytes (MyMemory's limit is 500). */
export function piecesOf(text: string, max = 450): string[] {
  const bytes = (s: string) => new TextEncoder().encode(s).length
  const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text]
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

export async function translate(fetcher: Fetch, text: string, from: string, to: string, signal?: AbortSignal): Promise<Translation> {
  const local = await onDevice(text, from, to)
  if (local) return { text: local, provider: 'device' }
  const out: string[] = []
  for (const piece of piecesOf(text)) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${from}|${to}`
    const response = await fetcher(url, { signal })
    if (!response.ok) throw new Error(`translate_${response.status}`)
    const body = (await response.json()) as { responseData?: { translatedText?: string }; quotaFinished?: boolean; responseStatus?: number }
    if (body.quotaFinished || body.responseStatus === 429) throw new Error('translate_quota')
    out.push(body.responseData?.translatedText ?? '')
  }
  return { text: out.join(' ').trim(), provider: 'mymemory' }
}

/** A word as a dictionary wants it: no surrounding punctuation or quotes, lower case unless that loses the entry. */
export function headwordOf(selection: string): string {
  return selection.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/u, '')
}

/** Wiktionary's HTML in a definition, as plain text. */
export function plain(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export async function define(fetcher: Fetch, selection: string, language: string, signal?: AbortSignal): Promise<Definition | null> {
  const word = headwordOf(selection)
  if (!word) return null
  for (const candidate of [...new Set([word, word.toLowerCase()])]) {
    const response = await fetcher(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(candidate)}`, {
      signal,
      headers: { 'Api-User-Agent': 'Libellus reader prototype (https://github.com/fabkho/libellus)' },
    })
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`define_${response.status}`)
    const body = (await response.json()) as Record<string, { partOfSpeech: string; language: string; definitions: { definition: string; examples?: string[] }[] }[]>
    const lang = body[language] ? language : body.en ? 'en' : Object.keys(body)[0]
    if (!lang) continue
    const entries = body[lang]!.map((e) => ({
      partOfSpeech: e.partOfSpeech,
      senses: e.definitions
        .map((d) => ({ definition: plain(d.definition), examples: (d.examples ?? []).map(plain).filter(Boolean).slice(0, 1) }))
        .filter((d) => d.definition),
    })).filter((e) => e.senses.length)
    if (entries.length) return { word: candidate, language: lang, entries }
  }
  return null
}

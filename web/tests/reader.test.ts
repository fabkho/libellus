import { describe, expect, it } from 'vitest'
import { openingPlace, readHighlights, readPlace, writeHighlights, writePlace, type Place } from '../app/data/reader/device'
import { defaultTarget, define, headwordOf, isDefinable, piecesOf, plain, translate, type DeviceTranslator, type Fetch } from '../app/data/reader/lookup'
import { isAhead, progressAt, ProgressWriter, type Timers } from '../app/data/reader/progress'
import { DEFAULT_SETTINGS, parseSettings, readSettings, READER_SETTINGS_KEY, writeSettings } from '../app/data/reader/settings'

/**
 * The built-in reader's data layer (#131, phase 2): its settings, how progress
 * is written, the place and highlights kept on the device, Translate and
 * Define (answers recorded in the shape MyMemory and Wiktionary give, through
 * the injectable `fetch`). What a book's pages lose: tests/reader-markup.test.ts.
 */

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('reader settings', () => {
  it('starts on the printed page, in pages, sepia', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toMatchObject({ style: 'printed', flow: 'pages', theme: 'sepia' })
  })

  it('keeps every valid field and drops the rest to the default', () => {
    const raw = JSON.stringify({ style: 'classic', flow: 'scroll', theme: 'dark', size: 6, leading: 9, margins: -1, justify: 'yes', translateTo: 'fr', extra: 1 })
    expect(parseSettings(raw)).toEqual({ ...DEFAULT_SETTINGS, style: 'classic', flow: 'scroll', theme: 'dark', size: 6, translateTo: 'fr' })
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(JSON.stringify({ translateTo: 'french' })).translateTo).toBeNull()
  })

  it('round-trips through storage under a key signing out leaves alone', () => {
    const storage = memoryStorage()
    writeSettings(storage, { ...DEFAULT_SETTINGS, style: 'classic' })
    expect(READER_SETTINGS_KEY.startsWith('libellus.')).toBe(false)
    expect(readSettings(storage).style).toBe('classic')
  })
})

describe('reader progress', () => {
  it('is a page of the page count (at least 1 once begun), else a percent', () => {
    expect(progressAt(0, 300)).toEqual({ page: 0 })
    expect(progressAt(0.001, 300)).toEqual({ page: 1 })
    expect(progressAt(0.5, 300)).toEqual({ page: 150 })
    expect(progressAt(1.2, 300)).toEqual({ page: 300 })
    expect(progressAt(0.334, null)).toEqual({ percent: 33 })
  })

  it('only ever goes forward, across units too', () => {
    expect(isAhead({ page: 10 }, null, 100)).toBe(true)
    expect(isAhead({ page: 0 }, null, 100)).toBe(false)
    expect(isAhead({ page: 10 }, { page: 12 }, 100)).toBe(false)
    expect(isAhead({ percent: 40 }, { page: 30 }, 100)).toBe(true)
    expect(isAhead({ page: 30 }, { percent: 40 }, 100)).toBe(false)
  })

  function fakeTimers() {
    let now = 0
    let queue: { at: number; fn: () => void; id: number }[] = []
    let next = 0
    const timers: Timers = {
      set: (fn, ms) => {
        const id = next++
        queue.push({ at: now + ms, fn, id })
        return id
      },
      clear: (id) => (queue = queue.filter((t) => t.id !== id)),
      now: () => now,
    }
    const advance = (ms: number) => {
      now += ms
      const due = queue.filter((t) => t.at <= now)
      queue = queue.filter((t) => t.at > now)
      due.forEach((t) => t.fn())
    }
    return { timers, advance }
  }

  function writerWith(current: { value: { page: number } | null }, enabled = true) {
    const { timers, advance } = fakeTimers()
    const written: unknown[] = []
    const writer = new ProgressWriter({
      current: () => current.value,
      pageCount: () => 100,
      enabled: () => enabled,
      write: (value) => {
        written.push(value)
        current.value = value as { page: number }
      },
      policy: { idleMs: 10_000, minIntervalMs: 60_000 },
      timers,
    })
    return { writer, written, advance }
  }

  it('writes once the member rests on a place, at most once a minute, and at once on closing', () => {
    const { writer, written, advance } = writerWith({ value: { page: 5 } })
    writer.reading()
    writer.saw(0.1)
    advance(9_000)
    expect(written).toEqual([])
    advance(1_000)
    expect(written).toEqual([{ page: 10 }])
    writer.saw(0.12)
    advance(10_000)
    expect(written).toHaveLength(1)
    advance(50_000)
    expect(written).toEqual([{ page: 10 }, { page: 12 }])
    writer.saw(0.2)
    writer.flush()
    expect(written.at(-1)).toEqual({ page: 20 })
  })

  it('leaves opening the book, a look-up, a place behind and a read not under way alone', () => {
    const opened = writerWith({ value: { page: 50 } })
    opened.writer.saw(0.6)
    opened.writer.flush()
    expect(opened.written).toEqual([])

    opened.writer.reading()
    opened.writer.saw(0.4)
    opened.writer.flush()
    expect(opened.written).toEqual([])

    opened.writer.lookingUp()
    opened.writer.saw(0.9)
    opened.advance(100_000)
    expect(opened.written).toEqual([])

    const wanted = writerWith({ value: null }, false)
    wanted.writer.reading()
    wanted.writer.saw(0.3)
    wanted.writer.flush()
    expect(wanted.written).toEqual([])
  })
})

describe('the place and highlights on the device', () => {
  const place = (at: string, fileHash: string, fraction = 0.4): Place => ({ cfi: `epubcfi(/6/4!/4/${fraction * 10})`, fraction, fileHash, at })

  it('opens at the newer place: its CFI for the same copy, else its fraction', () => {
    const local = place('2026-10-06T10:00:00Z', 'a', 0.2)
    const remote = place('2026-10-06T11:00:00Z', 'a', 0.5)
    expect(openingPlace(local, remote, 'a')).toEqual({ cfi: remote.cfi })
    expect(openingPlace(local, remote, 'b')).toEqual({ fraction: 0.5 })
    expect(openingPlace(local, null, 'a')).toEqual({ cfi: local.cfi })
    expect(openingPlace(null, null, 'a')).toBeNull()
  })

  it('keeps them per member and entry, under the prefix signing out clears', () => {
    const storage = memoryStorage()
    writePlace(storage, 'm1', 'e1', place('2026-10-06T10:00:00Z', 'a'))
    writeHighlights(storage, 'm1', 'e1', [{ cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', color: 'sage', text: 'Gregor', index: 1 }])
    expect(readPlace(storage, 'm1', 'e1')?.fileHash).toBe('a')
    expect(readPlace(storage, 'm2', 'e1')).toBeNull()
    expect(readHighlights(storage, 'm1', 'e1')).toHaveLength(1)
    expect([...storage.map.keys()].every((key) => key.startsWith('libellus.'))).toBe(true)
    writeHighlights(storage, 'm1', 'e1', [])
    expect(readHighlights(storage, 'm1', 'e1')).toEqual([])
  })

  it('drops what is not a highlight', () => {
    const storage = memoryStorage()
    storage.setItem('libellus.reader.highlights.m1.e1', JSON.stringify([{ cfi: 'x', color: 'neon', text: 't', index: 0 }, { cfi: 'y', color: 'sky', text: 't', index: 2 }]))
    expect(readHighlights(storage, 'm1', 'e1').map((h) => h.cfi)).toEqual(['y'])
  })
})

/** A `fetch` answering from a table of recorded responses; it remembers what was asked. */
function recorded(answer: (url: string) => { status: number; body?: unknown }) {
  const asked: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    asked.push(url)
    const { status, body } = answer(url)
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as Fetch
  return { fetcher, asked }
}

describe('Translate', () => {
  it('asks the browser first, and only then the service', async () => {
    const device: DeviceTranslator = {
      availability: async () => 'available',
      create: async () => ({ translate: async (text) => `[de] ${text}` }),
    }
    const { fetcher, asked } = recorded(() => ({ status: 500 }))
    expect(await translate(fetcher, 'One morning', 'en', 'de', { device })).toEqual({ data: { text: '[de] One morning', provider: 'device' }, error: null })
    expect(asked).toEqual([])
  })

  it('sends long passages in pieces of whole sentences and joins the answers', async () => {
    const sentence = 'He lay on his armour-like back, and if he lifted his head a little he could see his brown belly. '
    const text = sentence.repeat(10)
    expect(piecesOf(text).every((piece) => new TextEncoder().encode(piece).length <= 450)).toBe(true)
    expect(piecesOf(text).join(' ')).toBe(text.trim())
    expect(piecesOf('word '.repeat(200)).every((piece) => piece.length <= 450)).toBe(true)

    const { fetcher, asked } = recorded(() => ({ status: 200, body: { responseData: { translatedText: 'Er lag.' }, responseStatus: 200 } }))
    const answer = await translate(fetcher, text, 'en', 'de')
    expect(asked.length).toBe(piecesOf(text).length)
    expect(asked[0]).toContain('api.mymemory.translated.net/get?q=')
    expect(asked[0]).toContain('langpair=en|de')
    expect(answer.data?.provider).toBe('service')
    expect(answer.data?.text).toBe(Array(asked.length).fill('Er lag.').join(' '))
  })

  it('says when the day’s quota is used up, or there is no connection', async () => {
    const quota = recorded(() => ({ status: 200, body: { responseData: { translatedText: 'MYMEMORY WARNING' }, quotaFinished: true, responseStatus: 429 } }))
    expect((await translate(quota.fetcher, 'Hello', 'en', 'de')).error).toBe('quota')
    const offline = recorded(() => ({ status: 200 }))
    expect(await translate(offline.fetcher, 'Hello', 'en', 'de', { online: () => false })).toEqual({ data: null, error: 'offline' })
    expect(offline.asked).toEqual([])
  })

  it('goes into the device’s language, or another one for a book in it', () => {
    expect(defaultTarget('de-DE', 'en')).toBe('de')
    expect(defaultTarget('en-GB', 'en')).toBe('de')
    expect(defaultTarget('de', 'de')).toBe('en')
  })
})

describe('Define', () => {
  const wiktionary = {
    en: [
      {
        partOfSpeech: 'Noun',
        definitions: [
          { definition: 'Any <a href="/wiki/insect">insect</a> or animal regarded as &quot;unpleasant&quot;.', examples: ['<i>The barn was overrun with vermin.</i>'] },
          { definition: '' },
        ],
      },
    ],
  }

  it('heads the word as a dictionary does and reads Wiktionary’s answer as plain text', async () => {
    const { fetcher, asked } = recorded((url) => (url.endsWith('/Vermin') ? { status: 404 } : { status: 200, body: wiktionary }))
    const answer = await define(fetcher, '“Vermin,”', 'en')
    expect(asked.map((url) => url.split('/').at(-1))).toEqual(['Vermin', 'vermin'])
    expect(answer.data).toEqual({
      word: 'vermin',
      language: 'en',
      entries: [{ partOfSpeech: 'Noun', senses: [{ definition: 'Any insect or animal regarded as "unpleasant".', examples: ['The barn was overrun with vermin.'] }] }],
    })
  })

  it('has no answer for a word Wiktionary lacks, and needs a connection', async () => {
    const none = recorded(() => ({ status: 404 }))
    expect(await define(none.fetcher, 'Samsa', 'en')).toEqual({ data: null, error: null })
    expect((await define(none.fetcher, 'Samsa', 'en', { online: () => false })).error).toBe('offline')
  })

  it('offers itself for a word or two, not for a passage', () => {
    expect(headwordOf('Gregor’s')).toBe('Gregor')
    expect(plain('a&amp;b &#233; <b>c</b>')).toBe('a&b é c')
    expect(isDefinable('fret saw')).toBe(true)
    expect(isDefinable('One morning, when Gregor')).toBe(false)
  })
})


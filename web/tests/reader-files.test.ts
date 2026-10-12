import { describe, expect, it, vi } from 'vitest'
import { fetchReaderFiles, parseReaderFiles } from '@/data/reader/files'

/**
 * What utils/readerChunks.ts fetches before it imports (docs/perf/bundle.md F6): the running build's own list of
 * the reader's files, never the site's current one — after a release that names other files, the guard would pass
 * and the import itself would die mid-download, which the browser keeps for good.
 */

/** A `fetch` stand-in that answers every file with `status`, recording the bytes it handed over. */
function fetcher(status = 200) {
  const asked: string[] = []
  const read: string[] = []
  const take = async (url: string) => {
    asked.push(url)
    return {
      ok: status < 400,
      status,
      arrayBuffer: async () => {
        read.push(url)
        return new ArrayBuffer(2)
      },
    }
  }
  return { asked, read, take: take as unknown as typeof fetch }
}

describe('parseReaderFiles', () => {
  it('reads the list the build wrote into the app', () => {
    expect(parseReaderFiles('["_nuxt/ebook-reader-entry.a.js","_nuxt/ebook-reader.b.css"]')).toEqual([
      '_nuxt/ebook-reader-entry.a.js',
      '_nuxt/ebook-reader.b.css',
    ])
  })

  it('has nothing for a build or a dev server without the replacement, and for anything that is not a list of names', () => {
    expect(parseReaderFiles('__LIBELLUS_READER_FILES__')).toEqual([])
    expect(parseReaderFiles('not json')).toEqual([])
    expect(parseReaderFiles('{"file":"_nuxt/ebook-reader.a.js"}')).toEqual([])
    expect(parseReaderFiles('["_nuxt/ebook-reader.a.js", 7, null]')).toEqual(['_nuxt/ebook-reader.a.js'])
  })
})

describe('fetchReaderFiles', () => {
  it('brings every file in, bytes and all, before it resolves', async () => {
    const { asked, read, take } = fetcher()
    await fetchReaderFiles(['_nuxt/ebook-reader-entry.a.js', '_nuxt/ebook-reader.b.css'], take)
    expect(asked).toEqual(['/_nuxt/ebook-reader-entry.a.js', '/_nuxt/ebook-reader.b.css'])
    expect(read).toEqual(asked)
  })

  it('rejects naming the file the site no longer has, so the import after it is never run', async () => {
    const asked: string[] = []
    const take = (async (url: string) => {
      asked.push(url)
      return { ok: !url.endsWith('.css'), status: url.endsWith('.css') ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(2) }
    }) as unknown as typeof fetch
    await expect(fetchReaderFiles(['_nuxt/ebook-reader-entry.a.js', '_nuxt/ebook-reader.b.css'], take)).rejects.toThrow(
      '_nuxt/ebook-reader.b.css: 404',
    )
    // The other file was fetched: no import is attempted with only some of the files in (it would die
    // mid-download and the browser would keep that failure).
    expect(asked).toContain('/_nuxt/ebook-reader-entry.a.js')
  })

  it('has nothing to do for an empty list (a build without the replacement): the import fetches what it needs', async () => {
    const take = vi.fn()
    await fetchReaderFiles([], take as unknown as typeof fetch)
    expect(take).not.toHaveBeenCalled()
  })
})

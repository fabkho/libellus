import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { USER_AGENT, type CoverLookupDeps, type EditionLookup, type ProbedImage } from './covers'

/**
 * The Node side of the cover lookups: real `fetch` with timeouts, retries and a
 * polite pace for Apple's API (it answers 403/429 when asked too fast), sharp
 * to read image sizes and pixels, and a JSON cache in `.data/` so a rerun asks
 * nobody anything it already knows. Kept apart from covers.ts, which tests
 * drive with recordings.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Apple's lookup and search API: one request at a time, a little apart. */
function paced(gapMs: number) {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task)
    last = run.then(() => sleep(gapMs), () => sleep(gapMs))
    return run
  }
}

export function nodeLookupDeps(log: (line: string) => void = () => {}): CoverLookupDeps {
  const apple = paced(350)

  /**
   * The response, after waiting out rate limits and hiccups. Throws when the
   * source could not be asked at all, so a failure is never cached as "not
   * found": that Book is simply looked up again next run.
   */
  async function request(url: string, timeoutMs: number): Promise<Response> {
    const host = new URL(url).host
    let failure = 'no answer'
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
        const limited = response.status === 429 || (response.status === 403 && host === 'itunes.apple.com')
        if (!limited && response.status < 500) return response
        failure = `HTTP ${response.status}`
        // Apple's rate limit (or a hiccup): back off and ask again.
        const wait = limited ? 20_000 * (attempt + 1) : 3_000
        if (attempt < 3) {
          log(`  ${response.status} from ${host}; waiting ${wait / 1000}s`)
          await sleep(wait)
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
        if (attempt < 3) await sleep(2000 * (attempt + 1))
      }
    }
    throw new Error(`${host} unavailable (${failure})`)
  }

  return {
    async getJson(url) {
      const ask = async () => {
        const response = await request(url, 15_000)
        if (!response.ok) return null
        try {
          return await response.json()
        } catch {
          return null
        }
      }
      return new URL(url).host === 'itunes.apple.com' ? apple(ask) : ask()
    },
    async probe(url): Promise<ProbedImage | null> {
      const response = await request(url, 30_000)
      if (!response.ok) return null
      try {
        const buffer = Buffer.from(await response.arrayBuffer())
        const image = sharp(buffer)
        const meta = await image.metadata()
        if (!meta.width || !meta.height) return null
        const { data, info } = await image
          .resize(100, 100, { fit: 'inside' })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        return { width: meta.width, height: meta.height, pixels: { width: info.width, height: info.height, data: new Uint8Array(data) } }
      } catch {
        return null
      }
    },
  }
}

/** What the lookups found, by `lookupKey`, kept between runs. */
export class LookupCache {
  private entries: Record<string, EditionLookup> = {}

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { version?: number; lookups?: Record<string, EditionLookup> }
      if (data.version === 1) this.entries = data.lookups ?? {}
    }
  }

  get(key: string): EditionLookup | undefined {
    return this.entries[key]
  }

  set(key: string, value: EditionLookup) {
    this.entries[key] = value
    this.save()
  }

  /** Written whole, through a temporary file, so an interrupted run never leaves half a cache. */
  private save() {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify({ version: 1, lookups: this.entries }, null, 1)}\n`)
    renameSync(`${this.path}.tmp`, this.path)
  }
}

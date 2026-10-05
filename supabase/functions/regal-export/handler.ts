/**
 * `regal-export`: the owner's Library as a Regal library file (issue #110),
 * for the Regal workflow that publishes the portfolio's shelf
 * (fabkho/regal, .github/workflows/publish-shelf.yml). The same file the web
 * script `pnpm export:regal --statuses read --carry-art <published>` writes:
 * the mapping is web/app/data/export/regal.ts, the art carried over from the
 * published file is web/app/data/export/carryArt.ts, both imported as they are.
 *
 *   GET /functions/v1/regal-export[?statuses=read,dnf]
 *   Authorization: Bearer <REGAL_EXPORT_TOKEN>
 *
 *   200 the library file (application/json), validated with Regal's validator
 *   401 { error: 'unauthorized' }   · 405 { error: 'method_not_allowed' }
 *   400 { error: 'statuses_invalid' }
 *   500 { error: 'not_configured' | 'owner_not_found' | 'export_invalid' | 'export_failed' }
 *   502 { error: 'published_unavailable' }  the published file could not be read: no
 *       file goes out without its art, or Regal assets would drop the portfolio's art
 *
 * Everything it talks to comes in from outside (index.ts wires the real ones),
 * so the tests drive it with fixtures.
 */
import { carryArt } from '../../../web/app/data/export/carryArt.ts'
import { exportRegalLibrary, type RegalExportEntry } from '../../../web/app/data/export/regal.ts'
import {
  formatLibraryFileErrors,
  type KnownReadingStatus,
  parseLibraryFile,
  type RegalLibraryFile,
  validateLibraryFile,
} from '../../../web/app/data/export/regalLibraryFile.ts'

export const STATUSES: readonly KnownReadingStatus[] = ['read', 'dnf', 'currently-reading', 'to-read']

/** What the portfolio shows: the Books read (the daily chain's `--statuses read`). */
export const DEFAULT_STATUSES: readonly KnownReadingStatus[] = ['read']

/** The file Regal shows now, whose art the export keeps. */
export const DEFAULT_CARRY_ART_URL = 'https://books.fabkho.dev/v2/library.json'

/** The owner's zone, the one `dateAdded` is a day in (the Mac job used the machine's). */
export const DEFAULT_TIME_ZONE = 'Europe/Berlin'

export type ExportConfig = {
  /** The shared bearer secret (`REGAL_EXPORT_TOKEN`). */
  token: string
  /** Whose Library (`REGAL_OWNER_EMAIL`). */
  ownerEmail: string
  /** `owner` of the file, as Regal shows it (`REGAL_OWNER_NAME`, "Fabian"). */
  ownerName: string | null
  timeZone: string
  statuses: readonly KnownReadingStatus[]
  /** The published library file to carry art from; null = none (a Library's first export). */
  carryArtUrl: string | null
}

/** The published file and how its image references read from the export (absolute URLs). */
export type Published = { file: RegalLibraryFile; resolveRef: (ref: string) => string | null; url: string }

export type HandlerDeps = {
  /** The configuration, or why there is none (a missing secret): every request is refused then. */
  config: ExportConfig | { error: string }
  /** The member's Library; null when no member has that address. */
  readLibrary: (email: string) => Promise<RegalExportEntry[] | null>
  loadPublished: (url: string) => Promise<Published>
  now: () => Date
  log?: (line: string) => void
}

export class PublishedUnavailable extends Error {}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

/** Parses a status list ("read,dnf"); null when it names an unknown one or none. */
export function parseStatuses(list: string): KnownReadingStatus[] | null {
  const statuses = list.split(',').map((status) => status.trim()).filter(Boolean)
  if (!statuses.length || statuses.some((status) => !STATUSES.includes(status as KnownReadingStatus))) return null
  return [...new Set(statuses)] as KnownReadingStatus[]
}

/** The configuration from the function's environment (secrets); see README.md. */
export function configFromEnv(env: (name: string) => string | undefined): ExportConfig | { error: string } {
  const token = env('REGAL_EXPORT_TOKEN')?.trim()
  const ownerEmail = env('REGAL_OWNER_EMAIL')?.trim()
  const missing = [!token && 'REGAL_EXPORT_TOKEN', !ownerEmail && 'REGAL_OWNER_EMAIL'].filter(Boolean)
  if (missing.length) return { error: `${missing.join(' and ')} not set` }
  // A guessable secret is no secret: refuse to run on one.
  if (token!.length < 32) return { error: 'REGAL_EXPORT_TOKEN is shorter than 32 characters' }
  const statuses = parseStatuses(env('REGAL_STATUSES') || DEFAULT_STATUSES.join(','))
  if (!statuses) return { error: `REGAL_STATUSES "${env('REGAL_STATUSES')}" names an unknown status (${STATUSES.join(', ')})` }
  const timeZone = env('REGAL_TIME_ZONE')?.trim() || DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    return { error: `REGAL_TIME_ZONE "${timeZone}" is not a time zone` }
  }
  const carryArt = env('REGAL_CARRY_ART_URL')?.trim()
  return {
    token: token!,
    ownerEmail: ownerEmail!,
    ownerName: env('REGAL_OWNER_NAME')?.trim() || null,
    timeZone,
    statuses,
    carryArtUrl: carryArt === 'none' ? null : carryArt || DEFAULT_CARRY_ART_URL,
  }
}

/**
 * Whether the presented secret is the expected one, in time that does not
 * depend on where they differ: both are hashed first (equal lengths), then
 * every byte is compared.
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all(
    [given, expected].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))),
  )
  let difference = 0
  for (let index = 0; index < a!.length; index++) difference |= a![index]! ^ b![index]!
  return difference === 0
}

const bearer = (request: Request) => request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''

/**
 * The published library file at `url`, validated, its image references made
 * absolute against the URL it came from. Throws `PublishedUnavailable` when it
 * cannot be read or is not a valid library file.
 */
export async function loadPublished(url: string, fetchFn: typeof fetch = fetch): Promise<Published> {
  let response: Response
  try {
    response = await fetchFn(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new PublishedUnavailable(`${url}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new PublishedUnavailable(`${url}: HTTP ${response.status}`)
  const parsed = parseLibraryFile(await response.text())
  if (!parsed.ok) {
    throw new PublishedUnavailable(`${url} is not a valid Regal library file: ${formatLibraryFileErrors(parsed.errors).slice(0, 5).join('; ')}`)
  }
  const base = response.url || url
  return {
    file: parsed.library,
    url,
    resolveRef: (ref) => {
      try {
        return new URL(ref, base).href
      } catch {
        return null
      }
    },
  }
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((line: string) => console.log(line))

  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
    }
    const config = deps.config
    if ('error' in config) {
      log(`regal-export: not configured: ${config.error}`)
      return json(500, { error: 'not_configured' })
    }
    if (!(await sameSecret(bearer(request), config.token))) {
      return json(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
    }

    const asked = new URL(request.url).searchParams.get('statuses')
    const statuses = asked === null ? config.statuses : parseStatuses(asked)
    if (!statuses) return json(400, { error: 'statuses_invalid', allowed: STATUSES })

    try {
      // The published file first: without it no file goes out at all.
      const published = config.carryArtUrl ? await deps.loadPublished(config.carryArtUrl) : null
      const entries = await deps.readLibrary(config.ownerEmail)
      if (!entries) {
        log(`regal-export: no member with the address in REGAL_OWNER_EMAIL`)
        return json(500, { error: 'owner_not_found' })
      }
      let file = exportRegalLibrary(entries, {
        generatedAt: deps.now().toISOString(),
        owner: config.ownerName,
        timeZone: config.timeZone,
        statuses,
      })
      let carried = 0
      if (published) {
        const result = carryArt(file, published.file, published.resolveRef)
        file = result.file
        carried = result.carried.length
      }
      const valid = validateLibraryFile(file)
      if (!valid.ok) {
        log(`regal-export: the export does not validate:\n  ${formatLibraryFileErrors(valid.errors).join('\n  ')}`)
        return json(500, { error: 'export_invalid', errors: formatLibraryFileErrors(valid.errors).slice(0, 20) })
      }
      log(
        `regal-export: entries ${entries.length}, Books ${file.books.length} (${statuses.join(', ')})` +
          (published ? `, art carried for ${carried} from ${published.url} (${published.file.books.length} Books)` : ''),
      )
      return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(file, null, 2)}\n`, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-regal-books': String(file.books.length),
          'x-regal-art-carried': String(carried),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof PublishedUnavailable) {
        log(`regal-export: published file unavailable: ${message}`)
        return json(502, { error: 'published_unavailable' })
      }
      log(`regal-export: failed: ${error instanceof Error ? (error.stack ?? message) : message}`)
      return json(500, { error: 'export_failed' })
    }
  }
}

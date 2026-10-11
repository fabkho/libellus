/**
 * EPUB files shared to the app (issue #131) wait in Cache Storage (`SHARED_EBOOKS_CACHE`) for
 * the member's tap: the service worker keeps them (public/sw-share.js, which has the same
 * limits) and pages/share.vue lists them and asks. Nothing here imports anything: `pendingShare`
 * says what waits under one id, `readShared` hands over the files of a share the member
 * confirmed, `discardShared` deletes shares. Pure over the slice of Cache Storage it needs, so
 * tests/share-target.test.ts runs it on an in-memory cache.
 */

/** At most this many files of one share are kept, and each at most this large (the worker's limits). */
export const SHARE_MAX_FILES = 20
export const SHARE_MAX_FILE_BYTES = 100 * 1024 * 1024
/** A share nobody confirmed is not offered after this, and the next visit to /share deletes it. */
export const SHARE_KEEP_MS = 60 * 60 * 1000

/** The slice of a `Cache` the shared files need. */
export type SharedCache = {
  keys: () => Promise<readonly Request[]>
  match: (request: string | Request) => Promise<Response | undefined>
  delete: (request: string | Request) => Promise<boolean>
}

type Listed = { index: number; name: string; type: string; size: number; lastModified: number }

/** What waits under one id: the names and sizes the confirmation shows. */
export type PendingShare = {
  id: string
  files: { index: number; name: string; size: number }[]
  /** Files of the share that were not kept (not an EPUB, too large, too many). */
  skipped: number
}

const ID = /^[a-z0-9]{6,40}$/
const idOf = (url: string) => new URL(url, 'https://libellus.invalid').pathname.split('/')[2] ?? ''
const isListed = (value: unknown): value is Listed => {
  const item = value as Listed | null
  return (
    Boolean(item) &&
    Number.isInteger(item!.index) &&
    typeof item!.name === 'string' &&
    typeof item!.size === 'number' &&
    item!.size > 0 &&
    item!.size <= SHARE_MAX_FILE_BYTES
  )
}

async function metaOf(cache: SharedCache, id: string, now: number): Promise<{ id: string; at: number; skipped: number; files: Listed[] } | null> {
  if (!ID.test(id)) return null
  const raw = (await (await cache.match(`/__shared/${id}/meta`))?.json().catch(() => null)) as {
    id?: string
    at?: number
    skipped?: number
    files?: unknown[]
  } | null
  if (!raw || raw.id !== id || typeof raw.at !== 'number' || now - raw.at > SHARE_KEEP_MS || !Array.isArray(raw.files)) return null
  const files = raw.files.filter(isListed).slice(0, SHARE_MAX_FILES)
  if (!files.length) return null
  return { id, at: raw.at, skipped: Number(raw.skipped) || 0, files }
}

/** What waits under `id` (the address's `ebooks=`), or null: unknown, expired, or not complete. */
export async function pendingShare(cache: SharedCache, id: string, now = Date.now()): Promise<PendingShare | null> {
  const meta = await metaOf(cache, id, now)
  if (!meta) return null
  return { id, skipped: meta.skipped, files: meta.files.map(({ index, name, size }) => ({ index, name, size })) }
}

/** The files of a confirmed share, as `File`s. Files the cache lost are left out; the share stays until `discardShared`. */
export async function readShared(cache: SharedCache, id: string, now = Date.now()): Promise<File[]> {
  const meta = await metaOf(cache, id, now)
  if (!meta) return []
  const files: File[] = []
  for (const item of meta.files) {
    const response = await cache.match(`/__shared/${id}/${item.index}`)
    if (response) files.push(new File([await response.blob()], item.name, { type: item.type || 'application/epub+zip', lastModified: item.lastModified }))
  }
  return files
}

/**
 * Deletes shares: the one with `only`, or every one except `keep` (a visit to /share with an
 * id leaves nothing else waiting: what nobody confirmed does not pile up), or all of them.
 */
export async function discardShared(cache: SharedCache, { only, keep }: { only?: string; keep?: string } = {}): Promise<void> {
  for (const request of await cache.keys()) {
    const id = idOf(request.url)
    if (only !== undefined ? id !== only : keep !== undefined && id === keep) continue
    await cache.delete(request)
  }
}

/** "2.4 MB", "310 KB": what the confirmation shows beside a file's name. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

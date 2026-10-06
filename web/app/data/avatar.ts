import type { SupabaseClient } from '@supabase/supabase-js'
import { openLocalDatabase, LOCAL_DATABASE } from './localData'

/**
 * The member's profile photo (issue #156): made on the device, kept in the
 * private `avatars` bucket, shown to her alone, and kept on the device for an
 * offline start (supabase/migrations/20261009120000_avatars.sql).
 *
 * Made on the device: the picked picture is cut to the square she placed in
 * the crop sheet, scaled to 512 px and 128 px (never up), and encoded again
 * through a canvas, WebP where the browser can (Chrome, Firefox) and JPEG
 * where it cannot (Safari hands PNG back for WebP). A canvas encodes pixels
 * only, so the EXIF block of a phone's photo (the GPS position, the camera,
 * the time) never reaches the file; `stripMetadata` then takes out whatever
 * metadata segment an encoder might add anyway, so the rule does not depend
 * on a browser. Each file aims at ≤ 100 kB: the quality steps down until it
 * fits (a 512 px WebP is usually 20–50 kB at the first step).
 *
 * Stored as `<member id>/<hash>.<webp|jpg>` and `<member id>/<hash>-128.<ext>`,
 * the hash the first 32 hex digits of the large file's SHA-256: a new photo is a
 * new path, so the device knows from `accounts.avatar_path` alone whether its
 * copy is the current one, and no URL needs a cache-busting query.
 *
 * Framework-free like every repository here: the browser's canvas is one
 * implementation of `AvatarRaster` (utils/avatarRaster.ts), the tests drive
 * the same pipeline through sharp, and a native port copies the rules.
 */

export const AVATAR_BUCKET = 'avatars'
/** The photo's side in pixels: the Profile's ring at 3× and then some. */
export const AVATAR_SIDE = 512
/** The small copy's side: the tab header's avatar at 3×. */
export const AVATAR_SMALL_SIDE = 128
/** What each file aims at; the bucket refuses anything over 256 kB. */
export const AVATAR_MAX_BYTES = 100_000
/** The qualities tried in turn until a file fits `AVATAR_MAX_BYTES`. */
export const AVATAR_QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5, 0.4] as const

export type AvatarType = 'image/webp' | 'image/jpeg'

/** The two files of a photo, ready to upload. */
export type AvatarFiles = { large: Blob; small: Blob; type: AvatarType }

/**
 * The cut-out square of the picked picture, drawn and encoded at a side. The
 * blob's `type` is what the encoder really made: a browser that cannot encode
 * the asked type answers with another one (PNG), and the pipeline falls back.
 */
export type AvatarRaster = {
  encode: (side: number, type: AvatarType, quality: number) => Promise<Blob>
}

/** The two sides for a cut-out of `cropSize` pixels of the original: at most 512 and 128, never upscaled. */
export function avatarSides(cropSize: number): { large: number; small: number } {
  const large = Math.max(1, Math.min(AVATAR_SIDE, Math.floor(cropSize)))
  return { large, small: Math.min(AVATAR_SMALL_SIDE, large) }
}

async function encodeSide(raster: AvatarRaster, side: number, type: AvatarType): Promise<Blob | null> {
  let last: Blob | null = null
  for (const quality of AVATAR_QUALITIES) {
    const blob = await raster.encode(side, type, quality)
    if (blob.type !== type) return null
    last = blob
    if (blob.size <= AVATAR_MAX_BYTES) break
  }
  if (!last) return null
  return new Blob([stripMetadata(new Uint8Array(await last.arrayBuffer())) as Uint8Array<ArrayBuffer>], { type })
}

/**
 * The photo's two files from the cut-out: WebP if the encoder makes WebP,
 * else JPEG for both, each stepped down in quality to fit and stripped of
 * every metadata segment.
 */
export async function encodeAvatar(raster: AvatarRaster, cropSize: number): Promise<AvatarFiles> {
  const sides = avatarSides(cropSize)
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    const large = await encodeSide(raster, sides.large, type)
    if (!large) continue
    const small = await encodeSide(raster, sides.small, type)
    if (small) return { large, small, type }
  }
  throw new Error('avatar encoding failed')
}

// ------------------------------------------------------------------ metadata

/** A kind of metadata a JPEG or WebP file can carry besides its pixels. */
export type MetadataKind = 'exif' | 'xmp' | 'icc' | 'iptc' | 'comment' | 'app'

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)))

function jpegSegmentKind(marker: number, bytes: Uint8Array, start: number): MetadataKind | null {
  // APP0 (JFIF) and APP14 (Adobe's colour transform) describe the pixels; keep them.
  if (marker === 0xe0 || marker === 0xee) return null
  if (marker === 0xfe) return 'comment'
  if (marker < 0xe1 || marker > 0xef) return null
  const id = ascii(bytes, start + 4, 29)
  if (marker === 0xe1) return id.startsWith('Exif') ? 'exif' : id.startsWith('http://ns.adobe.com/') ? 'xmp' : 'app'
  if (marker === 0xe2 && id.startsWith('ICC_PROFILE')) return 'icc'
  if (marker === 0xed) return 'iptc'
  return 'app'
}

type Segment = { start: number; end: number; kind: MetadataKind | null }

/** The JPEG's segments up to the image data, each with the metadata it is (null: part of the image). */
function jpegSegments(bytes: Uint8Array): { segments: Segment[]; rest: number } {
  const segments: Segment[] = []
  let i = 2
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!
    if (marker === 0xff) {
      i += 1
      continue
    }
    // Start of scan or end of image: from here on it is the picture itself.
    if (marker === 0xda || marker === 0xd9) break
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ start: i, end: i + 2, kind: null })
      i += 2
      continue
    }
    const end = i + 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!)
    segments.push({ start: i, end: Math.min(end, bytes.length), kind: jpegSegmentKind(marker, bytes, i) })
    i = end
  }
  return { segments, rest: Math.min(i, bytes.length) }
}

type Chunk = { start: number; end: number; id: string }

/** The WebP's RIFF chunks. */
function webpChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 12
  while (i + 8 <= bytes.length) {
    const size = view.getUint32(i + 4, true)
    const end = Math.min(bytes.length, i + 8 + size + (size % 2))
    chunks.push({ start: i, end, id: ascii(bytes, i, 4) })
    i = end
  }
  return chunks
}

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8
const isWebp = (bytes: Uint8Array) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'

const WEBP_METADATA: Record<string, MetadataKind> = { EXIF: 'exif', 'XMP ': 'xmp', ICCP: 'icc' }

/** The metadata a JPEG or WebP file carries, in the order it comes; empty for anything else. */
export function metadataIn(bytes: Uint8Array): MetadataKind[] {
  if (isJpeg(bytes)) return jpegSegments(bytes).segments.flatMap((s) => (s.kind ? [s.kind] : []))
  if (isWebp(bytes)) return webpChunks(bytes).flatMap((c) => (WEBP_METADATA[c.id] ? [WEBP_METADATA[c.id]!] : []))
  return []
}

/**
 * The same file without its metadata: a JPEG without its APP1–APP13/APP15
 * segments and comments (EXIF, XMP, ICC, IPTC), a WebP without its EXIF,
 * XMP and ICCP chunks (and their flags in VP8X). The picture's bytes are not
 * touched. Anything else comes back as it was.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  if (isJpeg(bytes)) {
    const { segments, rest } = jpegSegments(bytes)
    if (!segments.some((s) => s.kind)) return bytes
    const parts = [bytes.subarray(0, 2), ...segments.filter((s) => !s.kind).map((s) => bytes.subarray(s.start, s.end)), bytes.subarray(rest)]
    return concat(parts)
  }
  if (isWebp(bytes)) {
    const chunks = webpChunks(bytes)
    if (!chunks.some((c) => WEBP_METADATA[c.id])) return bytes
    const out = concat([bytes.subarray(0, 12), ...chunks.filter((c) => !WEBP_METADATA[c.id]).map((c) => bytes.subarray(c.start, c.end))])
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    view.setUint32(4, out.length - 8, true)
    const vp8x = webpChunks(out).find((c) => c.id === 'VP8X')
    // VP8X's flags: ICC 0x20, EXIF 0x08, XMP 0x04.
    if (vp8x) out[vp8x.start + 8]! &= ~(0x20 | 0x08 | 0x04)
    return out
  }
  return bytes
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// ------------------------------------------------------------------ paths

const EXTENSION: Record<AvatarType, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }

/** The first 32 hex digits of the file's SHA-256. */
export async function avatarHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

/** Where a photo's two files go in the bucket. */
export function avatarPaths(memberId: string, hash: string, type: AvatarType): { large: string; small: string } {
  const large = `${memberId}/${hash}.${EXTENSION[type]}`
  return { large, small: smallAvatarPath(large) }
}

/** The small copy's path for a photo's path: `<id>/<hash>-128.<ext>`. */
export function smallAvatarPath(path: string): string {
  return path.replace(/\.(webp|jpg)$/, '-128.$1')
}

// ------------------------------------------------------------- the repository

export type AvatarErrorCode =
  /** No connection: refused before anything was sent, or the request never came back. */
  | 'offline'
  | 'not_signed_in'
  /** The bucket refused a file (over 256 kB, or a type it does not take). */
  | 'too_large'
  /** The account names a photo whose files are not in the bucket (a restored backup: Storage is not in it). */
  | 'missing'
  | 'unknown'

export type AvatarResult<T> = { data: T; error: null } | { data: null; error: AvatarErrorCode }

/** The photo the account names, and since when. */
export type AvatarState = { path: string | null; updatedAt: string | null }

export type AvatarRepository = {
  /** What her account says: the photo's path, or null for initials. */
  current: () => Promise<AvatarResult<AvatarState>>
  /** The photo's two files, downloaded with her session. */
  download: (path: string) => Promise<AvatarResult<{ large: Blob; small: Blob }>>
  /** Uploads a photo, points her account at it, and deletes the files of the one before. Refused offline. */
  save: (files: AvatarFiles) => Promise<AvatarResult<AvatarState>>
  /** Back to initials: her account names no photo and her folder is emptied. Refused offline. */
  remove: () => Promise<AvatarResult<AvatarState>>
}

type Failure = { message?: string; code?: string; status?: number; statusCode?: string | number; name?: string }

function mapError(failure: Failure): AvatarErrorCode {
  const message = failure.message ?? ''
  const status = Number(failure.status ?? failure.statusCode ?? 0)
  if (message.includes('not_signed_in') || failure.code === '42501' || status === 401 || status === 403) return 'not_signed_in'
  if (status === 413 || /payload too large|exceeded the maximum|mime type/i.test(message)) return 'too_large'
  if (status === 404 || /not.?found/i.test(message)) return 'missing'
  // supabase-js answers a request that never came back without a status.
  if (!status || failure.name === 'StorageUnknownError') return 'offline'
  return 'unknown'
}

async function memberIdOf(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * Deletes every file in the member's folder through the Storage API (the only
 * way: storage.protect_delete refuses it from SQL), except `keep`. True when
 * the folder holds nothing else any more. Used to tidy up after a new photo,
 * on Remove, and before the account is deleted (data/auth.ts).
 */
export async function clearAvatarFolder(client: SupabaseClient, memberId: string, keep: readonly string[] = []): Promise<boolean> {
  const bucket = client.storage.from(AVATAR_BUCKET)
  for (let round = 0; round < 10; round++) {
    const { data, error } = await bucket.list(memberId, { limit: 100 })
    if (error) return false
    const names = (data ?? []).map((o) => `${memberId}/${o.name}`).filter((name) => !keep.includes(name))
    if (!names.length) return true
    const removed = await bucket.remove(names)
    if (removed.error) return false
  }
  return false
}

export function createAvatar(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): AvatarRepository {
  const bucket = () => client.storage.from(AVATAR_BUCKET)

  return {
    async current() {
      // RLS hands her her own account row only.
      const { data, error } = await client.from('accounts').select('avatar_path, avatar_updated_at').maybeSingle()
      if (error) return { data: null, error: mapError(error) }
      return { data: { path: data?.avatar_path ?? null, updatedAt: data?.avatar_updated_at ?? null }, error: null }
    },

    async download(path) {
      const [large, small] = await Promise.all([bucket().download(path), bucket().download(smallAvatarPath(path))])
      const failed = large.error ?? small.error
      if (failed) return { data: null, error: mapError(failed as Failure) }
      return { data: { large: large.data!, small: small.data! }, error: null }
    },

    async save(files) {
      if (!online()) return { data: null, error: 'offline' }
      const memberId = await memberIdOf(client)
      if (!memberId) return { data: null, error: 'not_signed_in' }
      const paths = avatarPaths(memberId, await avatarHash(files.large), files.type)
      // Upserted: the same photo saved twice is the same path, and replacing it is harmless.
      const options = { contentType: files.type, upsert: true, cacheControl: '31536000' }
      for (const [path, file] of [[paths.large, files.large], [paths.small, files.small]] as const) {
        const { error } = await bucket().upload(path, file, options)
        if (error) return { data: null, error: mapError(error as Failure) }
      }
      const { error, status } = await client.rpc('set_avatar', { p_path: paths.large })
      if (error) return { data: null, error: status ? mapError({ ...error, status }) : 'offline' }
      // The photo before and anything a broken upload left behind; a failure only leaves a file to tidy next time.
      await clearAvatarFolder(client, memberId, [paths.large, paths.small])
      return { data: { path: paths.large, updatedAt: new Date().toISOString() }, error: null }
    },

    async remove() {
      if (!online()) return { data: null, error: 'offline' }
      const memberId = await memberIdOf(client)
      if (!memberId) return { data: null, error: 'not_signed_in' }
      const { error, status } = await client.rpc('set_avatar', { p_path: null })
      if (error) return { data: null, error: status ? mapError({ ...error, status }) : 'offline' }
      await clearAvatarFolder(client, memberId)
      return { data: { path: null, updatedAt: new Date().toISOString() }, error: null }
    },
  }
}

// ------------------------------------------------------------- on the device

/** The photo as the device keeps it for an offline start: the path it is, and its two files. */
export type CachedAvatar = { path: string; large: Blob; small: Blob }

export type AvatarCache = {
  read: (memberId: string) => Promise<CachedAvatar | null>
  write: (memberId: string, avatar: CachedAvatar | null) => Promise<void>
}

const STORE = 'avatars'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * The photo in the device's IndexedDB database (`LOCAL_DATABASE`, store
 * `avatars`, one record per member): signing out deletes the database, and the
 * photo with it. Blobs rather than a service-worker cache: the files are
 * downloaded with her session, not fetched by URL, and a record is atomic.
 */
export function indexedDbAvatarCache(factory: IDBFactory, name = LOCAL_DATABASE): AvatarCache {
  let opened: Promise<IDBDatabase> | null = null
  function open(): Promise<IDBDatabase> {
    opened ??= openLocalDatabase(factory, { name, onClose: () => (opened = null) }).catch((error) => {
      opened = null
      throw error
    })
    return opened
  }
  return {
    async read(memberId) {
      const db = await open()
      const found = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(memberId))) as CachedAvatar | undefined
      return found?.path && found.large instanceof Blob && found.small instanceof Blob ? found : null
    },
    async write(memberId, avatar) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      if (avatar) tx.objectStore(STORE).put(avatar, memberId)
      else tx.objectStore(STORE).delete(memberId)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
  }
}

/** The cache in memory only (the tests; a browser without IndexedDB). */
export function memoryAvatarCache(): AvatarCache {
  const saved = new Map<string, CachedAvatar>()
  return {
    async read(memberId) {
      return saved.get(memberId) ?? null
    },
    async write(memberId, avatar) {
      if (avatar) saved.set(memberId, avatar)
      else saved.delete(memberId)
    },
  }
}

/**
 * Profile links (WP-22): a member's profiles on other platforms, in the safe shape. Pure, no I/O, so a test
 * pins it and a native port copies it.
 *
 * What is stored is a validated HANDLE or canonical id per allow-listed platform, never a URL
 * (`profile_links`, supabase/migrations/20261028010000_profile_links.sql, which holds the same formats). This
 * file is the ONE place that knows the platforms: a table, `SOCIAL_PLATFORMS`, one row each. Adding a platform
 * is a row here (and its value in the database's enum and format check), nothing else.
 *
 *   `cleanSocialHandle(platform, typed)`  what a member typed or pasted (a handle, or the platform's own
 *                                         profile URL) -> the canonical handle, or null
 *   `socialLinkUrl(platform, handle)`     the address the app opens, from a fixed template per platform; null
 *                                         for anything that is not a canonical handle. The stored text is
 *                                         never rendered as a URL any other way.
 *
 * Formats, as the platforms state them (checked 2026-10-28; the stricter of the platform's rule and the safe
 * subset the app is sure of):
 *
 *   instagram  1-30 of a-z 0-9 . _ ; no leading, trailing or doubled dot  -> instagram.com/<handle>/
 *   tiktok     2-24 of a-z 0-9 . _ ; no trailing dot                      -> tiktok.com/@<handle>
 *   youtube    `@handle`, 3-30 of a-z 0-9 . _ - , or a channel id `UC` + 22 of A-Za-z0-9_-
 *                                                                          -> youtube.com/@<handle> | /channel/<id>
 *   goodreads  the number in goodreads.com/user/show/<id>, 1-12 digits     -> goodreads.com/user/show/<id>
 *   reado      2-30 of A-Za-z0-9 . _ ; as typed                           -> reado.app/en/profile/<handle>
 *              (Reado's own username rules are not published; its public profile pages live under
 *              reado.app/<locale>/profile/<name>, `en` is the one seen in its sitemap and search results)
 *
 * Instagram, TikTok and YouTube ignore case, so their handles are stored lower-case. The letters are checked
 * as typed, in ASCII, before any case folding, so a look-alike (the Kelvin sign, a Cyrillic а) is refused and
 * never folded into a letter. Every class is spelled out (`[0-9]`, never `\d`).
 */

export const SOCIAL_PLATFORM_IDS = ['goodreads', 'reado', 'youtube', 'instagram', 'tiktok'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORM_IDS)[number]

/** Who sees a member's links; the database's `profile_link_settings.visibility`. `followers` is the default. */
export const LINK_VISIBILITIES = ['followers', 'everyone', 'me'] as const
export type LinkVisibility = (typeof LINK_VISIBILITIES)[number]
export const DEFAULT_LINK_VISIBILITY: LinkVisibility = 'followers'

export type SocialPlatformSpec = {
  id: SocialPlatform
  /** The brand name; never translated. */
  name: string
  /** What the sheet shows in front of the field (where the handle goes in the address). */
  prefix: string
  /** The field's example, a handle or id as the platform shows it. */
  example: string
  /** The field's keyboard. */
  inputmode: 'text' | 'numeric' | 'url'
  /** The longest thing the field takes: a handle or channel id, or a pasted address. */
  maxlength: number
  /** Whether a canonical handle is well formed (the stored form). */
  ok: (handle: string) => boolean
  /** A typed handle, trimmed, as stored; null when it is not one. */
  fromHandle: (typed: string) => string | null
  /** The handle in a profile URL of this platform: its path's segments, on a host the platform owns. */
  fromPath: (segments: string[]) => string | null
  /** The hosts of this platform's own profile addresses (lower case, exact). */
  hosts: readonly string[]
  /** The address of a canonical handle. */
  url: (handle: string) => string
}

const INSTAGRAM = /^[A-Za-z0-9_]([A-Za-z0-9._]{0,28}[A-Za-z0-9_])?$/
const TIKTOK = /^[A-Za-z0-9_]([A-Za-z0-9._]{0,22}[A-Za-z0-9_])$/
const YOUTUBE_HANDLE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{1,28}[A-Za-z0-9_-]$/
const YOUTUBE_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/
const GOODREADS = /^[1-9][0-9]{0,11}$/
const READO = /^[A-Za-z0-9_][A-Za-z0-9._]{0,28}[A-Za-z0-9_]$/

/** The first character an @ may stand in front of: dropped once, never twice. */
const stripAt = (typed: string) => (typed.startsWith('@') ? typed.slice(1) : typed)

/** Paths of Instagram that are not a profile: a handle of the same shape. */
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer'])

export const SOCIAL_PLATFORMS: readonly SocialPlatformSpec[] = [
  {
    id: 'goodreads',
    name: 'Goodreads',
    prefix: 'goodreads.com/user/show/',
    example: '12345678',
    inputmode: 'url',
    maxlength: 200,
    ok: (h) => GOODREADS.test(h),
    // Her number, or the number a pasted /user/show/<id>-<name> address starts with (handled in fromPath).
    fromHandle: (typed) => (GOODREADS.test(typed) ? typed : null),
    fromPath: (segments) => {
      const [first, second, third] = segments
      if (first !== 'user' || second !== 'show' || !third) return null
      const id = /^([0-9]+)(?:-[^/]*)?$/.exec(third)?.[1]
      return id && GOODREADS.test(id) ? id : null
    },
    hosts: ['goodreads.com', 'www.goodreads.com'],
    url: (h) => `https://www.goodreads.com/user/show/${h}`,
  },
  {
    id: 'reado',
    name: 'Reado',
    prefix: 'reado.app/en/profile/',
    example: 'karla',
    inputmode: 'text',
    maxlength: 200,
    ok: (h) => READO.test(h),
    fromHandle: (typed) => {
      const handle = stripAt(typed)
      return READO.test(handle) ? handle : null
    },
    // /en/profile/<name>, /de/profile/<name>, or /profile/<name>.
    fromPath: (segments) => {
      const rest = segments.length >= 3 && /^[a-z]{2}$/i.test(segments[0]!) ? segments.slice(1) : segments
      const [first, second] = rest
      if (first !== 'profile' || !second) return null
      return READO.test(second) ? second : null
    },
    hosts: ['reado.app', 'www.reado.app'],
    url: (h) => `https://reado.app/en/profile/${h}`,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    prefix: 'youtube.com/',
    example: '@name',
    inputmode: 'text',
    maxlength: 200,
    ok: (h) => (h.startsWith('@') ? YOUTUBE_HANDLE.test(h.slice(1)) && h === h.toLowerCase() : YOUTUBE_CHANNEL.test(h)),
    fromHandle: (typed) => {
      if (YOUTUBE_CHANNEL.test(typed)) return typed
      const handle = stripAt(typed)
      return YOUTUBE_HANDLE.test(handle) ? `@${handle.toLowerCase()}` : null
    },
    // /@name, or /channel/UC… ; the older /c/ and /user/ addresses name no handle and are refused.
    fromPath: (segments) => {
      const [first, second] = segments
      if (!first) return null
      if (first.startsWith('@')) return YOUTUBE_HANDLE.test(first.slice(1)) ? `@${first.slice(1).toLowerCase()}` : null
      if (first === 'channel' && second && YOUTUBE_CHANNEL.test(second)) return second
      return null
    },
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    url: (h) => (h.startsWith('@') ? `https://www.youtube.com/${h}` : `https://www.youtube.com/channel/${h}`),
  },
  {
    id: 'instagram',
    name: 'Instagram',
    prefix: 'instagram.com/',
    example: 'name',
    inputmode: 'text',
    maxlength: 200,
    ok: (h) => INSTAGRAM.test(h) && h === h.toLowerCase() && !h.includes('..'),
    fromHandle: (typed) => {
      const handle = stripAt(typed)
      return INSTAGRAM.test(handle) && !handle.includes('..') ? handle.toLowerCase() : null
    },
    fromPath: (segments) => {
      const [first] = segments
      if (!first || INSTAGRAM_RESERVED.has(first.toLowerCase())) return null
      return INSTAGRAM.test(first) && !first.includes('..') ? first.toLowerCase() : null
    },
    hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
    url: (h) => `https://www.instagram.com/${h}/`,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    prefix: 'tiktok.com/@',
    example: 'name',
    inputmode: 'text',
    maxlength: 200,
    ok: (h) => TIKTOK.test(h) && h === h.toLowerCase(),
    fromHandle: (typed) => {
      const handle = stripAt(typed)
      return TIKTOK.test(handle) ? handle.toLowerCase() : null
    },
    fromPath: (segments) => {
      const [first] = segments
      if (!first?.startsWith('@')) return null
      const handle = first.slice(1)
      return TIKTOK.test(handle) ? handle.toLowerCase() : null
    },
    hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
    url: (h) => `https://www.tiktok.com/@${h}`,
  },
]

const SPEC = new Map(SOCIAL_PLATFORMS.map((spec) => [spec.id, spec]))

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && SPEC.has(value as SocialPlatform)
}

export function isLinkVisibility(value: unknown): value is LinkVisibility {
  return typeof value === 'string' && (LINK_VISIBILITIES as readonly string[]).includes(value)
}

export function socialPlatform(id: SocialPlatform): SocialPlatformSpec {
  return SPEC.get(id)!
}

/** Whitespace the field trims, as the database does (space, tab, CR, LF). */
const TRIM = /^[ \t\r\n]+|[ \t\r\n]+$/g

/**
 * Looks like an address rather than a handle: no handle holds a slash, a colon, a question mark, a hash or a
 * backslash. (`ada.reads` is a handle; `instagram.com/ada.reads` and `javascript:x` are not.)
 */
const ADDRESS = /[/:?#\\]/

/**
 * The handle in what a member typed or pasted for this platform, as the database stores it; null when it is
 * none. A pasted profile address is read only on the platform's own hosts (https or http, no credentials, no
 * port); its query and fragment are dropped (`?igsh=…`). Any other address, host or scheme (`javascript:`,
 * `data:`, a look-alike host) is null. A handle must be plain ASCII; nothing is encoded or decoded.
 */
export function cleanSocialHandle(platform: SocialPlatform, typed: string): string | null {
  const spec = SPEC.get(platform)
  if (!spec || typeof typed !== 'string') return null
  const text = typed.replace(TRIM, '')
  if (!text) return null
  if (!ADDRESS.test(text)) return spec.fromHandle(text)

  let url: URL
  try {
    // A scheme is kept (and refused below unless it is http or https); a bare `host/path` gets https.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  if (!spec.hosts.includes(url.hostname)) return null
  // Segments as written (an escape is not decoded: it would not match a format anyway).
  const segments = url.pathname.split('/').filter(Boolean)
  return spec.fromPath(segments)
}

/** Whether this is a canonical stored handle of the platform (what the database accepts). */
export function isSocialHandle(platform: SocialPlatform, handle: unknown): handle is string {
  const spec = SPEC.get(platform)
  return !!spec && typeof handle === 'string' && spec.ok(handle)
}

/**
 * The address the app opens for a stored link, from the platform's fixed template; null when the platform is
 * unknown or the handle is not canonical, so a bad row (or text that is not a handle) is never made into an address.
 */
export function socialLinkUrl(platform: SocialPlatform, handle: string): string | null {
  const spec = SPEC.get(platform)
  if (!spec || !spec.ok(handle)) return null
  return spec.url(handle)
}

/** The attributes of every outgoing link, in one place. */
export const SOCIAL_LINK_REL = 'noopener noreferrer nofollow ugc'

/** How a stored handle reads to a person: Instagram and TikTok handles with their @, the rest as stored. */
export function socialLinkLabel(platform: SocialPlatform, handle: string): string {
  return platform === 'instagram' || platform === 'tiktok' ? `@${handle}` : handle
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from './network'
import {
  DEFAULT_LINK_VISIBILITY,
  SOCIAL_PLATFORM_IDS,
  cleanSocialHandle,
  isLinkVisibility,
  isSocialHandle,
  isSocialPlatform,
  type LinkVisibility,
  type SocialPlatform,
} from '../utils/socialLinks'

/**
 * Profile links (WP-22; the formats and the one place that builds an address are utils/socialLinks.ts): her
 * profiles on other platforms, a validated handle or id per platform and never a URL. Her own list and who
 * sees it (`my_profile_links`, `set_profile_links`), and another member's, as far as her setting lets the
 * caller see (`profile_links_of`: an empty list for everyone it does not show, never a refusal that tells a
 * stranger anything). Every rule is the database's (supabase/migrations/20261028010000_profile_links.sql);
 * this file cleans what she typed the same way before it is sent, so a mistake is told at the field, and
 * reads what the database answers with the same suspicion (a row that is not a canonical handle is dropped).
 *
 * A write needs the connection (offline: `offline`, nothing is queued), like every social write.
 *
 * Framework-free: the repository receives the Supabase client and the online check.
 */

export type ProfileLink = { platform: SocialPlatform; handle: string }
export type MyProfileLinks = { links: ProfileLink[]; visibility: LinkVisibility }

/** What she typed per platform; a platform she left empty or left out has no link. */
export type ProfileLinkDrafts = Partial<Record<SocialPlatform, string>>

export type ProfileLinksErrorCode =
  | 'offline'
  | 'not_signed_in'
  | 'rate_limited'
  /** A field is not a handle of its platform; `platform` says which. */
  | 'link_invalid'
  | 'unknown'
export type ProfileLinksResult<T> =
  | { data: T; error: null; platform?: undefined }
  | { data: null; error: ProfileLinksErrorCode; platform?: SocialPlatform }

type LinksJson = { links?: unknown; visibility?: unknown }

/** Links from the database's answer: known platforms with canonical handles only, once each, in the platforms' order. */
export function linksFromJson(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<SocialPlatform, string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { platform, handle } = item as Record<string, unknown>
    if (!isSocialPlatform(platform) || !isSocialHandle(platform, handle) || seen.has(platform)) continue
    seen.set(platform, handle)
  }
  return SOCIAL_PLATFORM_IDS.filter((p) => seen.has(p)).map((platform) => ({ platform, handle: seen.get(platform)! }))
}

function mineFromJson(json: LinksJson | null): MyProfileLinks {
  return {
    links: linksFromJson(json?.links),
    visibility: isLinkVisibility(json?.visibility) ? json.visibility : DEFAULT_LINK_VISIBILITY,
  }
}

/**
 * What she typed, as the list the database takes: each field cleaned (a pasted profile address becomes its
 * handle), empty ones left out. The first field that is not a handle of its platform is the problem.
 */
export function draftsToLinks(drafts: ProfileLinkDrafts): { links: ProfileLink[]; invalid: SocialPlatform | null } {
  const links: ProfileLink[] = []
  for (const platform of SOCIAL_PLATFORM_IDS) {
    const typed = drafts[platform]?.trim()
    if (!typed) continue
    const handle = cleanSocialHandle(platform, typed)
    if (!handle) return { links, invalid: platform }
    links.push({ platform, handle })
  }
  return { links, invalid: null }
}

function mapError(failure: { message?: string; code?: string }): { error: ProfileLinksErrorCode; platform?: SocialPlatform } {
  const message = failure.message ?? ''
  const wrong = /^link_invalid:([a-z]+)$/.exec(message)?.[1]
  if (wrong && isSocialPlatform(wrong)) return { error: 'link_invalid', platform: wrong }
  if (message === 'rate_limited' || failure.code === 'PT429') return { error: 'rate_limited' }
  if (message === 'not_signed_in' || failure.code === '42501' || failure.code === 'PGRST301') return { error: 'not_signed_in' }
  return { error: 'unknown' }
}

export type ProfileLinks = {
  /** Her own links and who sees them. */
  mine: () => Promise<ProfileLinksResult<MyProfileLinks>>
  /** Replaces her list (the drafts, cleaned) and her setting. Refused offline, and for a field that is no handle, before anything is sent. */
  save: (drafts: ProfileLinkDrafts, visibility: LinkVisibility) => Promise<ProfileLinksResult<MyProfileLinks>>
  /** Another member's links, as far as she shows them to the caller; an empty list otherwise. */
  of: (member: string) => Promise<ProfileLinksResult<ProfileLink[]>>
}

export function createProfileLinks(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): ProfileLinks {
  async function call<T>(fn: string, args: Record<string, unknown> | undefined, read: (json: unknown) => T): Promise<ProfileLinksResult<T>> {
    if (!online()) return { data: null, error: 'offline' }
    const answer = await Promise.resolve(client.rpc(fn, args)).catch(() => null)
    if (!answer || isNoAnswer(answer)) return { data: null, error: 'offline' }
    if (answer.error) return { data: null, ...mapError(answer.error) }
    return { data: read(answer.data), error: null }
  }

  return {
    mine: () => call('my_profile_links', undefined, (json) => mineFromJson(json as LinksJson)),

    save(drafts, visibility) {
      const { links, invalid } = draftsToLinks(drafts)
      if (invalid) return Promise.resolve({ data: null, error: 'link_invalid', platform: invalid })
      return call('set_profile_links', { p_links: links, p_visibility: visibility }, (json) => mineFromJson(json as LinksJson))
    },

    of: (member) => call('profile_links_of', { p_member: member }, linksFromJson),
  }
}

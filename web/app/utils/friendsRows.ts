import type { MySocial } from '~/data/social'

/**
 * What the Profile's Friends rows and the privacy sheet say (social v1, U1), decided apart from the
 * screens so a test pins them and a native port copies them. Nothing here talks to anything.
 */

/** The People row's value: how many requests wait for her answer; null (nothing shown) with none, or before her settings are known. */
export function requestsValue(mine: Pick<MySocial, 'requests'> | null): number | null {
  return mine && mine.requests > 0 ? mine.requests : null
}

/** The Privacy row's value as the message key to show; null before her settings are known. */
export function privacyValueKey(mine: Pick<MySocial, 'private'> | null): 'friends.private' | 'friends.public' | null {
  if (!mine) return null
  return mine.private ? 'friends.private' : 'friends.public'
}

/** The Blocked row's value: how many members she blocked, or null for none (the row then says "None"). */
export function blockedValue(count: number | null): number | null {
  return count && count > 0 ? count : null
}

/**
 * What turning Private account on or off does. On writes at once; off asks first, because it accepts
 * every request waiting (Instagram's rule, social-v1.md A2). Already as asked: nothing.
 */
export function privateChange(current: boolean, next: boolean): 'write' | 'confirm' | 'none' {
  if (current === next) return 'none'
  return next ? 'write' : 'confirm'
}

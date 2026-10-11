// What a heart shows (social v2a, contract §1.2 and §3): the answers carry the count and whether she liked,
// and a tap shows its result at once, before the database has answered (the store's `overrides`). Pure.
import type { LikeFields } from '../data/socialShapes'

export type LikeFace = Pick<LikeFields, 'likes' | 'liked'>

/** What one tap does to a heart: a like adds one and fills it, taking it back removes one. Never below zero. */
export function toggledFace(face: LikeFace): LikeFace {
  return face.liked ? { likes: Math.max(0, face.likes - 1), liked: false } : { likes: face.likes + 1, liked: true }
}

/** A heart's own word, kept with the answer it was made against: `base` is what the row said when it was made. */
export type LikeOverride = { face: LikeFace; base: LikeFace }

/**
 * What the heart shows: her own word while the row still says what it said then, and what the row says as
 * soon as it says anything else (a feed read afresh brings the newer count; her tap's result is not older
 * news to be laid over it).
 */
export function shownFace(base: LikeFace, override: LikeOverride | undefined): LikeFace {
  if (!override) return base
  return override.base.likes === base.likes && override.base.liked === base.liked ? override.face : base
}

/** A row carries a heart when it is a finished read of another member (`sessionId`) and not a Manual book's. */
export function likeable(row: { sessionId?: string | null }): boolean {
  return typeof row.sessionId === 'string' && row.sessionId.length > 0
}

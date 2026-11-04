import { ROOM_SEGMENT } from '~/utils/buddyRoom'

/**
 * The addresses of a buddy read (`/together/<id>` the room, `/together/<id>/<section>` a thread: the Section's id, or `room` for the
 * thread of the room itself). A page whose address is not one is the app's normal 404 (`validate`), and so is every one of them
 * in a build without buddy reads (composables/useBuddyReadsFlag.ts): the route exists, draws nothing and asks the server nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isReadId = (value: unknown): boolean => typeof value === 'string' && UUID.test(value)

/** A thread's segment: a Section's id, or `room`. */
export const isSectionSegment = (value: unknown): boolean => value === ROOM_SEGMENT || isReadId(value)

/** The Section a segment names (null: the room), or `undefined` for a segment that is neither. */
export function sectionOfSegment(value: unknown): string | null | undefined {
  if (value === ROOM_SEGMENT) return null
  return isReadId(value) ? String(value) : undefined
}

/** The address of a read's room. */
export const roomPath = (readId: string): string => `/together/${readId}`

/** The address of a thread: a Section's id, or null for the room. */
export const threadPath = (readId: string, sectionId: string | null): string => `/together/${readId}/${sectionId ?? ROOM_SEGMENT}`

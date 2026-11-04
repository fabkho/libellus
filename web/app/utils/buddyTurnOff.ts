import type { BuddyErrorCode, MyBuddyReads } from '~/data/buddyReads'

/**
 * Turning Buddy reads off (Profile → Account, docs/plans/buddy-read-shared.md part 4.6 and 5.5): the switch only hides the entry points, it
 * does not stop a room showing her Section, so it is turned off only after she left every room (and declined every invitation). Pure
 * functions on plain data, so Vitest drives them in Node; the store (stores/buddyTurnOff.ts) holds the state and asks the database.
 *
 * "In a room" is every read of hers `my_buddy_reads()` lists, an ended one too: a finished or archived room still lists its members and
 * keeps the Section she ended with (migration 20261113010000, `private.buddy_co_members`), so only leaving it stops that.
 */

/** What turning it off has to undo: the reads she is in and the invitations waiting for her, by id. */
export type TurnOffPlan = { rooms: string[]; invitations: string[] }

/** The plan for the list as the database gave it (nothing known yet: nothing to undo, the caller loads the list first). */
export function turnOffPlan(mine: MyBuddyReads | null): TurnOffPlan {
  return { rooms: (mine?.reads ?? []).map((r) => r.id), invitations: (mine?.invitations ?? []).map((i) => i.id) }
}

/** Whether she has to leave or decline anything before the switch may go off. */
export const needsLeaving = (plan: TurnOffPlan): boolean => plan.rooms.length + plan.invitations.length > 0

/** A sentence of the message file with the number it counts (`t(key, { count }, count)`). */
export type Counted = { key: string; count: number }

/** What the confirm says: `deleteOption` is whether messages are in play at all (only a room holds any). */
export type TurnOffView = {
  titleKey: string
  /** Sentences, in order: how many rooms she leaves, how many invitations are declined. */
  parts: Counted[]
  actionKey: string
  /** The "Also delete my messages" option and its explanation: only when she leaves at least one room. */
  deleteOption: boolean
}

export function turnOffView(plan: TurnOffPlan): TurnOffView {
  const rooms = plan.rooms.length
  const invitations = plan.invitations.length
  const parts: Counted[] = []
  if (rooms) parts.push({ key: 'profile.buddyReadsOff.rooms', count: rooms })
  if (invitations) parts.push({ key: 'profile.buddyReadsOff.invitations', count: invitations })
  return {
    titleKey: rooms ? 'profile.buddyReadsOff.title' : 'profile.buddyReadsOff.titleInvitations',
    parts,
    actionKey: rooms ? 'profile.buddyReadsOff.action' : 'profile.buddyReadsOff.actionInvitations',
    deleteOption: rooms > 0,
  }
}

/** The line under the row while she is in a room ("You're in 2 buddy reads"); null when she is in none (a waiting invitation is no room). */
export function inRoomsHint(mine: MyBuddyReads | null): Counted | null {
  const rooms = mine?.reads.length ?? 0
  return rooms ? { key: 'profile.account.buddyReadsIn', count: rooms } : null
}

/** What the sequence may call: both answer `{ error }` like the store's `leave` and `answerInvite`. */
export type TurnOffCalls = {
  leave: (id: string, deleteMessages: boolean) => Promise<{ error: BuddyErrorCode | null }>
  decline: (id: string) => Promise<{ error: BuddyErrorCode | null }>
}

/**
 * Leaves the rooms in order, then declines the invitations; stops at the first refusal and answers its code (what was left stays left).
 * `not_found` is not a refusal: she is not in it (any more), which is what was asked for. `deleteMessages` goes to every `leave`.
 * Answers null when everything is done.
 */
export async function leaveAndDecline(plan: TurnOffPlan, calls: TurnOffCalls, deleteMessages: boolean): Promise<BuddyErrorCode | null> {
  for (const id of plan.rooms) {
    const { error } = await calls.leave(id, deleteMessages)
    if (error && error !== 'not_found') return error
  }
  for (const id of plan.invitations) {
    const { error } = await calls.decline(id)
    if (error && error !== 'not_found') return error
  }
  return null
}

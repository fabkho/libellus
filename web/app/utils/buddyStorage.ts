/**
 * Where a buddy read keeps what is hers on this device. Plain strings and one reader, no chat layer, no store: the shell (the session
 * store's sign-out, data/localData.ts, the header's invitation lamp) may import this file, the big store (stores/buddyRead.ts) may not be
 * imported by it (tests/buddy-read-entry.test.ts). All under `libellus.`, so signing out and another member signing in forget it.
 */
export const BUDDY_STORAGE_PREFIX = 'libellus.buddyRead'
/** The send queue's keys start with this; one member's line is `queue.<member>` and the queue adds `.<tab>` to it (the layer's `claimQueue`). */
export const BUDDY_QUEUE_PREFIX = `${BUDDY_STORAGE_PREFIX}.queue.`
/** The send queue of one member. */
export const buddyQueueKey = (member: string): string => `${BUDDY_QUEUE_PREFIX}${member}`
/** The Sections she opened anyway on this device (the layer's `createPeeks`). */
export const buddyPeekKey = (member: string): string => `${BUDDY_STORAGE_PREFIX}.peeks.${member}`

/** Whether the device holds an unsent message of hers (a line left by a closed page, a killed app, a reload): the line is stored only while it has something in it. */
export function deviceHasBuddyLine(storage: { readonly length: number; key: (index: number) => string | null; getItem: (key: string) => string | null }, member: string): boolean {
  const prefix = buddyQueueKey(member)
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key === prefix || key?.startsWith(`${prefix}.`)) {
      try {
        const stored = JSON.parse(storage.getItem(key) ?? 'null') as { jobs?: unknown[] } | null
        if (stored && Array.isArray(stored.jobs) && stored.jobs.length > 0) return true
      } catch {
        // A broken line is nobody's.
      }
    }
  }
  return false
}

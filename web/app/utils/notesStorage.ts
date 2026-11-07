/**
 * Where Notes keep what is hers on this device. Plain strings and no chat layer, no store: the shell's sign-out (data/localData.ts) names the queue's prefix, and the big
 * store (stores/notes.ts) uses all of them. All under `libellus.`, so signing out and another member signing in forget them.
 */
export const NOTES_STORAGE_PREFIX = 'libellus.notes'
/** The send queue's keys start with this (the layer's `claimQueue` adds `.<tab>`); a dead session keeps it, as a buddy read's. */
export const NOTES_QUEUE_PREFIX = `${NOTES_STORAGE_PREFIX}.queue.`
export const notesQueueKey = (member: string): string => `${NOTES_QUEUE_PREFIX}${member}`
/** The chapters she opened anyway, per member and room (the layer's `createPeeks`). */
export const notesPeekKey = (member: string, roomId: string): string => `${NOTES_STORAGE_PREFIX}.peeks.${member}.${roomId}`

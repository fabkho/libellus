/**
 * A friend already picked as invitee when the setup sheet opens from a "Potential buddy reads" cover (docs/parity.md, *Buddy read, the Book page action*):
 * the cover links to `/book/<key>?with=<friendId>`, and the Book page's action hands that id to the sheet, which ticks the friend in its picker.
 * Only a default: she can untick it, and a sheet opened without the parameter behaves as ever. Pure: no Vue, no Supabase; Vitest drives it in plain Node.
 *
 * The parameter is untrusted (a link anyone can write), so it is read as one id or nothing: a value that is not a member id, a parameter given twice
 * (which of the two?), an id that is her own or one the picker would not offer (not someone she follows; a member she blocked is not followed) is
 * ignored, silently, never an error.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The query parameter's name. */
export const WITH_PARAM = 'with'

/** The address of a Book's page that starts the read with a friend already picked. */
export const bookWith = (bookId: string, friend: string): string => `/book/${bookId}?${WITH_PARAM}=${friend}`

/** The id the parameter names, or null: it must be given once and be an id (the router hands a repeated parameter as an array). */
export function withParam(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value.toLowerCase() : null
}

/**
 * The friend to tick, or null. `offered`: the ids the picker would offer (the members she follows); `leave`: ids that never are (hers, the ones she blocked).
 */
export function preselected(value: unknown, { offered, leave = [] }: { offered: readonly string[]; leave?: readonly (string | null | undefined)[] }): string | null {
  const id = withParam(value)
  if (!id) return null
  const same = (other: string | null | undefined) => !!other && other.toLowerCase() === id
  if (leave.some(same)) return null
  return offered.some(same) ? id : null
}

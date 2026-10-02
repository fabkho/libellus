/**
 * Two letters for the header avatar, from what an account has: the address.
 * `ida.tester@example.com` → "IT", `ida@example.com` → "ID". Pure, so a native
 * port copies it line for line and the tests pin it.
 */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  const words = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters =
    words.length >= 2
      ? [...(words[0] ?? '')][0]! + [...(words[1] ?? '')][0]!
      : [...(words[0] ?? '')].slice(0, 2).join('')
  return letters.toLocaleUpperCase() || '?'
}

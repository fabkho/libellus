/**
 * Who has Your shelf (#23): one account, the owner's, named by the app's
 * configuration (`NUXT_PUBLIC_SHELF_OWNER_ID`, her auth user id); nobody when
 * none is named. The library file it shows is public (the portfolio shows it),
 * so this hides screens, it protects nothing. Its own module, framework-free
 * and tiny: the shelf page's route guard runs it before the page loads, so it
 * sits in the app's entry, without the rest of the shelf (data/shelf.ts).
 */
export function isShelfOwner(memberId: string | null | undefined, ownerId: unknown): boolean {
  const owner = typeof ownerId === 'string' ? ownerId.trim() : ''
  return owner !== '' && memberId === owner
}

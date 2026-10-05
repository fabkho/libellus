import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import type { BookSnapshot } from '@/data/books'
import type { SessionStorage } from '@/data/createSupabaseClient'
import { readLibrary, readSavedMember, saveLibrary } from '@/data/deviceLibrary'
import { createCollections } from '@/data/collections'
import { createLibrary } from '@/data/library'
import { clearLocalData, type DeviceStorage } from '@/data/localData'
import { createManualBooks } from '@/data/manualBooks'
import { signUpMember } from './support/member'
import { accountExists, authUserExists, createInviteCode, newClient, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Deleting the account (issue #101) through the data layer, against the local
 * stack, as a real signed-in member: `deleteAccount` removes the sign-in and
 * everything the member owns, refuses offline before anything is sent, leaves
 * other members and the shared Catalogue alone, ends the session on the device,
 * and the address can only come back with a new invite. What the session store
 * does on top (the device forgets the member) is `clearLocalData` here.
 */

function browserStorage(): SessionStorage & DeviceStorage & { keys: () => string[] } {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    keys: () => [...items.keys()].sort(),
  }
}

function catalogueBook(title: string, appleId: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Odile Marsh'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

async function count(query: string, id: string): Promise<number> {
  return Number((await sql<{ n: string }>(query, [id]))[0]!.n)
}

describe('deleteAccount', () => {
  it('refuses offline before anything is sent, and removes nothing', async () => {
    const ida = await signUpMember()

    const result = await createAuth(ida.client).deleteAccount({ online: () => false })

    expect(result).toEqual({ error: 'offline' })
    expect(await authUserExists(ida.email)).toBe(true)
    expect((await ida.client.auth.getSession()).data.session).not.toBeNull()
  })

  it('removes the member and everything she owns, and ends her session', async () => {
    const storage = browserStorage()
    const ida = await signUpMember(storage)
    const library = createLibrary(ida.client)
    const added = await library.addToLibrary(catalogueBook('The Shared Book', uniqueAppleId()), { status: 'finished', startedOn: '2026-01-01', endedOn: '2026-01-02', rating: 16, review: 'Good.' })
    expect(added.error).toBeNull()
    const manual = await createManualBooks(ida.client).addManualBook({ title: runTitle('Ida only'), author: 'Ida' })
    expect(manual.error).toBeNull()
    const shelf = await createCollections(ida.client).create('Mine')
    expect(shelf.error).toBeNull()
    expect(await count('select count(*) n from public.library_entries where member_id = $1', ida.id)).toBe(2)
    const sharedBookId = added.data!.book.id

    const result = await createAuth(ida.client).deleteAccount()

    expect(result).toEqual({ error: null })
    expect(await authUserExists(ida.email)).toBe(false)
    expect(await accountExists(ida.email)).toBe(false)
    expect(await count('select count(*) n from public.library_entries where member_id = $1', ida.id)).toBe(0)
    expect(await count('select count(*) n from public.books where owner_id = $1', ida.id)).toBe(0)
    expect(await count('select count(*) n from public.collections where member_id = $1', ida.id)).toBe(0)
    expect(await count('select count(*) n from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.member_id = $1', ida.id)).toBe(0)
    expect(await count('select count(*) n from public.synced_writes where member_id = $1', ida.id)).toBe(0)
    expect(await count('select count(*) n from auth.sessions where user_id = $1', ida.id)).toBe(0)
    // The shared Catalogue Book stays.
    expect(await count('select count(*) n from public.books where id = $1', sharedBookId)).toBe(1)
    // The session is gone from the device, too.
    expect(storage.keys()).toEqual([])
    expect(await createAuth(newClient(storage)).currentMember()).toBeNull()
  })

  it('leaves other members alone, even on the same Catalogue Book', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const snapshot = catalogueBook('Both read it', uniqueAppleId())
    expect((await createLibrary(ida.client).addToLibrary(snapshot)).error).toBeNull()
    const maxEntry = await createLibrary(max.client).addToLibrary(snapshot)
    expect(maxEntry.error).toBeNull()

    expect((await createAuth(ida.client).deleteAccount()).error).toBeNull()

    expect(await authUserExists(max.email)).toBe(true)
    const kept = await createLibrary(max.client).entries('want_to_read')
    expect(kept.data?.map((entry) => entry.id)).toContain(maxEntry.data!.id)
  })

  it('does not hand the invite back: the address comes back only with a new one', async () => {
    const ida = await signUpMember()
    const [{ code, uses }] = await sql<{ code: string; uses: number }>(
      `select c.code::text code, c.uses from public.accounts a join public.invite_codes c on c.id = a.invite_code_id where a.id = $1`,
      [ida.id],
    )
    expect(uses).toBe(1)

    expect((await createAuth(ida.client).deleteAccount()).error).toBeNull()

    expect((await sql<{ uses: number }>('select uses from public.invite_codes where code = $1::citext', [code]))[0]!.uses).toBe(1)
    const again = createAuth(newClient())
    // Signing in finds nobody on the address…
    expect(await again.requestCode(ida.email)).toEqual({ kind: 'unknownEmail' })
    // …and signing up with the spent invite is refused; a new one is needed.
    expect((await again.requestSignUpCode({ email: ida.email, inviteCode: code })).error).toBe('invite_exhausted')
    const fresh = await createInviteCode({ maxUses: 1 })
    expect((await again.requestSignUpCode({ email: ida.email, inviteCode: fresh })).error).toBeNull()
  })

  it('is refused for a client that is not signed in', async () => {
    const { error } = await createAuth(newClient()).deleteAccount()
    expect(error).toBe('unknown')
  })
})

describe('what the device forgets afterwards', () => {
  it('is everything under the Libellus prefix; the theme stays', async () => {
    const storage = browserStorage()
    const ida = await signUpMember(storage)
    saveLibrary(storage, { member: { id: ida.id, email: ida.email }, lists: { want_to_read: [], reading: [], finished: [] }, readInYear: null })
    storage.setItem('libellus-theme', 'dark')

    expect((await createAuth(ida.client).deleteAccount()).error).toBeNull()
    clearLocalData(storage)

    expect(readLibrary(storage, ida.id)).toBeNull()
    expect(readSavedMember(storage)).toBeNull()
    expect(storage.keys()).toEqual(['libellus-theme'])
  })
})

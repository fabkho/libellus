import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  createAvatar,
  encodeAvatar,
  mayRetryMemberPhoto,
  MEMBER_PHOTO_RETRY_MS,
  memberPhotoPlan,
  memoryAvatarCache,
  type AvatarFiles,
  type AvatarRaster,
  type AvatarType,
} from '@/data/avatar'
import { signUpMember } from './support/member'

/**
 * The photos of the members in her circle (social v1, U7). The pure part first:
 * what the device does with a member's record given her card (`memberPhotoPlan`
 * and the minute's wait after a failed download), which is all the store
 * decides that is not IndexedDB-bound. Then the bucket, as real members: Ada's
 * photo is hers alone until Ben is connected to her (here: he opened her
 * follow link), and then he can download both files through the same
 * repository the store uses.
 */

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/** A 600 × 600 gradient, encoded the way the app does it (sharp stands in for the canvas). */
async function photoFiles(): Promise<AvatarFiles> {
  const size = 600
  const pixels = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      pixels[i] = (x / size) * 255
      pixels[i + 1] = (y / size) * 255
      pixels[i + 2] = 128
    }
  }
  const source = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer()
  const raster: AvatarRaster = {
    async encode(side: number, type: AvatarType, quality: number) {
      const image = sharp(source).resize(side, side)
      const out = type === 'image/webp' ? image.webp({ quality: Math.round(quality * 100) }) : image.jpeg({ quality: Math.round(quality * 100) })
      return new Blob([new Uint8Array(await out.toBuffer())], { type })
    },
  }
  return encodeAvatar(raster, size)
}

const A = 'aaaaaaaa-0000-4000-8000-000000000001/' + 'ab'.repeat(16) + '.webp'
const B = 'aaaaaaaa-0000-4000-8000-000000000001/' + 'cd'.repeat(16) + '.webp'

describe("what the device does with another member's record", () => {
  it('shows nothing for a member with no photo and no record', () => {
    expect(memberPhotoPlan(null, null)).toBe('none')
  })

  it('downloads a photo the device does not have yet', () => {
    expect(memberPhotoPlan(null, A)).toBe('fetch')
  })

  it('keeps a record whose path is the card’s', () => {
    expect(memberPhotoPlan(A, A)).toBe('keep')
  })

  it('replaces a record whose path differs from the card’s (a new photo)', () => {
    expect(memberPhotoPlan(A, B)).toBe('fetch')
  })

  it('deletes the record when the card shows no photo any more (blocked, removed, gone private)', () => {
    expect(memberPhotoPlan(A, null)).toBe('delete')
  })
})

describe('asking again after a failed download', () => {
  it('asks at once when nothing failed or the failure was for another path', () => {
    expect(mayRetryMemberPhoto(null, A, 1000)).toBe(true)
    expect(mayRetryMemberPhoto({ path: B, at: 1000 }, A, 1001)).toBe(true)
  })

  it('waits a minute for the same path, then asks', () => {
    expect(mayRetryMemberPhoto({ path: A, at: 1000 }, A, 1000 + MEMBER_PHOTO_RETRY_MS - 1)).toBe(false)
    expect(mayRetryMemberPhoto({ path: A, at: 1000 }, A, 1000 + MEMBER_PHOTO_RETRY_MS)).toBe(true)
  })
})

describe('the device’s record of a member', () => {
  it('is one per member id: written, replaced, deleted', async () => {
    const files = await photoFiles()
    const cache = memoryAvatarCache()
    await cache.write('ben', { path: A, ...files })
    expect((await cache.read('ben'))?.path).toBe(A)
    await cache.write('ben', { path: B, ...files })
    expect((await cache.read('ben'))?.path).toBe(B)
    await cache.write('ben', null)
    expect(await cache.read('ben')).toBeNull()
  })
})

describe("another member's photo in the bucket", () => {
  it('is refused to a member who is not connected, and downloads once she opened the follow link', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    const files = await photoFiles()
    const saved = await createAvatar(ada.client).save(files)
    expect(saved.error).toBeNull()
    const path = saved.data!.path!

    const bens = createAvatar(ben.client)
    const refused = await bens.download(path)
    expect(refused.data).toBeNull()
    expect(refused.error).not.toBeNull()

    const mine = await ada.client.rpc('my_social')
    expect(mine.error).toBeNull()
    const opened = await ben.client.rpc('follow_target', { p_token: mine.data.link })
    expect(opened.error).toBeNull()

    const downloaded = await bens.download(path)
    expect(downloaded.error).toBeNull()
    expect(await bytesOf(downloaded.data!.large)).toEqual(await bytesOf(files.large))
    expect(await bytesOf(downloaded.data!.small)).toEqual(await bytesOf(files.small))

    // Still hers to change: Ben can neither list her folder's files for writing nor remove them.
    expect((await ben.client.storage.from('avatars').remove([path])).data ?? []).toEqual([])
    expect((await createAvatar(ada.client).download(path)).error).toBeNull()

    await createAvatar(ada.client).remove()
  })
})

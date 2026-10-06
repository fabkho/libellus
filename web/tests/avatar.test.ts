import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import {
  AVATAR_MAX_BYTES,
  avatarPaths,
  avatarSides,
  createAvatar,
  encodeAvatar,
  metadataIn,
  smallAvatarPath,
  stripMetadata,
  type AvatarFiles,
  type AvatarRaster,
  type AvatarType,
} from '@/data/avatar'
import { clampPan, cropRect, initialCrop, MAX_ZOOM, panBy, rescale, zoomAround, type CropRect } from '@/utils/crop'
import { signUpMember } from './support/member'
import { authUserExists, newClient, sql } from './support/stack'

/**
 * The member's profile photo (issue #156). The pure part first: the crop's
 * geometry, the two sides, and the pipeline that turns the cut-out into the
 * files that are uploaded — WebP or JPEG, ≤ 100 kB, and with no metadata left,
 * even from an encoder that copies a photo's EXIF and GPS along (the browser's
 * canvas does not; the pipeline does not rely on it). The pipeline runs here
 * through sharp, the way the app runs it through a canvas
 * (utils/avatarRaster.ts). Then the repository against the local stack, as
 * real members: upload, replace, remove, and nobody else near her files.
 */

// ------------------------------------------------------------------ fixtures

const GPS_EXIF = {
  IFD0: { Make: 'Libellus Test Camera', Model: 'Pocket', Copyright: 'Ida' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 36/1' },
}
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Ida"/></rdf:RDF></x:xmpmeta>'

/** A phone's photo: 1600 × 1200, a soft gradient with a little grain, EXIF with GPS and XMP. */
async function phonePhoto(format: 'jpeg' | 'webp' = 'jpeg'): Promise<Buffer> {
  const width = 1600
  const height = 1200
  const pixels = Buffer.alloc(width * height * 3)
  let seed = 7
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const grain = (seed % 17) - 8
      const i = (y * width + x) * 3
      pixels[i] = Math.max(0, Math.min(255, (x / width) * 200 + 30 + grain))
      pixels[i + 1] = Math.max(0, Math.min(255, (y / height) * 160 + 50 + grain))
      pixels[i + 2] = Math.max(0, Math.min(255, 120 + grain))
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } }).withExif(GPS_EXIF).withXmp(XMP)
  return format === 'jpeg' ? image.jpeg({ quality: 92 }).toBuffer() : image.webp({ quality: 92 }).toBuffer()
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/**
 * The pipeline's raster through sharp. `copiesMetadata` makes it the worst
 * encoder there could be, one that carries the photo's EXIF, GPS, ICC and
 * XMP into what it writes; `webp: false` is Safari, which hands PNG back
 * when asked for WebP.
 */
function sharpRaster(input: Buffer, rect: CropRect, { copiesMetadata = true, webp = true } = {}): AvatarRaster & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async encode(side: number, type: AvatarType, quality: number) {
      asked.push(`${side} ${type} ${quality}`)
      let image = sharp(input)
        .extract({ left: Math.round(rect.x), top: Math.round(rect.y), width: Math.round(rect.size), height: Math.round(rect.size) })
        .resize(side, side)
      if (copiesMetadata) image = image.keepMetadata()
      if (type === 'image/webp' && !webp) return new Blob([new Uint8Array(await image.png().toBuffer())], { type: 'image/png' })
      const out = type === 'image/webp' ? image.webp({ quality: Math.round(quality * 100) }) : image.jpeg({ quality: Math.round(quality * 100) })
      return new Blob([new Uint8Array(await out.toBuffer())], { type })
    },
  }
}

async function photoFiles(): Promise<AvatarFiles> {
  const photo = await phonePhoto()
  const rect = cropRect(initialCrop({ width: 1600, height: 1200 }, 320), { width: 1600, height: 1200 }, 320)
  return encodeAvatar(sharpRaster(photo, rect), rect.size)
}

// ------------------------------------------------------------------ the crop

describe('the crop', () => {
  const image = { width: 4000, height: 3000 }

  it('starts at zoom 1 with the largest square in the middle of the picture', () => {
    const state = initialCrop(image, 300)
    expect(state.zoom).toBe(1)
    expect(cropRect(state, image, 300)).toEqual({ x: 500, y: 0, size: 3000 })
  })

  it('never lets the picture leave a gap in the square', () => {
    const state = panBy(initialCrop(image, 300), 10_000, -10_000, image, 300)
    expect(state.x).toBe(0)
    expect(cropRect(state, image, 300)).toEqual({ x: 0, y: 0, size: 3000 })
    const other = panBy(state, -10_000, 0, image, 300)
    expect(cropRect(other, image, 300).x).toBe(1000)
  })

  it('zooms around the point under the fingers, between 1 and 4', () => {
    const start = initialCrop(image, 300)
    const centre = { x: 150, y: 150 }
    const zoomed = zoomAround(start, 2, centre, image, 300)
    expect(zoomed.zoom).toBe(2)
    expect(cropRect(zoomed, image, 300)).toEqual({ x: 1250, y: 750, size: 1500 })
    expect(zoomAround(start, 99, centre, image, 300).zoom).toBe(MAX_ZOOM)
    expect(zoomAround(zoomed, 0.1, centre, image, 300).zoom).toBe(1)
    expect(clampPan({ zoom: Number.NaN, x: 0, y: 0 }, image, 300).zoom).toBe(1)
  })

  it('keeps the same cut-out when the square changes size', () => {
    const zoomed = zoomAround(initialCrop(image, 300), 2, { x: 100, y: 200 }, image, 300)
    const bigger = rescale(zoomed, 300, 450, image)
    expect(cropRect(bigger, image, 450)).toEqual(cropRect(zoomed, image, 300))
  })
})

// ------------------------------------------------------------------ the files

describe('the photo made on the device', () => {
  it('is 512 and 128 px, never upscaled', () => {
    expect(avatarSides(3000)).toEqual({ large: 512, small: 128 })
    expect(avatarSides(300.7)).toEqual({ large: 300, small: 128 })
    expect(avatarSides(90)).toEqual({ large: 90, small: 90 })
  })

  it('is WebP, square, small, and without the EXIF, GPS and XMP of the photo it came from', async () => {
    const photo = await phonePhoto()
    expect(metadataIn(new Uint8Array(photo))).toEqual(expect.arrayContaining(['exif', 'xmp']))
    const exif = (await sharp(photo).metadata()).exif!
    expect(exif.toString('latin1')).toContain('Libellus Test Camera')
    // The GPS IFD's pointer (tag 0x8825), in either byte order.
    expect(exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]))).toBe(true)

    const rect = cropRect(initialCrop({ width: 1600, height: 1200 }, 320), { width: 1600, height: 1200 }, 320)
    const files = await encodeAvatar(sharpRaster(photo, rect), rect.size)

    expect(files.type).toBe('image/webp')
    for (const [file, side] of [[files.large, 512], [files.small, 128]] as const) {
      expect(file.type).toBe('image/webp')
      expect(file.size).toBeLessThanOrEqual(AVATAR_MAX_BYTES)
      const bytes = await bytesOf(file)
      expect(metadataIn(bytes)).toEqual([])
      const meta = await sharp(bytes).metadata()
      expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: side, height: side })
      expect(meta.exif).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
      expect(meta.icc).toBeUndefined()
      expect(Buffer.from(bytes).toString('latin1')).not.toContain('Libellus Test Camera')
    }
  })

  it('is JPEG for both files where the browser cannot encode WebP, without metadata too', async () => {
    const photo = await phonePhoto()
    const rect = { x: 200, y: 0, size: 1200 }
    const raster = sharpRaster(photo, rect, { webp: false })
    const files = await encodeAvatar(raster, rect.size)

    expect(files.type).toBe('image/jpeg')
    expect(raster.asked[0]).toBe('512 image/webp 0.86')
    for (const [file, side] of [[files.large, 512], [files.small, 128]] as const) {
      const bytes = await bytesOf(file)
      expect(file.size).toBeLessThanOrEqual(AVATAR_MAX_BYTES)
      expect(metadataIn(bytes)).toEqual([])
      const meta = await sharp(bytes).metadata()
      expect({ format: meta.format, width: meta.width, exif: meta.exif, icc: meta.icc }).toEqual({ format: 'jpeg', width: side, exif: undefined, icc: undefined })
    }
  })

  it('steps the quality down until a file fits, and keeps the last step when none does', async () => {
    // An encoder whose files shrink with the quality: 300 kB at 0.86, 50 kB from 0.6 on.
    const sizes: Record<string, number> = { '0.86': 300_000, '0.78': 200_000, '0.7': 120_000, '0.6': 50_000 }
    const asked: number[] = []
    const raster: AvatarRaster = {
      async encode(side, type, quality) {
        asked.push(quality)
        return new Blob([new Uint8Array(side === 512 ? (sizes[String(quality)] ?? 40_000) : 4_000)], { type })
      },
    }
    const files = await encodeAvatar(raster, 2000)
    expect(asked).toEqual([0.86, 0.78, 0.7, 0.6, 0.86])
    expect(files.large.size).toBe(50_000)

    const stubborn: AvatarRaster = { encode: async (_, type) => new Blob([new Uint8Array(150_000)], { type }) }
    expect((await encodeAvatar(stubborn, 2000)).large.size).toBe(150_000)
  })
})

describe('stripMetadata', () => {
  it('takes EXIF, XMP and ICC out of a JPEG and leaves a picture that decodes the same', async () => {
    const jpeg = new Uint8Array(await sharp(await phonePhoto()).resize(64, 48).keepMetadata().withIccProfile('srgb').jpeg().toBuffer())
    expect(metadataIn(jpeg)).toEqual(expect.arrayContaining(['exif', 'xmp', 'icc']))
    const clean = stripMetadata(jpeg)
    expect(metadataIn(clean)).toEqual([])
    expect(clean.length).toBeLessThan(jpeg.length)
    const [before, after] = await Promise.all([sharp(jpeg).raw().toBuffer(), sharp(clean).raw().toBuffer()])
    expect(after.equals(before)).toBe(true)
  })

  it('takes EXIF, XMP and ICC chunks out of a WebP, with their flags and the RIFF size', async () => {
    const webp = new Uint8Array(await sharp(await phonePhoto('webp')).resize(64, 48).keepMetadata().withIccProfile('srgb').webp().toBuffer())
    expect(metadataIn(webp)).toEqual(expect.arrayContaining(['exif', 'xmp', 'icc']))
    const clean = stripMetadata(webp)
    expect(metadataIn(clean)).toEqual([])
    expect(new DataView(clean.buffer, clean.byteOffset).getUint32(4, true)).toBe(clean.length - 8)
    const meta = await sharp(clean).metadata()
    expect({ width: meta.width, height: meta.height, exif: meta.exif, xmp: meta.xmp }).toEqual({ width: 64, height: 48, exif: undefined, xmp: undefined })
  })

  it('leaves a file without metadata, and anything that is not JPEG or WebP, as it was', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect(stripMetadata(png)).toBe(png)
    expect(metadataIn(png)).toEqual([])
  })
})

describe('the paths', () => {
  it('are the member’s folder, the hash, and -128 for the small copy', () => {
    const id = '0f1e2d3c-0000-4000-8000-000000000001'
    expect(avatarPaths(id, 'ab'.repeat(16), 'image/webp')).toEqual({ large: `${id}/${'ab'.repeat(16)}.webp`, small: `${id}/${'ab'.repeat(16)}-128.webp` })
    expect(smallAvatarPath(`${id}/${'cd'.repeat(16)}.jpg`)).toBe(`${id}/${'cd'.repeat(16)}-128.jpg`)
  })
})

// ------------------------------------------------------------------ the repository

async function filesIn(memberId: string): Promise<string[]> {
  const rows = await sql<{ name: string }>(
    `select name from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = $1 order by name`,
    [memberId],
  )
  return rows.map((r) => r.name)
}

describe('the photo in the bucket', () => {
  it('is uploaded, named on her account, downloaded again, replaced and removed', async () => {
    const ida = await signUpMember()
    const avatar = createAvatar(ida.client)
    expect(await avatar.current()).toEqual({ data: { path: null, updatedAt: null }, error: null })

    const first = await photoFiles()
    const saved = await avatar.save(first)
    expect(saved.error).toBeNull()
    const path = saved.data!.path!
    expect(path).toMatch(new RegExp(`^${ida.id}/[0-9a-f]{32}\\.webp$`))
    expect(await filesIn(ida.id)).toEqual([smallAvatarPath(path), path].sort())
    const current = await avatar.current()
    expect(current.data?.path).toBe(path)
    expect(current.data?.updatedAt).toBeTruthy()

    const downloaded = await avatar.download(path)
    expect(downloaded.error).toBeNull()
    expect(await bytesOf(downloaded.data!.large)).toEqual(await bytesOf(first.large))
    expect(await bytesOf(downloaded.data!.small)).toEqual(await bytesOf(first.small))

    // Another photo: a new path, and the files of the first are gone.
    const photo = await phonePhoto()
    const second = await encodeAvatar(sharpRaster(photo, { x: 0, y: 0, size: 900 }), 900)
    const replaced = await avatar.save(second)
    expect(replaced.data?.path).not.toBe(path)
    expect(await filesIn(ida.id)).toEqual([replaced.data!.path!, smallAvatarPath(replaced.data!.path!)].sort())

    const removed = await avatar.remove()
    expect(removed).toEqual({ data: { path: null, updatedAt: expect.any(String) }, error: null })
    expect((await avatar.current()).data?.path).toBeNull()
    expect(await filesIn(ida.id)).toEqual([])
  })

  it('is refused offline before anything is sent', async () => {
    const ida = await signUpMember()
    const avatar = createAvatar(ida.client, { online: () => false })
    expect(await avatar.save(await photoFiles())).toEqual({ data: null, error: 'offline' })
    expect(await avatar.remove()).toEqual({ data: null, error: 'offline' })
    expect(await filesIn(ida.id)).toEqual([])
  })

  it('is hers alone: another member and a signed-out caller can neither read, list, overwrite nor delete it', async () => {
    const ida = await signUpMember()
    const bea = await signUpMember()
    const files = await photoFiles()
    const path = (await createAvatar(ida.client).save(files)).data!.path!

    const beas = bea.client.storage.from('avatars')
    expect((await beas.download(path)).error).not.toBeNull()
    expect((await beas.list(ida.id)).data ?? []).toEqual([])
    expect((await beas.upload(path, files.large, { upsert: true, contentType: 'image/webp' })).error).not.toBeNull()
    expect((await beas.upload(`${ida.id}/${'ee'.repeat(16)}.webp`, files.large, { contentType: 'image/webp' })).error).not.toBeNull()
    await beas.remove([path])
    expect((await bea.client.rpc('set_avatar', { p_path: path })).error?.message).toContain('avatar_path_invalid')
    expect((await createAvatar(bea.client).download(path)).error).not.toBeNull()

    const anon = newClient().storage.from('avatars')
    expect((await anon.download(path)).error).not.toBeNull()
    expect((await anon.list(ida.id)).data ?? []).toEqual([])
    expect((await anon.upload(`${ida.id}/${'ff'.repeat(16)}.webp`, files.large, { contentType: 'image/webp' })).error).not.toBeNull()
    await anon.remove([path])
    // Nor through a public URL: the bucket has none.
    const publicUrl = anon.getPublicUrl(path).data.publicUrl
    expect((await fetch(publicUrl)).ok).toBe(false)

    expect(await filesIn(ida.id)).toEqual([path, smallAvatarPath(path)].sort())
    await createAvatar(ida.client).remove()
  })

  it('takes only the agreed shape, and a file the bucket would not keep is refused', async () => {
    const ida = await signUpMember()
    const bucket = ida.client.storage.from('avatars')
    expect((await bucket.upload(`${ida.id}/me.png`, new Blob([new Uint8Array(10)], { type: 'image/png' }))).error).not.toBeNull()
    const huge = new Blob([new Uint8Array(300 * 1024)], { type: 'image/webp' })
    const refused = await createAvatar(ida.client).save({ large: huge, small: huge, type: 'image/webp' })
    expect(refused.error).toBe('too_large')
    expect(await filesIn(ida.id)).toEqual([])
  })

  it('goes with her account: deleting it empties her folder first, and the database refuses while a file is left', async () => {
    const ida = await signUpMember()
    await createAvatar(ida.client).save(await photoFiles())
    expect(await filesIn(ida.id)).toHaveLength(2)

    const refused = await ida.client.rpc('delete_my_account')
    expect(refused.error?.message).toContain('photo_remains')
    expect(await authUserExists(ida.email)).toBe(true)

    expect(await createAuth(ida.client).deleteAccount()).toEqual({ error: null })
    expect(await authUserExists(ida.email)).toBe(false)
    expect(await filesIn(ida.id)).toEqual([])
  })
})

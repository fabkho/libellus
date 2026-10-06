import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { metadataIn } from '../app/data/avatar'
import { serviceRoleKey, sql, stack } from '../tests/support/stack'
import { test } from './fixtures'
import { openProfile, signedIn, untilStill } from './support'

/**
 * The member's own profile photo (issue #156), in Chromium (WebP encoding,
 * like Android's Chrome): picked from the Profile's Photo row, placed in the
 * round crop with the keyboard, saved; it shows in the hero and in every tab's
 * header, it is a 512 px WebP under 100 kB without the photo's EXIF and GPS,
 * and the device keeps it for a start without the backend. Replaced from the
 * hero's avatar (the old files go), then removed: the initials are back and
 * her folder is empty. With docs/parity.md (Profile photo) the reference.
 */
test.use({ browserName: 'chromium' })

/** A phone's photo: 1200 × 900 with the camera, the time and a GPS position in its EXIF. */
async function phonePhoto(hue: number): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="900"><circle cx="600" cy="450" r="300" fill="#f4e3c1"/></svg>`) }])
    .withExif({
      IFD0: { Make: 'Libellus Test Camera', DateTime: '2026:10:01 09:30:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 36/1' },
    })
    .jpeg({ quality: 90 })
    .toBuffer()
}

/** Taps `opener`, answers the picker with the photo, and waits for the crop sheet. */
async function pickPhoto(page: Page, opener: string, photo: Buffer) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId(opener).click()
  await (await chooser).setFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo })
  await expect(page.getByTestId('photo.sheetTitle')).toHaveText(en.photo.cropTitle)
  await expect(page.getByTestId('photo.picture')).toBeVisible()
  await untilStill(page)
}

const avatarPath = async (memberId: string) =>
  (await sql<{ avatar_path: string | null }>('select avatar_path from public.accounts where id = $1', [memberId]))[0]!.avatar_path

const filesIn = async (memberId: string) =>
  (await sql<{ name: string }>(`select name from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = $1 order by name`, [memberId])).map(
    (r) => r.name,
  )

test('a member adds her photo, sees it everywhere and offline, replaces it and removes it', async ({ page }) => {
  const member = await signedIn(page)
  await expect(page.getByTestId('shell.avatar').locator('[data-avatar-photo]')).toHaveCount(0)

  // No photo yet: the row says Add, and tapping it opens the picker straight away.
  await openProfile(page)
  await expect(page.getByTestId('profile.photoValue')).toHaveText(en.photo.rowNone)
  await pickPhoto(page, 'profile.photo', await phonePhoto(40))
  await expect(page.getByTestId('photo.area')).toHaveAccessibleName(en.photo.area)

  // The keyboard places it: + zooms in, an arrow moves it.
  await page.getByTestId('photo.area').focus()
  await page.keyboard.press('+')
  await expect(page.getByTestId('photo.zoom')).toHaveValue('1.25')
  await page.keyboard.press('ArrowLeft')
  await page.getByTestId('photo.zoomOut').click()
  await expect(page.getByTestId('photo.zoom')).toHaveValue('1')
  await page.getByTestId('photo.zoomIn').click()

  // Save: the sheet closes, the hero and the row show it, and it is said.
  await expect(page.getByTestId('photo.action')).toHaveText(en.photo.save)
  await page.getByTestId('photo.action').click()
  await expect(page.getByTestId('photo')).toBeHidden()
  await expect(page.getByTestId('photo.status')).toHaveText(en.photo.saved)
  await expect(page.getByTestId('profile.avatarPhoto')).toBeVisible()
  await expect(page.getByTestId('profile.photoValue').locator('img')).toBeVisible()

  // Stored: a 512 px WebP and its 128 px copy, small, nothing of the camera or the place.
  const first = await avatarPath(member.id)
  expect(first).toMatch(new RegExp(`^${member.id}/[0-9a-f]{32}\\.webp$`))
  expect(await filesIn(member.id)).toHaveLength(2)
  const admin = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false } })
  const stored = new Uint8Array(await (await admin.storage.from('avatars').download(first!)).data!.arrayBuffer())
  expect(stored.length).toBeLessThanOrEqual(100_000)
  expect(metadataIn(stored)).toEqual([])
  const meta = await sharp(stored).metadata()
  expect({ format: meta.format, width: meta.width, height: meta.height, exif: meta.exif }).toEqual({ format: 'webp', width: 512, height: 512, exif: undefined })
  expect(Buffer.from(stored).toString('latin1')).not.toContain('Libellus Test Camera')

  // Every tab's header shows it.
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('shell.avatar').locator('[data-avatar-photo]')).toBeVisible()

  // Kept on the device: with the backend out of reach, a reload still shows it.
  await page.route(`${stack.url}/**`, (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page.getByTestId('shell.avatar').locator('[data-avatar-photo]')).toBeVisible()
  await page.unroute(`${stack.url}/**`)
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()

  // Replace, from the hero's avatar: its sheet, Choose another, a new crop, Save.
  await openProfile(page)
  await page.getByTestId('profile.avatar').click()
  await expect(page.getByTestId('photo.sheetTitle')).toHaveText(en.photo.title)
  await expect(page.getByTestId('photo.preview')).toBeVisible()
  await expect(page.getByTestId('photo.choose')).toHaveText(en.photo.replace)
  await pickPhoto(page, 'photo.choose', await phonePhoto(200))
  await page.getByTestId('photo.action').click()
  await expect(page.getByTestId('photo')).toBeHidden()
  await expect.poll(() => avatarPath(member.id)).not.toBe(first)
  const second = await avatarPath(member.id)
  // Only the new pair is left in her folder.
  await expect.poll(() => filesIn(member.id)).toEqual([second!, second!.replace('.webp', '-128.webp')].sort())

  // Remove: the initials are back everywhere and her folder is empty.
  await page.getByTestId('profile.photo').click()
  await expect(page.getByTestId('photo.remove')).toHaveText(en.photo.remove)
  await page.getByTestId('photo.remove').click()
  await expect(page.getByTestId('photo')).toBeHidden()
  await expect(page.getByTestId('photo.status')).toHaveText(en.photo.removed)
  await expect(page.getByTestId('profile.avatarPhoto')).toHaveCount(0)
  await expect(page.getByTestId('profile.photoValue')).toHaveText(en.photo.rowNone)
  expect(await avatarPath(member.id)).toBeNull()
  await expect.poll(() => filesIn(member.id)).toEqual([])
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('shell.avatar').locator('[data-avatar-photo]')).toHaveCount(0)
})

test('a picture the browser cannot read is refused in the sheet, and nothing is uploaded', async ({ page }) => {
  const member = await signedIn(page)
  await openProfile(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('profile.photo').click()
  await (await chooser).setFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a picture') })
  await expect(page.getByTestId('photo.error')).toHaveText(en.photo.error.unreadable)
  await expect(page.getByTestId('photo.choose')).toHaveText(en.photo.choose)
  expect(await filesIn(member.id)).toEqual([])
})

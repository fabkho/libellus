import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { test } from './fixtures'
import { openProfile, signedIn } from './support'

/**
 * The first name for Home's greeting (issue #49, audit item 10): set from the
 * Profile's Name row in a small sheet, kept with the account, cleared the
 * same way. Home then says "Good evening, Ida" and the avatar shows her
 * initial. With docs/parity.md (Tab shell, Home) this is the reference.
 */

const greetings = Object.keys(en.home.greeting).filter((key) => !key.endsWith('Named'))
const plain = new RegExp(`^(${greetings.map((key) => en.home.greeting[key as keyof typeof en.home.greeting]).join('|')})$`)
const named = (name: string) =>
  new RegExp(`^(${greetings.map((key) => en.home.greeting[`${key}Named` as keyof typeof en.home.greeting].replace('{name}', name)).join('|')})$`)

test('a member gives Home her first name from the Profile, and takes it back', async ({ page }) => {
  await signedIn(page)
  await expect(page.getByTestId('home.title')).toHaveText(plain)
  const initials = await page.getByTestId('shell.avatar').innerText()

  // No name yet: the row says so; tapping it opens the sheet with the field focused.
  await openProfile(page)
  await expect(page.getByTestId('profile.nameValue')).toHaveText(en.account.nameNone)
  await page.getByTestId('profile.name').click()
  await expect(page.getByTestId('accountName.input')).toBeFocused()
  await expect(page.getByTestId('accountName.action')).toBeDisabled()

  // Typed and saved (Enter does what Save does).
  await page.keyboard.type('  Ida  ')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('accountName')).toBeHidden()
  await expect(page.getByTestId('profile.title')).toHaveText('Ida')
  await expect(page.getByTestId('profile.initials')).toHaveText('I')
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('home.title')).toHaveText(named('Ida'))
  await expect(page.getByTestId('shell.avatar')).toHaveText('I')

  // Kept with the account: a reload greets her the same way.
  await page.reload()
  await expect(page.getByTestId('home.title')).toHaveText(named('Ida'))

  // Taken back: the row shows it, Remove name clears it.
  await openProfile(page)
  await expect(page.getByTestId('profile.nameValue')).toHaveText('Ida')
  await page.getByTestId('profile.name').click()
  await expect(page.getByTestId('accountName.input')).toHaveValue('Ida')
  await page.getByTestId('accountName.clear').click()
  await expect(page.getByTestId('accountName')).toBeHidden()
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('home.title')).toHaveText(plain)
  await expect(page.getByTestId('shell.avatar')).toHaveText(initials)
})

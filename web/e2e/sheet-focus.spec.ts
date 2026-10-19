import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { openProfile, signedIn } from './support'

/**
 * Where focus is while a sheet rises (the UI base's UiSheet and utils/sheetFocus.ts): on Android and the
 * desktop on the panel at once (the trap and VoiceOver), on the `data-autofocus` field only once
 * `data-moving` has cleared, so the keyboard does not arrive mid-rise. On an iPhone the field takes it in
 * the opening tap (`FIELD_FOCUS_AFTER_RISE.ios` false: iOS raises the keyboard only for a focus inside the
 * tap). The sheet is the Profile's Name sheet (`accountName`). The rules and the fallback timer are the
 * base's tests (tests/sheet-focus.test.ts in fabkho/ui).
 */

/** Records every focus move with whether the panel was still moving at that moment. */
async function recordFocus(page: Page) {
  await page.evaluate(() => {
    const log: { target: string | null; moving: boolean }[] = []
    ;(window as unknown as { __focusLog: typeof log }).__focusLog = log
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target as HTMLElement
        const panel = target.closest('[role=dialog]')
        log.push({ target: target.getAttribute('data-testid'), moving: panel?.hasAttribute('data-moving') ?? false })
      },
      true,
    )
  })
}
const focusLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __focusLog: { target: string | null; moving: boolean }[] }).__focusLog)

test.describe('a rising sheet on Android, motion on', () => {
  // A Pixel's browser: a device whose field waits for the rise (the flows' WebKit is an iPhone, whose field does not).
  test.use({ userAgent: devices['Pixel 7'].userAgent, reducedMotion: 'no-preference' })

  test('the panel holds focus while it rises, the field takes it after data-moving clears', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)
    await recordFocus(page)

    await page.getByTestId('profile.name').click()
    const sheet = page.getByTestId('accountName')
    await expect(sheet).toHaveAttribute('data-moving', 'true')
    await expect(sheet).toBeFocused()
    await expect(page.getByTestId('accountName.input')).not.toBeFocused()

    await expect(sheet).not.toHaveAttribute('data-moving', 'true')
    await expect(page.getByTestId('accountName.input')).toBeFocused()

    const log = await focusLog(page)
    const panelAt = log.findIndex((entry) => entry.target === 'accountName')
    const fieldAt = log.findIndex((entry) => entry.target === 'accountName.input')
    expect(panelAt, 'the panel had focus first').toBeGreaterThanOrEqual(0)
    expect(fieldAt, 'then the field').toBeGreaterThan(panelAt)
    expect(log[fieldAt]!.moving, 'the field took focus after data-moving cleared').toBe(false)
  })

  test('focus the member put inside the sheet during the rise is not taken away', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)

    await page.getByTestId('profile.name').click()
    const sheet = page.getByTestId('accountName')
    await expect(sheet).toHaveAttribute('data-moving', 'true')
    await page.getByTestId('accountName.cancel').focus()

    await expect(sheet).not.toHaveAttribute('data-moving', 'true')
    // Past the fallback timer as well: neither signal takes it.
    await page.waitForTimeout(900)
    await expect(page.getByTestId('accountName.cancel')).toBeFocused()
    await expect(page.getByTestId('accountName.input')).not.toBeFocused()
  })

  test('closing during the rise leaves nothing to focus later', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)

    await page.getByTestId('profile.name').click()
    await expect(page.getByTestId('accountName')).toHaveAttribute('data-moving', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('accountName')).toBeHidden()
    await page.waitForTimeout(900)
    await expect(page.getByTestId('accountName.input')).toHaveCount(0)
    await expect(page.locator('input:focus')).toHaveCount(0)
  })
})

test.describe('a rising sheet on an iPhone, motion on', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the field takes focus in the opening tap, while the sheet still rises', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)
    await recordFocus(page)

    await page.getByTestId('profile.name').click()
    const sheet = page.getByTestId('accountName')
    await expect(sheet).toHaveAttribute('data-moving', 'true')
    await expect(page.getByTestId('accountName.input')).toBeFocused()

    // The field was the first thing in the sheet to take focus, and it took it during the rise.
    const log = (await focusLog(page)).filter((entry) => entry.target?.startsWith('accountName'))
    expect(log[0]?.target).toBe('accountName.input')
    expect(log[0]?.moving).toBe(true)
  })
})

test.describe('a sheet with Reduce Motion', () => {
  test('the field has focus at once: nothing rises, so nothing to wait for', async ({ page }) => {
    await signedIn(page)
    await openProfile(page)
    await recordFocus(page)

    await page.getByTestId('profile.name').click()
    await expect(page.getByTestId('accountName.input')).toBeFocused()
    // The panel was never the resting place of focus: the field was the first thing to take it.
    const log = await focusLog(page)
    expect(log.map((entry) => entry.target)).not.toContain('accountName')
  })
})

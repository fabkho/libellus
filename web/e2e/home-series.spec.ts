import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { forgetEnriched } from './enriched'
import { test } from './fixtures'
import { startedSeries } from './started'
import { signedIn, untilStill } from './support'

/**
 * Home's "Next in your series" (#167): the series she has started — a work of it
 * she reads or finished; Want to read alone or a work given up on does not start
 * one — and has not finished, as the next open work, the latest activity first,
 * five at most. With more than five a "See more" pill opens all of them in a
 * sheet; with five or fewer there is none. "+ Want to read" on a row opens the
 * Add sheet and her status takes the button's place (docs/MOTION.md, "Want to
 * read, added in a row"), the row no taller or shorter for it. The fixtures:
 * e2e/started.ts. a11y.spec.ts scans the section and its sheet in both themes.
 */

const stored: string[] = []
test.afterAll(async () => {
  await forgetEnriched(stored)
})

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text)

test('five are shown, See more opens all of them, and Want to read changes the row', async ({ page }) => {
  // A short phone, so seven rows are more than the sheet shows at once.
  await page.setViewportSize({ width: 393, height: 560 })
  const member = await signedIn(page)
  const data = await startedSeries(member.client, 7, { notStarted: true })
  stored.push(...data.ids)
  await page.goto('/')
  const section = page.getByTestId('home.nextInSeries')
  await expect(section.getByRole('heading')).toHaveText(en.series.next)

  // Seven are started (a series only wanted, or given up on, is not): the latest five, the latest first.
  await expect(section.getByTestId('home.nextTitle')).toHaveText(data.nextTitles.slice(0, 5))
  await expect(section.getByTestId('home.nextMeta')).toHaveText(
    data.names.slice(0, 5).map((name) => fill(en.series.nextPlaceOf, { n: 2, count: 2, name })),
  )
  await expect(section.getByTestId('home.nextMore')).toHaveAccessibleName(fill(en.series.seeMoreLabel, { count: 7 }))
  await expect(section.getByTestId('home.nextMore')).toHaveText(en.series.seeMore)

  // See more: all seven, in the same order, the sheet's body scrolling.
  await section.getByTestId('home.nextMore').click()
  const sheet = page.getByTestId('homeSeries')
  await expect(sheet).toBeVisible()
  await untilStill(page)
  await expect(sheet.getByTestId('homeSeries.sheetTitle')).toHaveText(en.series.started)
  await expect(sheet.getByTestId('homeSeries.rowTitle')).toHaveText(data.nextTitles)
  const body = sheet.locator('[data-sheet-body]')
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  // Want to read in the sheet: the Add sheet over it, then her status where the button was.
  const last = sheet.getByTestId('homeSeries.row').last()
  await last.scrollIntoViewIfNeeded()
  await last.getByTestId('homeSeries.rowWant').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(last.getByTestId('homeSeries.rowStatus')).toHaveText(en.status.want_to_read)
  await expect(last.getByTestId('homeSeries.rowWant')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // Want to read on Home's own row: the same.
  const first = section.getByTestId('home.next').first()
  await expect(first.getByTestId('home.nextStatus')).toHaveCount(0)
  await first.getByTestId('home.nextWant').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(first.getByTestId('home.nextStatus')).toHaveText(en.status.want_to_read)
  await expect(first.getByTestId('home.nextWant')).toHaveCount(0)
  // Still the same five, in the same order, after it is asked again.
  await page.reload()
  await expect(section.getByTestId('home.nextTitle')).toHaveText(data.nextTitles.slice(0, 5))
  await expect(section.getByTestId('home.next').first().getByTestId('home.nextStatus')).toHaveText(en.status.want_to_read)
})

test('with five or fewer there is no See more; with none the section is not there', async ({ page }) => {
  const member = await signedIn(page)
  await expect(page.getByTestId('home.nextInSeries')).toHaveCount(0)
  const data = await startedSeries(member.client, 5)
  stored.push(...data.ids)
  await page.reload()
  const section = page.getByTestId('home.nextInSeries')
  await expect(section.getByTestId('home.nextTitle')).toHaveText(data.nextTitles)
  await expect(section.getByTestId('home.nextMore')).toHaveCount(0)
})

test('a Book opened from a row; Back is Home as it was', async ({ page }) => {
  const member = await signedIn(page)
  const data = await startedSeries(member.client, 2)
  stored.push(...data.ids)
  await page.goto('/')
  await page.getByTestId('home.nextLink').first().click()
  await expect(page.getByTestId('book.title')).toHaveText(data.nextTitles[0]!)
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('home.nextTitle')).toHaveText(data.nextTitles)
})

test('a series she finishes from its row leaves the list', async ({ page }) => {
  const member = await signedIn(page)
  const data = await startedSeries(member.client, 1)
  stored.push(...data.ids)
  await page.goto('/')
  await expect(page.getByTestId('home.nextTitle')).toHaveText(data.nextTitles)
  // Wants the next, starts it: it is being read (a card above), so it is not offered again.
  await page.getByTestId('home.nextWant').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('add.status.finished').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  // Finished: nothing is open in it any more.
  await expect(page.getByTestId('home.nextInSeries')).toHaveCount(0)
})

test.describe('motion', () => {
  // What moves is the subject here: the transitions play, which the config's Reduce Motion would cut.
  test.use({ reducedMotion: 'no-preference' })

  test('Want to read: the button fades away and her status arrives, the row keeps its height', async ({ page }) => {
    const member = await signedIn(page)
    const data = await startedSeries(member.client, 2)
    stored.push(...data.ids)
    await page.goto('/')
    const row = page.getByTestId('home.next').first()
    await expect(row).toBeVisible()
    await untilStill(page)
    const before = await row.boundingBox()

    // Her status's arrival is read from the animation itself, as the status is added: a starved runner
    // paints no frame in between, and by the time the row is read the arrival is over and the class
    // that carried it is gone (the same reading as e2e/change-edition.spec.ts).
    await row.evaluate((li) => {
      const arriving: { name: string; state: string; duration: unknown; delay: unknown; keyframes: Record<string, unknown>[] }[] = []
      Object.assign(window, { __arriving: arriving })
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof HTMLElement && node.dataset.testid === 'home.nextStatus')
              for (const animation of node.getAnimations() as CSSAnimation[]) {
                const keyframes = (animation.effect as KeyframeEffect).getKeyframes()
                const timing = animation.effect!.getTiming()
                arriving.push({
                  name: animation.animationName,
                  state: animation.playState,
                  duration: timing.duration,
                  delay: timing.delay,
                  keyframes: keyframes.map(({ offset, opacity, transform, color }) => ({ offset, opacity, transform, color })),
                })
              }
      }).observe(li, { childList: true, subtree: true })
    })

    await row.getByTestId('home.nextWant').click()
    await expect(page.getByTestId('add')).toBeVisible()
    await untilStill(page)
    await page.getByTestId('add.submit').click()
    await expect(page.getByTestId('add')).toBeHidden()

    // Her status is there at once (in the room the button had), still arriving: held until the sheet is gone, then it
    // rises and lights, over twice `sheet`; the button is on its way out, not in the way.
    const status = row.getByTestId('home.nextStatus')
    await expect(status).toHaveText(en.status.want_to_read)
    const { arriving, sheet, sheetExit } = await page.evaluate(() => {
      const tokens = getComputedStyle(document.documentElement)
      // In ms: the dev server writes a token as `250ms`, the build as `.25s`.
      const ms = (value: string) => parseFloat(value) * (/ms$/.test(value) ? 1 : 1000)
      return {
        arriving: (window as unknown as { __arriving: { name: string; state: string; duration: unknown; delay: unknown; keyframes: Record<string, unknown>[] }[] }).__arriving,
        sheet: ms(tokens.getPropertyValue('--duration-sheet').trim()),
        sheetExit: ms(tokens.getPropertyValue('--duration-sheet-exit').trim()),
      }
    })
    // Her status arrives with the app's own arrival: one animation, held `sheetExit` (the sheet falling
    // away), then up the last `xs` and into the accent, over twice `sheet`, settling where the other
    // statuses stand. Read while it is still arriving, so nothing about the way it is drawn is guessed.
    expect(arriving).toHaveLength(1)
    const arrival = arriving[0]!
    expect(arrival.name).toMatch(/^state-arrive/)
    expect(arrival.state).toBe('running')
    expect({ duration: arrival.duration, delay: arrival.delay }).toEqual({ duration: 2 * sheet, delay: sheetExit })
    expect(arrival.keyframes.map((frame) => frame.offset)).toEqual([0, 0.35, 1])
    expect(arrival.keyframes[0]).toMatchObject({ opacity: '0', transform: expect.stringMatching(/^translateY\(\d+(\.\d+)?px\)$/) })
    expect(arrival.keyframes[1]).toMatchObject({ opacity: '1', transform: 'none' })
    expect(arrival.keyframes[2]).toMatchObject({ opacity: '1', transform: 'none' })
    // It lights in the accent, holds it, and gives way to the quiet colour the others stand in.
    expect(arrival.keyframes[0]!.color).toBe(arrival.keyframes[1]!.color)
    expect(arrival.keyframes[2]!.color).not.toBe(arrival.keyframes[1]!.color)
    expect((await row.boundingBox())?.height).toBe(before?.height)
    await expect(row.getByTestId('home.nextWant')).toHaveCount(0)
    // It ends where the others' statuses stand: quiet, at rest.
    await expect.poll(() => status.evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(arrival.keyframes[2]!.color).toBe(await status.evaluate((el) => getComputedStyle(el).color))
    expect((await row.boundingBox())?.height).toBe(before?.height)
  })

  test('the section comes after the answer without moving anything above it', async ({ page }) => {
    const member = await signedIn(page)
    const data = await startedSeries(member.client, 3)
    stored.push(...data.ids)
    // The device has nothing yet and the answer is slow: Home stands without the section, then it opens its room.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/rest/v1/rpc/started_series', async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/')
    await expect(page.getByTestId('home.title')).toBeVisible()
    await expect(page.getByTestId('home.nextInSeries')).toHaveCount(0)
    const above = page.getByTestId('home.title')
    const top = await above.boundingBox()
    release()
    await expect(page.getByTestId('home.nextTitle')).toHaveText(data.nextTitles)
    await untilStill(page)
    expect(await above.boundingBox()).toEqual(top)
    await page.unroute('**/rest/v1/rpc/started_series')
  })
})

import { expect, test } from './fixtures'
import { friendPath, friendWithSharedBooks } from './bothRead'
import { signedIn } from './support'

const BUILD_HAS_REGAL = /^(1|true)$/i.test(process.env.LIBELLUS_REGAL?.trim() ?? '')

/**
 * "You both read" on a member's page, with the live reel standing down (docs/plans/shared-books-slideshow.md, H):
 * wherever the 3D cannot hold, the section is Regal's own still (`RegalBooksReelStill`, the reel's first frame
 * without the canvas, with our pills and caption) with the text list under it, never a composition of our own.
 * This suite runs WebKit with Reduce Motion, which is one of those reasons, so what is here is what most phones
 * see most of the time. A build without Regal (the flows' default) has no picture at all: the list is open.
 *
 * What a member would notice, and what these flows guard: no shared Book is no section (not an empty one);
 * one shared Book is the still, never the live 3D; the count above says how many they both read; and every one
 * of them is in the list, a screen reader's and a member's who chose "Show as a list".
 *
 * The reel itself is e2e/both-read-reel.spec.ts: Chromium, with motion.
 */

test.describe('You both read', () => {
  test('no shared Book is no section, one is the still and never the live 3D, and it is in the list', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 1)

    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    await expect(page.getByTestId('member.bothRead.list')).toBeAttached()
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(1)
    // The section draws no poster of its own, in any build.
    await expect(page.getByTestId('member.bothRead.poster')).toHaveCount(0)
    // Reduce Motion (the suite's) is one of the loading rules: no live 3D.
    await expect(page.locator('.reel-card'), 'the live reel, drawn for one Book').toHaveCount(0)
    if (BUILD_HAS_REGAL) {
      // Regal's still: its first frame, the same pills and caption, the title a link to the Book; no canvas.
      const still = page.getByTestId('member.bothRead.still')
      await expect(still).toBeVisible()
      await expect(still.locator('canvas')).toHaveCount(0)
      await expect(still.getByTestId('member.bothRead.title')).toBeVisible()
      await expect(still.locator('a[href*="/book/"]')).toHaveCount(1)
      await expect(page.getByTestId('member.bothRead.listToggle')).toBeVisible()
    } else {
      // No Regal in the build: no picture; the list is open and has no toggle.
      await expect(page.getByTestId('member.bothRead.still')).toHaveCount(0)
      await expect(page.getByTestId('member.bothRead.listToggle')).toHaveCount(0)
      await expect(page.getByTestId('member.bothRead.item').first()).toBeVisible()
    }

    // A member with nothing shared: no section at all.
    const stranger = await friendWithSharedBooks(viewer, 0)
    await page.goto(friendPath(stranger))
    await expect(page.getByTestId('member.hero')).toBeVisible()
    await expect(page.getByTestId('member.bothRead')).toHaveCount(0)
  })

  test('the section stands directly under the figures grid and above the by-year chart, with one Book as with many', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 2)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y
    const figures = await top('profile.figures')
    const section = await top('member.bothRead')
    const chart = await top('profile.columns')
    expect(section, 'under the figures grid').toBeGreaterThan(figures)
    expect(section, 'above the chart').toBeLessThan(chart)
  })

  test('her row in People asks for the Books you both read before her page opens, and the tap and the page reuse that one request', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 3)
    const asked: number[] = []
    let navigatedAt = 0
    page.on('request', (request) => {
      if (/\/rpc\/both_read/.test(request.url())) asked.push(Date.now())
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().includes(`/friends/${friend.id}`)) navigatedAt ||= Date.now()
    })
    await page.goto('/friends/people')
    const link = page.locator(`a[href="/friends/${friend.id}"]`).first()
    await expect(link).toBeVisible()
    // Her row came into view: the browser's idle time asks for her answer, before anyone has tapped.
    await expect.poll(() => asked.length, { message: 'both_read asked for as her row came into view' }).toBe(1)
    // Then the tap (pointer down, then up) and her page: no second request, and the page has her section.
    await link.click()
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    await page.waitForTimeout(800)
    expect(asked, 'one request for her answer however it was asked for').toHaveLength(1)
    expect(navigatedAt, 'asked before her page opened').toBeGreaterThan(asked[0]!)
  })

  test('a return visit draws her section from the device at once, and the fresh answer, equal, changes nothing on screen', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 3)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(3)
    // The copy is on the device: whitelisted keys, this member's.
    const kept = await page.evaluate(() => localStorage.getItem('libellus.bothRead'))
    expect(kept).toContain(friend.id)
    expect(kept).not.toMatch(/email|password/i)

    // Her answer, slow, on the next visit (a fresh page: the store is empty, only the device has her).
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/rpc\/both_read/, async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/')
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.hero')).toBeVisible()
    await expect(page.getByTestId('member.bothRead'), 'drawn from the device while her answer is on its way').toBeVisible()
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(3)
    const before = await page.getByTestId('member.bothRead').boundingBox()
    release()
    await page.waitForTimeout(800)
    expect(await page.getByTestId('member.bothRead').boundingBox(), 'an equal answer changes nothing').toEqual(before)

    // Signing out takes it away with the rest of what the device kept.
    await page.unroute(/\/rpc\/both_read/)
  })

  test('three hundred shared Books: the count says three hundred, the list has all of them', async ({ page }) => {
    test.slow()
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 300)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(300)
    // The eyebrow counts what both read, not what the reel draws of it.
    await expect(page.getByTestId('member.bothRead').getByRole('heading')).toContainText('300')
  })
})


import { expect, test } from './fixtures'
import { friendPath, friendWithSharedBooks } from './bothRead'
import { signedIn } from './support'

/**
 * "You both read" on a member's page, with the reel standing down (docs/plans/shared-books-slideshow.md, H):
 * the section is the Books the viewer and she both finished, drawn as the reel's resting pose — the poster —
 * with the text list under it, whenever the 3D cannot hold. This suite runs WebKit with Reduce Motion, which
 * is one of those reasons, so what is here is what most phones see most of the time.
 *
 * What a member would notice, and what these flows guard: no shared Book is no section (not an empty one);
 * one shared Book is the poster, never the 3D, and the ~350 KB chunk the reel lives in is not fetched; the
 * count above says how many they both read; and every one of them is in the list, a screen reader's and a
 * member's who chose "Show as a list".
 *
 * The reel itself is e2e/both-read-reel.spec.ts: Chromium, with motion.
 */

test.describe('You both read', () => {
  test('no shared Book is no section, one is the poster and never the 3D, and it is in the list', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 1)

    // The chunk the reel lives in, if the section ever asks for it: ~350 KB on a phone.
    const regal: string[] = []
    page.on('request', (request) => {
      if (/_nuxt\/regal\.[^/]+\.js$/.test(request.url())) regal.push(request.url())
    })

    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    await expect(page.getByTestId('member.bothRead.poster')).toBeVisible()
    await expect(page.getByTestId('member.bothRead.list')).toBeAttached()
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(1)
    // Reduce Motion (the suite's) is one of the loading rules: the poster, and no 3D under it.
    await expect(page.locator('.reel-card'), 'the reel, drawn for one Book').toHaveCount(0)
    expect(regal, 'the regal chunk, fetched for a section that stays flat').toEqual([])

    // A member with nothing shared: no section at all.
    const stranger = await friendWithSharedBooks(viewer, 0)
    await page.goto(friendPath(stranger))
    await expect(page.getByTestId('member.hero')).toBeVisible()
    await expect(page.getByTestId('member.bothRead')).toHaveCount(0)
  })

  test('three hundred shared Books: the count says three hundred, the list has all of them', async ({ page }) => {
    test.slow()
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 300)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    await expect(page.getByTestId('member.bothRead.item')).toHaveCount(300)
    // The eyebrow counts what both read, not what the poster draws of it.
    await expect(page.getByTestId('member.bothRead').getByRole('heading')).toContainText('300')
  })
})


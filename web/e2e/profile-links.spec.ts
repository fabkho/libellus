import type { BrowserContextOptions } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createSocial } from '../app/data/social'
import { sql } from '../tests/support/stack'
import { expect, test } from './fixtures'
import { expectAccessible, goto, openProfile, signedIn, untilStill } from './support'

/**
 * Profile links (docs/parity.md, Profile links): from the Profile a member adds her profiles on other platforms,
 * as a handle or as the platform's own link (only the handle is kept), is told under the field what a platform
 * takes, picks who sees them (followers only to begin with), and they sit behind one quiet Socials chip under her name, which opens
 * a menu with a row per platform, each opening the platform in a new tab with no referrer. Another member sees them only as she allows: not before she
 * follows (the default), not at all once it is Only me. The rules behind it are pgTAP's (supabase/tests/
 * profile_links_test.sql) and Vitest's (tests/social-links.test.ts); this is the screens joined up.
 */

test('Ida adds an Instagram link and a Goodreads id, and Anna sees them only as Ida allows', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    for (const [member, name] of [[idaMember, 'Ida'], [annaMember, 'Anna']] as const) {
      await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
    }
    // Ida's account is public, so Anna can follow at once.
    await createSocial(idaMember.client, { online: () => true }).setPrivate(false)

    await openProfile(ida)
    await expect(ida.getByTestId('profile.socialLinksValue')).toHaveText(en.socialLinks.rowNone)
    await expect(ida.getByTestId('profile.socials')).toHaveCount(0)
    await ida.getByTestId('profile.socialLinks').click()
    await expect(ida.getByTestId('socialLinks')).toBeVisible()
    await untilStill(ida)
    await expect(ida.getByTestId('socialLinks.visibility.followers')).toHaveAttribute('aria-checked', 'true')
    await expect(ida.getByTestId('socialLinks.visibilityHint')).toHaveText(en.socialLinks.visibility.hint.followers)
    await expect(ida.getByTestId('socialLinks.action')).toBeDisabled()

    // A pasted link becomes its handle, a wrong field is told what the platform takes.
    await ida.getByTestId('socialLinks.instagram').fill('https://www.instagram.com/Ida.Reads/?igsh=MWRmdjZ3')
    await ida.getByTestId('socialLinks.goodreads').fill('4242')
    await ida.getByTestId('socialLinks.tiktok').fill('x')
    await expect(ida.getByTestId('socialLinks.action')).toBeEnabled()
    await ida.getByTestId('socialLinks.action').click()
    await expect(ida.getByTestId('socialLinks.tiktok.error')).toHaveText(en.socialLinks.invalid.tiktok)
    await expect(ida.getByTestId('socialLinks')).toBeVisible()
    await expectAccessible(ida, 'the Profile links sheet, with a field refused')
    await ida.getByTestId('socialLinks.tiktok.remove').click()
    await expect(ida.getByTestId('socialLinks.tiktok.error')).toHaveCount(0)
    await ida.getByTestId('socialLinks.action').click()
    await expect(ida.getByTestId('socialLinks')).toBeHidden()

    // Stored as handles, never as the pasted address.
    const rows = await sql<{ platform: string; handle: string }>('select platform::text, handle from public.profile_links where member_id = $1 order by platform', [idaMember.id])
    expect(rows).toEqual([
      { platform: 'goodreads', handle: '4242' },
      { platform: 'instagram', handle: 'ida.reads' },
    ])

    // One quiet Socials chip under her name; nothing of the links shows on the page itself.
    const socials = ida.getByTestId('profile.socials')
    await expect(socials).toBeVisible()
    await expect(socials).toHaveText(en.socialLinks.menu)
    await expect(ida.getByTestId('profile.socialsSheet')).toHaveCount(0)
    await expect(ida.getByTestId('profile.socialsSheet.instagram')).toHaveCount(0)
    await socials.click()
    await expect(ida.getByTestId('profile.socialsSheet')).toBeVisible()
    await untilStill(ida)
    // The menu lists them: the platform's name, her handle, a new tab, no referrer, the canonical address.
    const instagram = ida.getByTestId('profile.socialsSheet.instagram')
    await expect(instagram).toContainText('Instagram')
    await expect(instagram).toContainText('@ida.reads')
    await expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/ida.reads/')
    await expect(instagram).toHaveAttribute('target', '_blank')
    await expect(instagram).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc')
    await expect(instagram).toHaveAttribute('aria-label', en.socialLinks.opens.replaceAll('{platform}', 'Instagram').replace('{handle}', '@ida.reads'))
    await expect(ida.getByTestId('profile.socialsSheet.goodreads')).toHaveAttribute('href', 'https://www.goodreads.com/user/show/4242')
    await expectAccessible(ida, 'the Socials menu')
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('profile.socialsSheet')).toBeHidden()

    // Anna opens Ida's page: public, so she may read it, but links are for followers: none yet. After following: both.
    await goto(anna, `/friends/${idaMember.id}`)
    await expect(anna.getByTestId('member.name')).toHaveText('Ida')
    await expect(anna.getByTestId('member.follow')).toBeVisible()
    await expect(anna.getByTestId('member.socials')).toHaveCount(0)
    await anna.getByTestId('member.follow').click()
    await expect(anna.getByTestId('member.follow')).toBeHidden()
    await expect(anna.getByTestId('member.socials')).toBeVisible()
    await anna.getByTestId('member.socials').click()
    const seen = anna.getByTestId('member.socialsSheet.instagram')
    await expect(seen).toBeVisible()
    await expect(seen).toHaveAttribute('href', 'https://www.instagram.com/ida.reads/')
    await expect(seen).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc')
    await expect(anna.getByTestId('member.socialsSheet.goodreads')).toBeVisible()
    await anna.keyboard.press('Escape')

    // Ida picks Only me: Anna sees none the next time she opens the page.
    await ida.getByTestId('profile.socialLinks').click()
    await untilStill(ida)
    await ida.getByTestId('socialLinks.visibility.me').click()
    await expect(ida.getByTestId('socialLinks.visibilityHint')).toHaveText(en.socialLinks.visibility.hint.me)
    await ida.getByTestId('socialLinks.action').click()
    await expect(ida.getByTestId('socialLinks')).toBeHidden()
    await goto(anna, `/friends/${idaMember.id}`)
    await expect(anna.getByTestId('member.name')).toHaveText('Ida')
    await expect(anna.getByTestId('member.socials')).toHaveCount(0)
    // Hers still show to Ida.
    await expect(ida.getByTestId('profile.socials')).toBeVisible()
  } finally {
    await context.close()
  }
})

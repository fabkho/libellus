import { describe, expect, it } from 'vitest'
import { createProfileLinks, draftsToLinks, linksFromJson } from '@/data/profileLinks'
import { createSocial } from '@/data/social'
import {
  SOCIAL_LINK_REL,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_IDS,
  cleanSocialHandle,
  isSocialHandle,
  socialLinkLabel,
  socialLinkUrl,
  type SocialPlatform,
} from '@/utils/socialLinks'
import { signUpMember } from './support/member'

/**
 * Profile links (WP-22): the platform table, the reader of what a member types or pastes, the one builder of the
 * outgoing address, and the repository against the local stack. The database's own rules (formats, visibility,
 * limits) are pinned in supabase/tests/profile_links_test.sql.
 */

const CHANNEL = 'UCabcdefghijklmnopqrstuV'

describe('the platform table', () => {
  it("holds exactly the owner's five, once each, in the database's order", () => {
    expect(SOCIAL_PLATFORM_IDS).toEqual(['goodreads', 'reado', 'youtube', 'instagram', 'tiktok'])
    expect(SOCIAL_PLATFORMS.map((p) => p.id)).toEqual([...SOCIAL_PLATFORM_IDS])
    expect(SOCIAL_PLATFORMS.map((p) => p.name)).toEqual(['Goodreads', 'Reado', 'YouTube', 'Instagram', 'TikTok'])
  })

  it('has only https hosts the platform owns, nothing else to match', () => {
    for (const spec of SOCIAL_PLATFORMS) {
      for (const host of spec.hosts) expect(host).toMatch(/^[a-z0-9.-]+\.(com|app)$/)
    }
  })
})

describe('the address of a stored link', () => {
  it('is built from a fixed template per platform', () => {
    expect(socialLinkUrl('instagram', 'ada.reads')).toBe('https://www.instagram.com/ada.reads/')
    expect(socialLinkUrl('tiktok', 'ada_reads')).toBe('https://www.tiktok.com/@ada_reads')
    expect(socialLinkUrl('youtube', '@ada-reads')).toBe('https://www.youtube.com/@ada-reads')
    expect(socialLinkUrl('youtube', CHANNEL)).toBe(`https://www.youtube.com/channel/${CHANNEL}`)
    expect(socialLinkUrl('goodreads', '12345678')).toBe('https://www.goodreads.com/user/show/12345678')
    expect(socialLinkUrl('reado', 'Karla_')).toBe('https://reado.app/en/profile/Karla_')
  })

  it("is always https, on the platform's own host, with nothing after the handle", () => {
    const samples: [SocialPlatform, string][] = [
      ['instagram', 'ada.reads'],
      ['tiktok', 'ada_reads'],
      ['youtube', '@ada-reads'],
      ['youtube', CHANNEL],
      ['goodreads', '42'],
      ['reado', 'karla'],
    ]
    for (const [platform, handle] of samples) {
      const url = new URL(socialLinkUrl(platform, handle)!)
      expect(url.protocol).toBe('https:')
      expect(SOCIAL_PLATFORMS.find((p) => p.id === platform)!.hosts).toContain(url.hostname)
      expect(url.search + url.hash + url.username + url.password + url.port).toBe('')
    }
  })

  it('is none for text that is not a canonical handle: nothing injected, nothing guessed', () => {
    const bad: [SocialPlatform, string][] = [
      ['instagram', 'javascript:alert(1)'],
      ['instagram', 'ada.reads/../../evil'],
      ['instagram', 'ada reads'],
      ['instagram', 'Ada.Reads'],
      ['instagram', 'ada.reads\n'],
      ['instagram', 'ada\u200b'],
      ['instagram', 'аda'],
      ['instagram', 'https://evil.example/'],
      ['instagram', ''],
      ['tiktok', '@ada'],
      ['tiktok', 'a'],
      ['youtube', 'ada-reads'],
      ['youtube', '@Ada'],
      ['youtube', 'UCshort'],
      ['goodreads', '12ab'],
      ['goodreads', '١٢٣'],
      ['goodreads', '012'],
      ['goodreads', '1/../2'],
      ['reado', '<script>'],
      ['reado', 'ka rla'],
    ]
    for (const [platform, handle] of bad) expect(socialLinkUrl(platform, handle), `${platform} ${handle}`).toBeNull()
    expect(socialLinkUrl('myspace' as SocialPlatform, 'tom')).toBeNull()
  })

  it('never carries the stored text as an address: a URL in the handle is refused whatever the platform', () => {
    for (const platform of SOCIAL_PLATFORM_IDS) {
      for (const handle of ['https://example.org', 'http://example.org/x', '//example.org', 'example.org/x', 'data:text/html,hi', 'javascript:1']) {
        expect(socialLinkUrl(platform, handle), `${platform} ${handle}`).toBeNull()
        expect(isSocialHandle(platform, handle)).toBe(false)
      }
    }
  })

  it('opens with no referrer and no opener', () => {
    expect(SOCIAL_LINK_REL.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer', 'ugc'])
  })

  it('names a handle the way a person reads it', () => {
    expect(socialLinkLabel('instagram', 'ada.reads')).toBe('@ada.reads')
    expect(socialLinkLabel('tiktok', 'ada')).toBe('@ada')
    expect(socialLinkLabel('youtube', '@ada-reads')).toBe('@ada-reads')
    expect(socialLinkLabel('goodreads', '42')).toBe('42')
  })
})

describe('what a member types', () => {
  it('Instagram: a handle with or without @, in any case, or a pasted profile address', () => {
    expect(cleanSocialHandle('instagram', 'Ada.Reads')).toBe('ada.reads')
    expect(cleanSocialHandle('instagram', '  @Ada_Reads  ')).toBe('ada_reads')
    expect(cleanSocialHandle('instagram', 'a')).toBe('a')
    expect(cleanSocialHandle('instagram', 'x'.repeat(30))).toBe('x'.repeat(30))
    expect(cleanSocialHandle('instagram', 'https://www.instagram.com/Name/?igsh=MWRmdjZ3&utm_source=qr')).toBe('name')
    expect(cleanSocialHandle('instagram', 'http://instagram.com/name')).toBe('name')
    expect(cleanSocialHandle('instagram', 'www.instagram.com/name/')).toBe('name')
    expect(cleanSocialHandle('instagram', 'instagram.com/name#top')).toBe('name')
    expect(cleanSocialHandle('instagram', 'https://m.instagram.com/name/reels/')).toBe('name')
  })

  it('Instagram: refuses what it is not', () => {
    for (const typed of [
      '',
      '   ',
      'x'.repeat(31),
      '.ada',
      'ada.',
      'ad..a',
      'ada reads',
      'ada@evil.example',
      '@@ada',
      'https://www.instagram.com/p/Cabc123/',
      'https://www.instagram.com/explore/',
      'https://www.instagram.com/',
      'https://instagram.com.evil.example/name',
      'https://evil.example/instagram.com/name',
      'https://www.instagram.com@evil.example/name',
      'https://user:pw@www.instagram.com/name',
      'https://www.instagram.com:8443/name',
      'ftp://www.instagram.com/name',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      '//evil.example/name',
      'https://www.tiktok.com/@name',
      // look-alikes are refused, not folded into letters
      '\u212Aate',
      'ada\u0430',
      '\uFF41da',
      'ada\u200b',
      'ada\u202eevil',
      'ada\u00a0',
      'ada\f',
      '%61da',
      'https://www.instagram.com/%61da',
      'https://www.instagram.com/ada%2Fevil',
    ]) {
      expect(cleanSocialHandle('instagram', typed), JSON.stringify(typed)).toBeNull()
    }
  })

  it('TikTok: a handle with or without @, or a pasted profile address', () => {
    expect(cleanSocialHandle('tiktok', '@Ada_Reads')).toBe('ada_reads')
    expect(cleanSocialHandle('tiktok', 'ab')).toBe('ab')
    expect(cleanSocialHandle('tiktok', 'x'.repeat(24))).toBe('x'.repeat(24))
    expect(cleanSocialHandle('tiktok', 'https://www.tiktok.com/@Ada.Reads?lang=en&is_from_webapp=1')).toBe('ada.reads')
    expect(cleanSocialHandle('tiktok', 'tiktok.com/@ada/video/7123456789')).toBe('ada')
    for (const typed of ['a', 'x'.repeat(25), 'ada.', 'https://www.tiktok.com/ada', 'https://vm.tiktok.com/ZMabc/', 'https://www.instagram.com/ada']) {
      expect(cleanSocialHandle('tiktok', typed), typed).toBeNull()
    }
  })

  it('YouTube: a handle (with its @ added), a channel id, or a pasted address', () => {
    expect(cleanSocialHandle('youtube', 'Ada-Reads')).toBe('@ada-reads')
    expect(cleanSocialHandle('youtube', '@Ada.Reads_1')).toBe('@ada.reads_1')
    expect(cleanSocialHandle('youtube', CHANNEL)).toBe(CHANNEL)
    expect(cleanSocialHandle('youtube', `https://www.youtube.com/channel/${CHANNEL}?si=abc`)).toBe(CHANNEL)
    expect(cleanSocialHandle('youtube', 'https://www.youtube.com/@Ada-Reads/videos')).toBe('@ada-reads')
    expect(cleanSocialHandle('youtube', 'https://m.youtube.com/@ada')).toBe('@ada')
    for (const typed of [
      'ab',
      'x'.repeat(31),
      'https://www.youtube.com/c/AdaReads',
      'https://www.youtube.com/user/AdaReads',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com.evil.example/@ada',
      'ada reads',
    ]) {
      expect(cleanSocialHandle('youtube', typed), typed).toBeNull()
    }
  })

  it('Goodreads: the number, or the number in a pasted profile address', () => {
    expect(cleanSocialHandle('goodreads', '12345678')).toBe('12345678')
    expect(cleanSocialHandle('goodreads', 'https://www.goodreads.com/user/show/12345678-ada-reads')).toBe('12345678')
    expect(cleanSocialHandle('goodreads', 'https://www.goodreads.com/user/show/12345678')).toBe('12345678')
    expect(cleanSocialHandle('goodreads', 'goodreads.com/user/show/9?ref=nav')).toBe('9')
    for (const typed of [
      '0',
      '012',
      '1234567890123',
      '12ab',
      '12345678-ada',
      '١٢٣',
      'https://www.goodreads.com/review/list/123',
      'https://www.goodreads.com/user/show/abc',
      'https://www.goodreads.com/user/show/',
      'https://goodreads.com.evil.example/user/show/1',
    ]) {
      expect(cleanSocialHandle('goodreads', typed), typed).toBeNull()
    }
  })

  it('Reado: a username with or without @, or a pasted profile address in any language', () => {
    expect(cleanSocialHandle('reado', 'karla')).toBe('karla')
    expect(cleanSocialHandle('reado', '@Anna_')).toBe('Anna_')
    expect(cleanSocialHandle('reado', 'https://reado.app/en/profile/julysbookshelf')).toBe('julysbookshelf')
    expect(cleanSocialHandle('reado', 'https://reado.app/de/profile/Anna_?x=1')).toBe('Anna_')
    expect(cleanSocialHandle('reado', 'reado.app/profile/karla')).toBe('karla')
    for (const typed of ['k', 'ka rla', 'https://reado.app/en/books/123', 'https://reado.app/en/profile/', 'https://reado.app.evil.example/en/profile/karla', '<b>x</b>']) {
      expect(cleanSocialHandle('reado', typed), typed).toBeNull()
    }
  })

  it("refuses a platform's address on another platform's field, and any other host", () => {
    expect(cleanSocialHandle('instagram', 'https://www.youtube.com/@ada')).toBeNull()
    expect(cleanSocialHandle('goodreads', 'https://www.instagram.com/ada')).toBeNull()
    expect(cleanSocialHandle('instagram', 'https://example.org/ada')).toBeNull()
    expect(cleanSocialHandle('instagram', 'https://bit.ly/3abc')).toBeNull()
  })

  it('reads everything it returns as a canonical handle', () => {
    const typed = ['Ada.Reads', '@Ada_Reads', 'https://www.instagram.com/Ada.Reads/?igsh=x', 'tiktok.com/@Ada', 'Ada-Reads', CHANNEL, '12345', 'karla']
    for (const platform of SOCIAL_PLATFORM_IDS) {
      for (const text of typed) {
        const handle = cleanSocialHandle(platform, text)
        if (handle !== null) {
          expect(isSocialHandle(platform, handle), `${platform} ${text} -> ${handle}`).toBe(true)
          expect(socialLinkUrl(platform, handle)).not.toBeNull()
        }
      }
    }
  })
})

describe('what is sent and what comes back', () => {
  it('cleans the drafts, leaves out the empty ones and names the first one that is wrong', () => {
    expect(draftsToLinks({ instagram: ' @Ada.Reads ', goodreads: '42', tiktok: '', reado: '   ' })).toEqual({
      links: [
        { platform: 'goodreads', handle: '42' },
        { platform: 'instagram', handle: 'ada.reads' },
      ],
      invalid: null,
    })
    expect(draftsToLinks({ goodreads: '42', instagram: 'not a handle', tiktok: 'x' }).invalid).toBe('instagram')
  })

  it('drops what the database should never have sent: unknown platforms, non-canonical handles, doubles', () => {
    expect(
      linksFromJson([
        { platform: 'tiktok', handle: 'ada' },
        { platform: 'goodreads', handle: '42' },
        { platform: 'instagram', handle: 'Ada' },
        { platform: 'instagram', handle: 'https://evil.example' },
        { platform: 'myspace', handle: 'tom' },
        { platform: 'goodreads', handle: '43' },
        { platform: 'youtube' },
        null,
        'x',
      ]),
    ).toEqual([
      { platform: 'goodreads', handle: '42' },
      { platform: 'tiktok', handle: 'ada' },
    ])
    expect(linksFromJson(null)).toEqual([])
    expect(linksFromJson({})).toEqual([])
  })
})

describe('the repository, against the stack', () => {
  const repo = (member: Awaited<ReturnType<typeof signUpMember>>, online = () => true) => createProfileLinks(member.client, { online })

  it('starts empty with the default visibility, saves a cleaned list and reads it back', async () => {
    const ada = await signUpMember()
    const links = repo(ada)
    expect(await links.mine()).toEqual({ data: { links: [], visibility: 'followers' }, error: null })
    const saved = await links.save({ instagram: 'https://www.instagram.com/Ada.Reads/?igsh=abc', goodreads: '42', youtube: 'Ada-Reads' }, 'followers')
    expect(saved).toEqual({
      data: {
        links: [
          { platform: 'goodreads', handle: '42' },
          { platform: 'youtube', handle: '@ada-reads' },
          { platform: 'instagram', handle: 'ada.reads' },
        ],
        visibility: 'followers',
      },
      error: null,
    })
    expect((await links.mine()).data).toEqual(saved.data)
    // A field she empties is removed.
    expect((await links.save({ goodreads: '42' }, 'everyone')).data).toEqual({ links: [{ platform: 'goodreads', handle: '42' }], visibility: 'everyone' })
  })

  it('refuses a field that is no handle before anything is sent, and names the platform', async () => {
    const ada = await signUpMember()
    const links = repo(ada)
    expect(await links.save({ instagram: 'javascript:alert(1)' }, 'followers')).toEqual({ data: null, error: 'link_invalid', platform: 'instagram' })
    expect((await links.mine()).data!.links).toEqual([])
  })

  it("maps the database's refusal of a handle the client let through, with its platform", async () => {
    const ada = await signUpMember()
    const { data, error } = await ada.client.rpc('set_profile_links', { p_links: [{ platform: 'tiktok', handle: 'a' }] })
    expect(data).toBeNull()
    expect(error?.message).toBe('link_invalid:tiktok')
    const refused = await createProfileLinks({ rpc: async () => ({ data: null, error }) } as never).save({ tiktok: 'ok' }, 'followers')
    expect(refused).toEqual({ data: null, error: 'link_invalid', platform: 'tiktok' })
  })

  it('shows another member only what her setting lets her see: followers by default, everyone, only me', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    const cy = await signUpMember()
    const adaSocial = createSocial(ada.client, { online: () => true })
    // Ada is public, so Ben can follow at once; Cy only reads her.
    await adaSocial.setPrivate(false)
    await createSocial(ben.client, { online: () => true }).follow(ada.id)
    const links = repo(ada)
    await links.save({ instagram: 'ada.reads', goodreads: '42' }, 'followers')
    const handles = (r: { data: { handle: string }[] | null }) => r.data?.map((l) => l.handle)

    expect(handles(await repo(ben).of(ada.id))).toEqual(['42', 'ada.reads'])
    expect(handles(await repo(cy).of(ada.id))).toEqual([])
    await links.save({ instagram: 'ada.reads', goodreads: '42' }, 'everyone')
    expect(handles(await repo(cy).of(ada.id))).toEqual(['42', 'ada.reads'])
    await links.save({ instagram: 'ada.reads', goodreads: '42' }, 'me')
    expect(handles(await repo(ben).of(ada.id))).toEqual([])
    expect(handles(await links.of(ada.id))).toEqual(['42', 'ada.reads'])
  })

  it('is refused offline, before anything is sent', async () => {
    const ada = await signUpMember()
    const links = repo(ada, () => false)
    expect(await links.mine()).toEqual({ data: null, error: 'offline' })
    expect(await links.save({ goodreads: '42' }, 'followers')).toEqual({ data: null, error: 'offline' })
    expect(await links.of(ada.id)).toEqual({ data: null, error: 'offline' })
    expect((await repo(ada).mine()).data!.links).toEqual([])
  })
})

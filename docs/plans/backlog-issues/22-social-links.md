Title: Profile: links to her profiles on other platforms (allow-listed, handles only, with a visibility setting)
Labels: feature, priority:high
Package: WP-22 · item #5 · tier P2 (owner decision: wanted) · size M · model Sonnet · depends on: WP-25 (report flow), WP-26 (text rule), WP-27 (launch privacy notice), the BetterReads rename · wave 3 · can run in parallel with WP-16 (bio)
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/22-social-links.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/22-social-links.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Members want to point to their profiles elsewhere: Instagram, TikTok, YouTube and the book platforms. Nothing like it exists today. `components/profile/LinksSheet.vue` and `link_templates` are a different feature: the member's private book-link templates.

After the public launch these links reach strangers, and a free URL field is a phishing and spam tool. So members store only a **validated handle or canonical ID per allow-listed platform**, and the app builds every outgoing URL itself.

## Scope

### Platforms
The formats are starting points. Check each platform's current rules and write them in the PR.

| Platform | Stored | URL the app builds | Format to check |
|---|---|---|---|
| Instagram | handle | `https://www.instagram.com/<handle>/` | `[A-Za-z0-9._]{1,30}`, no leading, trailing or double dot |
| TikTok | handle | `https://www.tiktok.com/@<handle>` | `[A-Za-z0-9._]{2,24}`, no trailing dot |
| YouTube | handle or channel id | `https://www.youtube.com/@<handle>` / `…/channel/<id>` | handle `[A-Za-z0-9._-]{3,30}`; id `UC[A-Za-z0-9_-]{22}` |
| Goodreads | numeric user id | `https://www.goodreads.com/user/show/<id>` | `[0-9]{1,12}` |
| StoryGraph | username | `https://app.thestorygraph.com/profile/<username>` | to verify |
| Hardcover | username | `https://hardcover.app/@<username>` | to verify |
| Fable | username | Fable's profile URL | to verify |

- Letterboxd is left out: it is for films.
- Bluesky and Threads are an open question.
- A pasted profile URL is parsed on the device into the handle, and only from that platform's own hosts. The server never accepts a URL.

### Database (one migration, outside the SQL chain)
- `public.member_links`:
  - Columns: `member_id → accounts on delete cascade`, `platform text check in (…)`, `handle text`, `position smallint`, `updated_at`.
  - Primary key `(member_id, platform)`, so one link per platform and at most seven.
  - RLS: select own only.
- `public.member_link_settings`:
  - Columns: `member_id` (primary key), `visibility text check in ('everyone','followers','me') default 'followers'`.
  - It is a separate table, so `social_settings` and `private.my_social_json` stay untouched.
- `set_member_links(p_links jsonb, p_visibility text)`:
  - Validates each platform's format and length, on top of `private.public_text_ok` (WP-26).
  - Online only.
  - At most 10 calls an hour.
  - Errors: `link_invalid:<platform>`, `rate_limited`.
- `member_links(p_member)`, security definer, returns links by her visibility setting:
  - `me`: only herself.
  - `followers`: herself and accepted followers.
  - `everyone`: whoever may see her profile (`private.visible`).
  - Never across a block.
- `owner_clear_member_links(member)`: the owner's action for WP-25.

### App
- An Account row **Links** opens a sheet:
  - one field per platform, with its fixed prefix shown;
  - a pasted URL is turned into the handle;
  - a segmented control for the visibility.
- A row of platform marks under the name in `components/profile/Hero.vue` and `components/friends/MemberHero.vue`:
  - the app's own monochrome glyphs or text chips;
  - `target="_blank" rel="noopener noreferrer nofollow ugc"`;
  - an external-link indicator;
  - accessible name "{platform}: {handle}, opens {platform}".
- WP-25 gains the report reason "links".

### Privacy notice (EN and DE)
- A new optional data category: links to her profiles on other platforms.
- Who sees them follows her setting; she can delete them at any time, and they are deleted with her account.
- Opening one goes to a third party with its own privacy policy. No referrer is sent.

### German
- `account.links` ("Links").
- `links.title` ("Your profiles elsewhere" / "Deine Profile anderswo").
- `links.placeholder`, `links.pasteHint`, `links.invalid.<platform>`.
- `links.visibility.everyone|followers|me`:
  - "Everyone who can see your profile" / "Alle, die dein Profil sehen"
  - "Followers only" / "Nur Follower"
  - "Only me" / "Nur ich"
- `links.opens` ("Opens {platform}" / "Öffnet {platform}").
- Platform names stay brand names.

### Docs
`docs/parity.md` (Profile, A member's profile, a new Links sheet entry), `CONTEXT.md` if a term is needed.

## Acceptance criteria
- [ ] She adds an Instagram handle and a Goodreads id and picks a visibility. Exactly the people that visibility allows see two marks under her name, and each opens the canonical profile URL in a new tab.
- [ ] A pasted `https://www.instagram.com/name/?igsh=…` is stored as `name`.
- [ ] Free URLs, other hosts and `javascript:` are refused on the device and on the server.
- [ ] Each visibility works as specified for these viewers: herself, an accepted follower, a requester, a stranger to a private account, anyone on a public account, and a blocked member in either direction (pgTAP).
- [ ] The seven-link cap, the rate limit and the deletion cascade are covered by pgTAP. The owner action refuses everyone except the owner.
- [ ] Report → "links" reaches the owner, who can clear them.
- [ ] The privacy notice names the category in EN and DE; `tests/i18n-parity.test.ts` and `tests/legal.test.ts` are green.
- [ ] Vitest covers the paste parser and the URL builder for every platform. Playwright runs locally only, not in CI.

## Notes
- **Recommended default visibility: followers only.**
  - On a private account, that is the people she accepted.
  - On a public account, it hides links from strangers who opened her link without following.
  - "Everyone" is her explicit choice.
  - Links are not shown on the public reading page for now.
- **WP-16 (bio) can run in parallel.** Each has its own sheet, table and RPC. They meet only in disjoint hunks of the two heroes and `Account.vue`. A shared "Edit profile" sheet can merge them later.
- **Data export:** there is no member-facing export today (`data/export/memberLibrary.ts` is the Regal Library export). Any future GDPR export includes the links.
- **Owner questions:**
  - Add Bluesky or Threads?
  - Is followers only the right default?
  - Show links on the reading page later?

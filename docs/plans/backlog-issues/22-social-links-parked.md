Title: Profile: social and external links (parked, not recommended)
Labels: feature, priority:low, needs-decision
Package: WP-22 · item #5 · tier P4 · parked · size M · model Sonnet · would depend on: WP-16
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/22-social-links-parked.md)" --label feature --label priority:low --label needs-decision --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/22-social-links-parked.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The owner listed Instagram, TikTok, YouTube and book-platform links on the profile. Nothing like it exists (`components/profile/LinksSheet.vue` / `link_templates` are the member's private book-link templates, a different feature).

## Why parked
- Outbound links shown to strangers (public accounts) are a phishing and abuse vector; there is no report flow, only block.
- A new data category in the privacy notice; a platform list to maintain.
- Little value in an invite-only, friends-based app.

## If the owner decides to do it: the safe shape
- Handles only, for an allow-list of platforms; the app builds the URL, so a link cannot point anywhere else.
- At most four; `rel="noopener noreferrer nofollow ugc"`; shown only where `private.visible` allows.
- Stored on `accounts` with server-side validation; privacy notice in EN and DE.
- After WP-16 (same hero and profile plumbing).

## Acceptance criteria (if un-parked)
- [ ] Only allow-listed platforms, handles validated server-side, URLs built by the app.
- [ ] Not visible to blocked members or non-followers of a private account.
- [ ] Privacy notice updated in EN and DE.

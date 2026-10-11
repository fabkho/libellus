Title: Collections: an uploaded cover instead of the four-cover mosaic
Labels: feature, priority:low
Package: WP-21 · item #8 · tier P3 (last in line; worth questioning) · size L · model Sonnet · depends on: WP-12, WP-14 · wave 5
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/21-collection-cover-image.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/21-collection-cover-image.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
A Collection's face is always its first four covers (`web/app/components/collections/Mosaic.vue`).

## Scope
- Migration: private bucket `collection-covers` (avatar-style policies, 256 KB, webp/jpeg); `collections.cover_path`; `set_collection_cover`; `delete_my_account` extended (latest in `20261009120000_avatars.sql`).
- Crop and raster (`utils/crop.ts`, `utils/avatarRaster.ts`, a 2:3 variant); `Mosaic.vue` shows the cover; options sheet upload/remove.
- Deleting a Collection deletes its file (client); the account purge in `data/auth.ts` clears the folder.
- Followers see the cover only on a visible Collection (WP-11 model).
- Keys: `collection.cover`, `collection.coverRemove`, errors.

## Acceptance criteria
- [ ] Upload, crop and remove a cover; the Mosaic shows it.
- [ ] Followers see it only on a visible Collection.
- [ ] Deleting the Collection or the account leaves no file.
- [ ] pgTAP for policies and deletion; Vitest for the raster.

## Notes
- Uploaded images reach followers once Collections can be visible: moderation risk without a report flow.
- Owner question: worth it? Recommended only once #2 is live and members ask.

Title: Collections: an uploaded cover instead of the four-cover mosaic
Labels: feature, priority:low, needs-decision
Package: WP-21 · item #8 · tier P4 (parked unless members ask) · size L · model Sonnet · depends on: WP-12, WP-14, WP-25 · parked
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/21-collection-cover-image.md)" --label feature --label priority:low --label needs-decision --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/21-collection-cover-image.md)
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
- Public launch (revision 2): uploaders and viewers can be strangers, there is no automated image moderation, and the Free plan holds 1 GB of files. Parked unless members ask. If un-parked, all of: 256 KB, webp/jpeg only, re-encoded on the device (strips EXIF, as `utils/avatarRaster.ts` does for photos), path pinned per member and Collection, one file per Collection and a per-member cap in the insert policy, a "cover" report reason with an owner action that deletes the file.
- Uploaded images reach followers once Collections can be visible: moderation risk without a report flow.
- Owner question: worth it? Recommended only once #2 is live and members ask.

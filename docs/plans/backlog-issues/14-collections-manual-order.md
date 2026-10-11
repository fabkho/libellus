Title: Collections: your own order next to "last edited"
Labels: feature, priority:low
Package: WP-14 · item #7 · tier P3 · size L · model Sonnet · depends on: WP-12, WP-13 · wave 3
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/14-collections-manual-order.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/14-collections-manual-order.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Collections are listed last edited first (PR #302). `collections.position` is only the creation order and parity says "There is no manual order of Collections" (`docs/parity.md:717`).

## Scope
- Sort mode: `recent` (default, today) or `manual`; kept on the device like the Library's view (recommended).
- `reorder_collections(p_ids uuid[])`: `order_mismatch` unless exactly her Collections; does not bump `updated_at`; a `sync_write` action (offline).
- Collections page: drag (via `useReorderList`) in manual mode; a mode control.
- The picker (`PickerSheet.vue`), the book page's chips and the Library row's fan (`LibraryLink.vue`) follow the mode; the held order (`utils/editedOrder.ts`) only in `recent`.
- `data/queuedWrites.ts` + `sync.action.reorderCollections`.
- Keys: `collections.sort.recent` ("Last edited" / "Zuletzt bearbeitet"), `collections.sort.manual` ("Your order" / "Eigene Reihenfolge"), `collections.move`, `collections.moved`, `collections.dropped`.
- `docs/parity.md` Collections (rewrite :717).

## Acceptance criteria
- [ ] In manual mode a dragged order holds on the page, in the picker, in the Library row and on another device.
- [ ] Switching to Last edited shows #302's order.
- [ ] Keyboard reordering works and is announced.
- [ ] An offline reorder syncs.
- [ ] pgTAP: `order_mismatch`, no `updated_at` change, `sync_write` replay; Vitest for the store in both modes.

## Notes
- Redefines `sync_write` in full: no other open PR may redefine it at the same time (WP-17 waits).
- Owner questions: mode per device (recommended) or per account; a new Collection on top or at the end in manual mode?

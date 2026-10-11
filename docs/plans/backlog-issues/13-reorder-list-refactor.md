Title: Refactor: extract the drag-to-reorder list from the Collection page
Labels: refactor, priority:low
Package: WP-13 · enabler for #7 · tier P4 · size M · model Sonnet · depends on: WP-10 · wave 2
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/13-reorder-list-refactor.md)" --label refactor --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/13-reorder-list-refactor.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Collection entries reorder with in-house pointer, hold, keyboard and live-region code inside `web/app/components/collections/EntryList.vue` (454 lines, `lift` at :68). Manual ordering of Collections (#7) needs the same behaviour.

## Scope
- Move the logic into `composables/useReorderList.ts`; `EntryList.vue` uses it.
- No behaviour change.

## Acceptance criteria
- [ ] Entries reorder exactly as before: grip drag, 350 ms touch hold, arrows, Home/End, announcements, reduced motion.
- [ ] Vitest for the index maths and keyboard moves.
- [ ] `docs/parity.md` unchanged.

## Notes
- No migration, no strings.

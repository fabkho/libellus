Title: Export your data: a BetterReads JSON and a Goodreads-format CSV
Labels: feature, priority:high
Package: WP-29 · issue #170 · tier P2 · size M · model normal · depends on: none · wave 1–2 · new in revision 4
Create: not needed; issue #170 already exists. Paste this body into #170 as the build spec if the owner agrees.
Plan: docs/plans/backlog-execution.md

---
## Problem
A member cannot take her data with her. #170 asks for an export. The only existing export is the owner's Regal library file (`web/app/data/export/regal.ts`, `memberLibrary.ts`). A member-facing export is also the GDPR access and portability answer, and it covers newer data such as profile links (WP-22, 1.19.0).

## Scope
- A Profile → Account row **Export your data** that downloads two files:
  - **BetterReads JSON**, with a documented shape: Library entries with every read (dates, outcome, rating, review, abandon reason, read as), Collections and their order, profile links and their visibility, Book links (link templates), privacy settings, and the progress days.
  - **Goodreads CSV**: the columns of Goodreads' own `library_export.csv`, so another tracker can import it.
- Built on the device from her own rows through RLS. It reuses `data/export/memberLibrary.ts` (the whole Library with every read). No new SQL.
- If some data is missing offline, the export says so.
- Keys in EN and DE. `docs/parity.md` gets an entry. The privacy notice says that she can export her data.

## Acceptance criteria
- [ ] Both files download from the Account row on a phone and on a desktop.
- [ ] The JSON matches its documented shape (a schema in the repo, checked by Vitest).
- [ ] The CSV re-imports through BetterReads' own Goodreads import with the same Books, reads, ratings and shelves (Vitest round trip on a fixture).
- [ ] Another member's data never appears (only RLS-scoped reads).

## Notes
- Owner questions: include reviews and notes by default; ship the JSON first and the CSV later?
- No collision with open work: `data/export/*` and `components/profile/Account.vue` are free (2026-11-01).

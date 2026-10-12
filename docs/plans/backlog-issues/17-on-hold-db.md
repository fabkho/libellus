Title: On Hold, database: a paused read
Labels: feature, priority:low
Package: WP-17 · item #23 · tier P3 · size L · model Opus · depends on: WP-11, WP-14, WP-16 · wave 5
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/17-on-hold-db.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/17-on-hold-db.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Status is derived from Reading sessions (`CONTEXT.md`; `entry_status_of`, `supabase/migrations/20261003102707_reading_sessions.sql:112-126`, trigger `library_entries_derive_status`). "On Hold" must fit that model.

## Scope
- Two migrations: (1) `alter type entry_status add value 'paused'`; (2) `reading_sessions.paused_on date` with check `paused_on is null or outcome is null`, `entry_status_of` returning `paused` for a paused open session, `pause_reading(entry)`, `resume_reading(entry)`, `sync_write` actions.
- Review every function that knows a status (latest definitions): `start_reading`, `abandon_reading`, `read_again`, `finish_reading`, `update_session`, `add_first_session`, `add_to_library`, `add_manual_book`, `sync_write`, `feed`, `member_profile`, `public_reading_page`, `public_book_card`, `circle_reading`, `circle_want`, `book_readers`, `import_books`, `update_progress`, `change_edition`, `started_series*`. The full list with line numbers is in `docs/plans/backlog-execution.md` §5.4.
- pgTAP: new `supabase/tests/paused_test.sql`; update tests that enumerate statuses.

## Acceptance criteria
- [ ] Pause and resume keep dates and progress; finishing or abandoning a paused read clears the pause.
- [ ] `start_reading` on a paused entry refuses with a clear code (resume instead).
- [ ] `circle_reading` and `feed` leave paused reads out; `member_profile` follows the chosen section.
- [ ] Every function in §5.4 has a test or a written note.
- [ ] The migration is inert for existing data.

## Notes
- Deploy risk: an old installed app that gets `status = 'paused'` breaks (`lists[status]`). Grant the new RPCs only once WP-18's tolerant client has shipped.
- Redefines `sync_write`, `member_profile`, `public_reading_page`, `feed` in full: no parallel PR may touch them.
- Owner questions: progress resumes a paused book (recommended); followers see paused under Currently reading (`show_reading`); no feed event; can a book be added straight as On hold?

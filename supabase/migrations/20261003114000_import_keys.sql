-- Source keys for the owner's Fable import (issue #17).
--
-- The import (web/scripts/import-fable.ts) writes a member's whole Fable
-- history as the service role, and running it again must not create anything
-- twice. Books are found again by their Catalogue keys (ISBN-13, Apple id,
-- OpenLibrary edition key), but entries and sessions had nothing that says
-- which Fable record they came from: an entry could only be found by its Book
-- (lost when the owner's overrides move it to another edition) and a session
-- only by its dates (lost when an override corrects one). These columns hold
-- that record's key, `fable:<reading-tracker id>`.
--
-- Written only by the import, as the service role; members cannot write either
-- table at all, and null (everything made in the app) is never a key, so two
-- app-made rows never collide. Nothing reads them but the import.

alter table public.library_entries
  add column import_key text,
  add constraint library_entries_import_key_present check (import_key ~ '^[a-z]+:\S+$'),
  -- Not partial: a plain unique constraint lets PostgREST upsert on it, and nulls never clash.
  add constraint library_entries_import_key_once unique (member_id, import_key);

comment on column public.library_entries.import_key is
  'The import record this entry came from (`fable:<id>`), so a rerun finds it again. Null when '
  'made in the app. Written only by the owner''s import, as the service role.';

alter table public.reading_sessions
  add column import_key text,
  add constraint reading_sessions_import_key_present check (import_key ~ '^[a-z]+:\S+$'),
  add constraint reading_sessions_import_key_once unique (entry_id, import_key);

comment on column public.reading_sessions.import_key is
  'The import record (one Fable read, `fable:<id>`) this session came from, so a rerun updates it '
  'instead of adding another. Null when made in the app. Written only by the owner''s import.';

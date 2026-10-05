-- Two Supabase lints.
--
-- 1. unindexed_foreign_keys: `accounts.invite_code_id` references invite_codes
--    and had no index, so deleting or updating an invite code scanned accounts.
--
-- 2. extension_in_public: `citext` lived in `public`. It moves to `extensions`,
--    where the other extensions are. Columns keep working: a column stores the
--    type by its OID, which does not change (invite_codes.code stays citext, its
--    unique index and the length check with it). What does change is how the
--    NAME `citext`, and the `=` on it, are found: through the search_path.
--    Every API request and every role's default path has `extensions` in it
--    (config.toml, `extra_search_path`), but a function that pins its own path
--    does not. The one that spells `::citext` and compares with it,
--    `signup_invite` (`set search_path = public, pg_catalog`), gets `extensions`
--    added; the functions that call it need nothing.

create index accounts_invite_code_id on public.accounts (invite_code_id);

create schema if not exists extensions;
alter extension citext set schema extensions;

alter function public.signup_invite(jsonb, boolean)
  set search_path = public, extensions, pg_catalog;

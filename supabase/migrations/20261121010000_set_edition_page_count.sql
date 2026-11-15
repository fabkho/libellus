-- Filling an edition's page count where nobody knows it yet (docs/proposals/page-counts-2026-11-15.md, and the
-- owner's decision: "The page count coming from the edition should be the first and default page count … only
-- backfill page counts which are null, do not touch everything else.").
--
-- `books.page_count` is the *edition's* count: one shared Catalogue row (owner_id null) that every member
-- holding that edition reads, through `pageCountOf` (her own `library_entries.page_count_override` first, the
-- edition's second). Writing a null therefore helps everyone who holds the edition and moves no figure that is
-- already known — which is why a null-fill is safe here where a correction of a shared row would not be. The
-- member's own override is never read and never written by this: it is hers, and it is not this function's
-- business.
--
--   private.set_edition_page_count(p_book uuid, p_page_count integer) returns boolean
--
--     the one statement it runs is
--       update public.books set page_count = p_page_count where id = p_book and page_count is null
--     with no coalesce and no second statement. Answers true when a row changed and false when none did: the Book
--     already had a count (which it never replaces), or no such Book. The caller counts its true answers, so a
--     backfill run twice writes nothing the second time.
--
--     The count is held to the range the app's own total takes (`update_progress`'s `progress_invalid`,
--     20261004074435_progress_page_count_override.sql): 1 … 99999. Anything else, a null included, is refused
--     before the write, because it is no page count at all.
--
-- Not a member's function, and this migration creates nothing in `public`. A backfill (one-off: the 17 Books the
-- owner's 22 finished reads without a page count left askable by ISBN; web/scripts/backfill-page-counts.ts) runs
-- it as maintenance, so `service_role` holds execute and no one else does. The revoke is what keeps it that way
-- even if a `private` schema were ever exposed through PostgREST.
--
-- What this migration changes in rows that are already there: nothing. It adds one function; no table, column,
-- index or row is touched, and no backfill runs here — the writing is the operator's call, with `--apply`.
--
-- Re-runnable: create or replace, the same revoke and grant.

create or replace function private.set_edition_page_count(p_book uuid, p_page_count integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written integer;
begin
  if p_page_count is null or p_page_count not between 1 and 99999 then
    raise exception 'page_count_invalid' using errcode = '22023';
  end if;
  if p_book is null then
    return false;
  end if;
  update public.books
     set page_count = p_page_count
   where id = p_book and page_count is null;
  get diagnostics v_written = row_count;
  return v_written > 0;
end;
$$;

comment on function private.set_edition_page_count(uuid, integer) is
  'Fills an edition''s page count where it is null and answers whether it wrote: the one write is `set page_count '
  '… where id = p_book and page_count is null`, so a count that is there is never replaced and a second run writes '
  'nothing. Not a member''s: execute is the service role''s alone (the one-off backfill, maintenance). The count '
  'must be 1…99999 (page_count_invalid); the member''s own library_entries.page_count_override is never touched.';

revoke all on function private.set_edition_page_count(uuid, integer) from public, anon, authenticated;
grant execute on function private.set_edition_page_count(uuid, integer) to service_role;

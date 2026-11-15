-- The member's own page count on a read that is already finished (Profile,
-- the "N without a page count" line).
--
-- `library_entries.page_count_override` (issue #60: an ebook's pages follow the
-- font size) is so far only written through `update_progress`, and that one
-- refuses a finished entry (`not_reading`: the read's outcome is not null), so
-- a read that ended without a count could never get one. This narrow sibling
-- sets only the override, on any entry of hers including a finished one, on
-- purpose: the count she sets is hers to keep, even after she finished the
-- book, and she may change it again afterwards (the edition's count stays the
-- default underneath).
--
--   set_read_total(p_entry_id, p_page_count)
--
-- `p_page_count` is the new override, or null to go back to the edition's.
-- A total that only repeats the edition's page count is stored as no override
-- (as `update_progress` has it), so a later backfill can still supply the
-- truth. A total outside 1 … 99999 is `progress_invalid`, the same refusal
-- the neighbours use.
--
-- A lower total never rewrites recorded history: `reading_sessions` and
-- `reading_progress_days` are left exactly as they were, even when the new
-- total is below pages already recorded. History is what happened; the total
-- is only what future figures measure against. Do not "fix" this by clamping.
--
-- Additive only: one function, no table change, no row but the entry's own
-- override touched.

create function public.set_read_total(
  p_entry_id   uuid,
  p_page_count integer default null
)
returns public.library_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member     uuid := auth.uid();
  v_book_count integer;
  v_override   integer;
  v_entry      public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_page_count is not null and p_page_count not between 1 and 99999 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  -- Locked, so a progress update from another device lands one after the other.
  select b.page_count into v_book_count
    from public.library_entries e
    join public.books b on b.id = e.book_id
   where e.id = p_entry_id and e.member_id = v_member
     for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- A total that only repeats the edition's is no override.
  v_override := case when p_page_count is not distinct from v_book_count then null else p_page_count end;

  update public.library_entries set page_count_override = v_override where id = p_entry_id
  returning * into v_entry;
  return v_entry;
end;
$$;

revoke all on function public.set_read_total(uuid, integer) from public, anon;
grant execute on function public.set_read_total(uuid, integer) to authenticated;

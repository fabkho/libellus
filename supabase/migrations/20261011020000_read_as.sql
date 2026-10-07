-- "Read as" on a library entry (issue #169, shared decisions in #166).
--
-- How the member read this Book: on paper, as an ebook or as an audiobook. It is
-- hers, not the edition's: picking an ebook edition for its cover must not claim
-- she read an ebook. One value per library entry (not per read), null while she
-- has not said. The Library's Read as filter and the stats use this field.
--
--   library_entries.read_as   'physical' | 'ebook' | 'audiobook', null = not set
--
-- The client shows an unset value as the edition's format when that is known
-- (data/library.ts, `readAsOf`); only what she chose, or accepted, is stored.
--
-- Written through `set_read_as(entry, read_as)`; null clears it. Her own entry
-- only (`entry_not_found` otherwise); anything but the three words is
-- `read_as_invalid`. Setting what is there already changes nothing.

alter table public.library_entries
  add column read_as text,
  add constraint library_entries_read_as_known check (read_as in ('physical', 'ebook', 'audiobook'));

comment on column public.library_entries.read_as is
  'How the member read this Book: physical, ebook or audiobook; null = not set. Hers, not the edition''s '
  '(an ebook edition picked for its cover does not make it an ebook read). Set only through set_read_as.';

create function public.set_read_as(p_entry_id uuid, p_read_as text)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_read_as is not null and p_read_as not in ('physical', 'ebook', 'audiobook') then
    raise exception 'read_as_invalid' using errcode = '22023';
  end if;
  update public.library_entries
     set read_as = p_read_as
   where id = p_entry_id and member_id = v_member
  returning * into v_entry;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  return v_entry;
end;
$$;

revoke all on function public.set_read_as(uuid, text) from public, anon;
grant execute on function public.set_read_as(uuid, text) to authenticated;

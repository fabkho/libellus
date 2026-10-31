CREATE OR REPLACE FUNCTION public.move_entry_to(p_entry library_entries, p_book_id uuid, p_format book_format)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_entry      public.library_entries := p_entry;
  v_old        public.books;
  v_new        public.books;
  v_read_as    text;
begin
  if exists (
    select 1 from public.library_entries
     where member_id = v_entry.member_id and book_id = p_book_id and id <> v_entry.id
  ) then
    raise exception 'edition_in_library' using errcode = '23505';
  end if;

  select * into v_old from public.books where id = v_entry.book_id;
  select * into v_new from public.books where id = p_book_id;

  -- What the new edition says about how it is read (her word on its format, else the
  -- Book's), when it is read differently from the edition the entry leaves.
  v_read_as := public.read_as_for_format(coalesce(p_format, v_new.format));
  if v_read_as is not distinct from public.read_as_for_format(coalesce(v_entry.format_override, v_old.format)) then
    v_read_as := null;
  end if;

  begin
    update public.library_entries
       set book_id = p_book_id,
           edition_changed_at = now(),
           format_override = case when p_format is distinct from v_new.format then p_format end,
           read_as = case when read_as is not null then coalesce(v_read_as, read_as) end
     where id = v_entry.id
    returning * into v_entry;
  exception when unique_violation then
    -- The same edition added on another device a moment ago.
    raise exception 'edition_in_library' using errcode = '23505';
  end;

  -- The member's own total (#60) when she set one, else the new edition's.
  perform public.clamp_session_progress(v_entry.id, coalesce(v_entry.page_count_override, v_new.page_count));

  -- Her Manual book, now used by nothing: gone, so her search never shows the stale copy.
  if v_old.owner_id = v_entry.member_id
     and not exists (select 1 from public.library_entries where book_id = v_old.id) then
    delete from public.books where id = v_old.id;
  end if;

  return v_entry;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_entry_genres(p_entry uuid)
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_book uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select book_id into v_book from public.library_entries where id = p_entry and member_id = v_member;
  if v_book is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  delete from public.entry_genres where entry_id = p_entry;
  return query select bg.genre_id from public.book_genres bg where bg.book_id = v_book order by bg.rank;
end;
$function$
;

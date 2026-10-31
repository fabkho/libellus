CREATE OR REPLACE FUNCTION public.share_book_card(p_book uuid, p_review boolean)
 RETURNS reading_page_books
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_row    public.reading_page_books;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reading_pages where member_id = v_member and token is not null) then
    raise exception 'reading_page_off' using errcode = '22023';
  end if;
  if not exists (select 1 from public.library_entries where member_id = v_member and book_id = p_book) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  insert into public.reading_page_books as c (member_id, book_id, review)
  values (v_member, p_book, coalesce(p_review, false))
  on conflict (member_id, book_id) do update set review = excluded.review
  returning c.* into v_row;
  return v_row;
end;
$function$
;

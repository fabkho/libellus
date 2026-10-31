CREATE OR REPLACE FUNCTION public.unshare_book_card(p_book uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from public.reading_page_books where member_id = auth.uid() and book_id = p_book;
end;
$function$
;
